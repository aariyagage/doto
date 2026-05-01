import Groq from 'groq-sdk';
import { requireEnv } from '@/lib/env';
import { embedText } from '@/lib/pillars/embeddings';
import type { SupabaseServer } from '@/lib/pillars/types';
import { pickAnglesForBatch, type Angle } from './angles';
import { shufflePackagingForBatch, type PackagingType } from './packaging';
import {
    V2_SYSTEM_MESSAGE,
    buildV2UserMessage,
    type V2VoiceProfile,
} from './idea-prompt';
import { buildPillarContext } from './context-builder';
import {
    dedupeWithinBatch,
    filterAgainstSavedUsed,
    hookIsWeak,
    titleLooksTemplated,
} from './dedup';

// Mirror the v1 cap so callers can swap freely under the flag without
// surprising perPillarCount semantics.
const PER_PILLAR_DEFAULT = 3;
const PER_PILLAR_MAX = 5;
// Match v1's PILLAR_CONCURRENCY=2 to stay under Groq free-tier 12k TPM. v2
// fires more calls per pillar (1 per angle×packaging tuple) so we sequence
// within a pillar and parallelize across pillars at this width.
const PILLAR_CONCURRENCY = 2;

type V2Candidate = {
    hook?: string;
    title?: string;
    idea?: string;
    execution?: string;
    anchor_quote?: string | null;
    tension_type?: string;
    format?: string;
};

export interface GenerateIdeasV2Args {
    supabase: SupabaseServer;
    userId: string;
    pillarIds?: string[];
    perPillarCount?: number;
}

export interface GenerateIdeasV2Result {
    inserted: { id: string; pillar_id: string | null; title: string | null }[];
    insertedRaw: unknown[];
    pillarsCovered: number;
    totalRejected: number;
    error?: string;
}

export async function generateIdeasV2ForUser(args: GenerateIdeasV2Args): Promise<GenerateIdeasV2Result> {
    const { supabase, userId } = args;
    const pillarIds = Array.isArray(args.pillarIds) ? args.pillarIds : [];
    const perPillarCount = Math.max(1, Math.min(args.perPillarCount ?? PER_PILLAR_DEFAULT, PER_PILLAR_MAX));

    const { data: voiceProfile, error: vpError } = await supabase
        .from('voice_profile')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (vpError || !voiceProfile) {
        return {
            inserted: [],
            insertedRaw: [],
            pillarsCovered: 0,
            totalRejected: 0,
            error: 'No voice profile found. Upload videos first.',
        };
    }

    let pillarsQuery = supabase
        .from('pillars')
        .select('id, name, description, subtopics, embedding')
        .eq('user_id', userId);
    if (pillarIds.length > 0) pillarsQuery = pillarsQuery.in('id', pillarIds);
    const { data: pillars, error: pillarsError } = await pillarsQuery;
    if (pillarsError) throw new Error(`Failed to fetch pillars: ${pillarsError.message}`);

    const targetPillars = pillars || [];
    if (targetPillars.length === 0) {
        return {
            inserted: [],
            insertedRaw: [],
            pillarsCovered: 0,
            totalRejected: 0,
            error: 'No pillars to generate for. Upload videos first or pick a different filter.',
        };
    }

    const groq = new Groq({ apiKey: requireEnv('GROQ_API_KEY') });

    type PillarOutcome = {
        pillarId: string;
        pillarName: string;
        accepted: { idea: PreparedIdea; embedding: number[] }[];
        rejected: number;
    };

    async function processPillar(pillar: typeof targetPillars[number]): Promise<PillarOutcome> {
        const context = await buildPillarContext({ supabase, userId, pillar });

        const angles = pickAnglesForBatch(perPillarCount);
        const packagings = shufflePackagingForBatch(perPillarCount);

        const candidates: { idea: PreparedIdea; embedding: number[] }[] = [];
        let rejected = 0;

        // Sequential within a pillar — keeps Groq token-rate predictable. The
        // outer Promise.all across pillars is where parallelism happens.
        for (let i = 0; i < perPillarCount; i++) {
            const angle = angles[i % angles.length];
            const packaging = packagings[i];

            const userMsg = buildV2UserMessage({
                voiceProfile: voiceProfile as V2VoiceProfile,
                pillar: context,
                angle,
                packaging,
            });

            let raw: V2Candidate | null = null;
            try {
                raw = await callGroq(groq, V2_SYSTEM_MESSAGE, userMsg);
            } catch (err) {
                console.error(
                    `ideas/v2 pillar="${pillar.name}" angle=${angle.id} packaging=${packaging.id} Groq failed:`,
                    err,
                );
                rejected++;
                continue;
            }
            if (!raw) {
                rejected++;
                continue;
            }

            const validation = validateCandidate(raw);
            if (!validation.ok) {
                console.log(
                    `ideas/v2 pillar="${pillar.name}" angle=${angle.id} packaging=${packaging.id} rejected: ${validation.reason}`,
                );
                rejected++;
                continue;
            }

            const prepared: PreparedIdea = {
                pillarId: pillar.id,
                pillarName: pillar.name,
                angle,
                packaging,
                hook: raw.hook!.trim(),
                title: raw.title!.trim(),
                idea: (raw.idea || '').trim(),
                execution: (raw.execution || '').trim(),
                anchorQuote: raw.anchor_quote?.trim() || null,
                tensionType: raw.tension_type?.trim() || null,
                format: raw.format?.trim() || null,
            };

            // Embed once per accepted candidate; this becomes idea_embedding on
            // insert AND drives the within-batch / saved-used dedup.
            let embedding: number[];
            try {
                embedding = await embedText(`${prepared.title} ${prepared.hook} ${prepared.idea}`);
            } catch (err) {
                console.warn(
                    `ideas/v2 embed failed pillar="${pillar.name}" — keeping idea without embedding:`,
                    err,
                );
                rejected++;
                continue;
            }

            candidates.push({ idea: prepared, embedding });
        }

        // Within-batch dedup, then saved/used check.
        const batchDedup = dedupeWithinBatch(candidates);
        rejected += batchDedup.dropped.length;

        const historyDedup = await filterAgainstSavedUsed(supabase, userId, batchDedup.kept);
        rejected += historyDedup.dropped.length;

        return {
            pillarId: pillar.id,
            pillarName: pillar.name,
            accepted: historyDedup.kept,
            rejected,
        };
    }

    // Pillar-level parallelism, capped.
    const outcomes: PillarOutcome[] = [];
    for (let i = 0; i < targetPillars.length; i += PILLAR_CONCURRENCY) {
        const batch = targetPillars.slice(i, i + PILLAR_CONCURRENCY);
        const settled = await Promise.allSettled(batch.map(p => processPillar(p)));
        for (const s of settled) {
            if (s.status === 'fulfilled') outcomes.push(s.value);
            else console.error('ideas/v2 pillar processor rejected:', s.reason);
        }
    }

    const totalRejected = outcomes.reduce((sum, o) => sum + o.rejected, 0);
    const allAccepted = outcomes.flatMap(o => o.accepted);

    if (allAccepted.length === 0) {
        return {
            inserted: [],
            insertedRaw: [],
            pillarsCovered: 0,
            totalRejected,
            error: 'Could not generate any distinct ideas. Try again or upload more varied transcripts.',
        };
    }

    const insertedRaw: unknown[] = [];
    const inserted: { id: string; pillar_id: string | null; title: string | null }[] = [];
    const insertErrors: { title: string | undefined; error: string }[] = [];

    for (const { idea, embedding } of allAccepted) {
        const reasoningParts = [
            idea.idea,
            idea.execution ? `Execution: ${idea.execution}` : null,
            `Angle: ${idea.angle.name}`,
            `Packaging: ${idea.packaging.label}`,
            idea.tensionType ? `Tension: ${idea.tensionType}` : null,
            idea.format ? `Format: ${idea.format}` : null,
            idea.anchorQuote ? `Anchor quote: ${idea.anchorQuote}` : null,
        ].filter(Boolean);

        const { data: row, error: insertError } = await supabase
            .from('content_ideas')
            .insert({
                user_id: userId,
                pillar_id: idea.pillarId,
                title: idea.title,
                hook: idea.hook,
                structure: idea.execution,
                reasoning: reasoningParts.join('\n\n'),
                angle: idea.angle.id,
                packaging_type: idea.packaging.id,
                idea_embedding: embedding,
                source_version: 'v2',
                is_saved: false,
                is_used: false,
            })
            .select()
            .single();

        if (insertError) {
            console.error('ideas/v2 insert failed:', JSON.stringify(insertError));
            insertErrors.push({ title: idea.title, error: insertError.message });
        } else if (row) {
            insertedRaw.push(row);
            inserted.push({
                id: (row as { id: string }).id,
                pillar_id: (row as { pillar_id: string | null }).pillar_id,
                title: (row as { title: string | null }).title,
            });
        }
    }

    console.log(
        `ideas/v2 summary — pillars=${targetPillars.length} per_pillar=${perPillarCount} accepted=${allAccepted.length} inserted=${inserted.length} failed=${insertErrors.length} total_rejected=${totalRejected}`,
    );

    return {
        inserted,
        insertedRaw,
        pillarsCovered: targetPillars.length,
        totalRejected,
    };
}

type PreparedIdea = {
    pillarId: string;
    pillarName: string;
    angle: Angle;
    packaging: PackagingType;
    hook: string;
    title: string;
    idea: string;
    execution: string;
    anchorQuote: string | null;
    tensionType: string | null;
    format: string | null;
};

function validateCandidate(raw: V2Candidate): { ok: boolean; reason?: string } {
    if (!raw.hook || !raw.title) return { ok: false, reason: 'missing hook or title' };
    if (titleLooksTemplated(raw.title)) return { ok: false, reason: 'templated title' };
    if (hookIsWeak(raw.hook)) return { ok: false, reason: 'weak hook' };
    return { ok: true };
}

async function callGroq(groq: Groq, systemMessage: string, userMessage: string): Promise<V2Candidate | null> {
    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage },
        ],
        temperature: 0.85,
        response_format: { type: 'json_object' },
    });

    let content = completion.choices[0]?.message?.content || '{}';
    if (content.startsWith('```json')) content = content.replace(/^```json\n/, '').replace(/\n```$/, '');
    else if (content.startsWith('```')) content = content.replace(/^```\n/, '').replace(/\n```$/, '');

    const parsed = JSON.parse(content.trim());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as V2Candidate;
    }
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        return parsed[0] as V2Candidate;
    }
    return null;
}
