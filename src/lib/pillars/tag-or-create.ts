import type Groq from 'groq-sdk';
import { embedText, parseEmbedding } from './embeddings';
import { findSimilarPillars, findClosestPillar, PILLAR_DEDUP_COSINE_THRESHOLD, type PillarMatch } from './dedup';
import { getCombo } from '@/lib/colors';
import type { SupabaseServer } from './types';

// Cosine thresholds. With BROAD pillars, same-territory essences typically
// score 0.45-0.65 against the umbrella pillar. We tag aggressively and let the
// LLM (which sees the full pillar list + descriptions) make the close calls.
const TAG_FAST_THRESHOLD = 0.55;       // strong match: tag without LLM
const TAG_AMBIGUOUS_FLOOR = 0.30;      // below this we go straight to "new pillar?"
// Multi-tag is rare on purpose: a video should usually live in one pillar.
// We only tag against a 2nd pillar when (a) the 2nd is itself a strong match,
// AND (b) the gap between #1 and #2 is small — meaning the video is genuinely
// straddling two territories, not just leaking signal into a tangentially
// related pillar.
const TAG_SECOND_PILLAR_THRESHOLD = 0.72;
const TAG_SECOND_PILLAR_GAP = 0.05;

interface TagOrCreateArgs {
    supabase: SupabaseServer;
    groq: Groq;
    userId: string;
    videoId: string;
    transcriptId: string;
}

interface LlmTagDecision {
    decision: 'tag' | 'new';
    pillar_name?: string;
    name?: string;
    description?: string;
    subtopic?: string;
}

async function decideTagOrCreate(
    essence: string,
    topMatches: PillarMatch[],
    allUserPillarSummaries: Array<{ name: string; description: string | null }>,
    groq: Groq,
): Promise<LlmTagDecision> {
    const candidatesBlock = topMatches
        .map(p => `- ${p.name} (similarity ${p.similarity.toFixed(2)}): ${p.description || '(no description)'}`)
        .join('\n');
    const fullPillarList = allUserPillarSummaries
        .map(p => `- ${p.name}: ${p.description || '(no description)'}`)
        .join('\n');

    const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: `You decide whether a new video belongs to one of a creator's existing content pillars or warrants a brand-new pillar.

CRITICAL: STRONG bias toward reuse. Your default answer is "tag". Only propose "new" when the video's domain is fundamentally different from EVERY existing pillar.

Examples of CORRECT reuse (these MUST tag, never create new):
- existing "Productivity" + video about "time blocking" → tag to Productivity
- existing "Productivity" + video about "morning routine" → tag to Productivity
- existing "Productivity" + video about "life maxxing" → tag to Productivity
- existing "Beauty" + video about "lipstick swatches" → tag to Beauty
- existing "Beauty" + video about "skincare routine" → tag to Beauty
- existing "Daily Life" + video about "a day in college" → tag to Daily Life
- existing "Daily Life" + video about "study routine" → tag to Daily Life
- existing "Daily Life" + video about "weekend in the city" → tag to Daily Life
- existing "Founder Diaries" + video about "pricing experiment" → tag to Founder Diaries

Examples where "new" is correct (genuinely different domain):
- only "Productivity" exists + video about "budget meal prep" → new "Cooking" or "Food"
- only "Beauty" exists + video about "Q1 revenue review" → new "Founder Diaries"

If you propose a NEW pillar, name it BROADLY. Never name a new pillar after a specific aspect of one video.
- ❌ "College Life" (a vlog about college life is just "Daily Life" or "Vlogs")
- ❌ "Female Voice" (a video discussing how women's voices are perceived online is just "Cultural Commentary")
- ❌ "Brand X Reviews" (one product mentioned doesn't justify a Brand X pillar — it's "Beauty" or "Reviews")

When proposing "tag", also extract the specific subtopic this video covers (1-3 words, e.g. "time blocking", "college life", "female voices online"). When proposing "new", leave subtopic empty.

Return only valid JSON.`,
            },
            {
                role: 'user',
                content: `ALL of the creator's existing pillars (you must tag against one of these unless the video is a fundamentally different domain):
${fullPillarList || '(none yet — propose new only if essence is meaningful)'}

Top semantic matches for this new video:
${candidatesBlock || '(no close matches)'}

New video essence:
${essence}

Return ONE of these JSON shapes:
{ "decision": "tag", "pillar_name": "<EXACT existing name>", "subtopic": "<1-3 words: the specific topic this video covers under that pillar>" }
OR
{ "decision": "new", "name": "<1-3 words, BROAD — distinct domain from all existing>", "description": "<one sentence>" }`,
            },
        ],
    });

    let raw = completion.choices[0]?.message?.content || '';
    raw = raw.trim();
    if (raw.startsWith('```json')) raw = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    else if (raw.startsWith('```')) raw = raw.replace(/^```\n?/, '').replace(/\n?```$/, '');

    return JSON.parse(raw) as LlmTagDecision;
}

async function appendSubtopic(
    supabase: SupabaseServer,
    pillarId: string,
    subtopic: string | undefined,
): Promise<void> {
    if (!subtopic) return;
    const clean = subtopic.trim();
    if (!clean || clean.length > 60) return;

    const { data: row } = await supabase
        .from('pillars')
        .select('subtopics')
        .eq('id', pillarId)
        .maybeSingle();
    const current: string[] = Array.isArray(row?.subtopics) ? (row!.subtopics as string[]) : [];
    const lc = clean.toLowerCase();
    if (current.some(s => s.toLowerCase() === lc)) return;
    const updated = [...current, clean].slice(0, 12);
    await supabase.from('pillars').update({ subtopics: updated }).eq('id', pillarId);
}

async function tagVideoToPillar(
    supabase: SupabaseServer,
    videoId: string,
    pillarId: string,
    subtopic?: string,
): Promise<void> {
    const { error } = await supabase
        .from('video_pillars')
        .insert({ video_id: videoId, pillar_id: pillarId });
    // Tolerate "already tagged" errors. Anything else is logged but not fatal.
    if (error && !/duplicate|unique/i.test(error.message)) {
        console.error(`video_pillars insert failed (video=${videoId}, pillar=${pillarId}):`, error.message);
    }
    await supabase
        .from('pillars')
        .update({ last_tagged_at: new Date().toISOString() })
        .eq('id', pillarId);
    await appendSubtopic(supabase, pillarId, subtopic);
}

// Steady-state per-upload decision. Returns what happened so callers can surface
// debug info if needed; never throws on routine failures (logs instead).
export async function tagOrCreatePillarsForVideo(
    args: TagOrCreateArgs,
): Promise<{ tagged: string[]; created: string[]; untagged: boolean }> {
    const { supabase, groq, userId, videoId, transcriptId } = args;
    const result = { tagged: [] as string[], created: [] as string[], untagged: false };

    // 1. Load this transcript's essence_embedding.
    const { data: transcript, error: tErr } = await supabase
        .from('transcripts')
        .select('essence, essence_embedding')
        .eq('id', transcriptId)
        .single();

    if (tErr || !transcript) {
        throw new Error(`tagOrCreate: transcript ${transcriptId} not found: ${tErr?.message}`);
    }
    const essence = (transcript.essence as string | null) || '';
    const essenceEmbedding = parseEmbedding(transcript.essence_embedding);
    if (!essence || !essenceEmbedding) {
        result.untagged = true;
        return result;
    }

    // 2. Cosine match against the user's existing pillars.
    const matches = await findSimilarPillars(supabase, userId, essenceEmbedding, TAG_AMBIGUOUS_FLOOR);
    const top = matches[0];

    // 3. Strong match → tag fast, no LLM call. (No subtopic captured here —
    //    we'd need an extra LLM call. Subtopics accrue from LLM-band uploads.)
    if (top && top.similarity >= TAG_FAST_THRESHOLD) {
        await tagVideoToPillar(supabase, videoId, top.id);
        result.tagged.push(top.id);
        const second = matches[1];
        if (
            second &&
            second.similarity >= TAG_SECOND_PILLAR_THRESHOLD &&
            (top.similarity - second.similarity) <= TAG_SECOND_PILLAR_GAP
        ) {
            await tagVideoToPillar(supabase, videoId, second.id);
            result.tagged.push(second.id);
        }
        return result;
    }

    // 4. Pull the full pillar list — LLM needs it to avoid proposing duplicates
    //    of pillars that didn't make the top-N cosine cut.
    const { data: allPillarsRaw } = await supabase
        .from('pillars')
        .select('id, name, description')
        .eq('user_id', userId);
    const allPillars = (allPillarsRaw || []).map(r => ({
        id: r.id as string,
        name: r.name as string,
        description: (r.description as string | null) || null,
    }));

    // 5. LLM decision (covers ambiguous band AND no-cosine-match cases).
    let decision: LlmTagDecision;
    try {
        decision = await decideTagOrCreate(essence, matches, allPillars, groq);
    } catch (err) {
        console.error('tag-or-create LLM decision failed:', err);
        // Fall back to cosine: any match above the ambiguous floor goes to closest;
        // otherwise leave untagged so the stale-pillar nudge can fire.
        if (top && top.similarity >= TAG_AMBIGUOUS_FLOOR) {
            await tagVideoToPillar(supabase, videoId, top.id);
            result.tagged.push(top.id);
            return result;
        }
        result.untagged = true;
        return result;
    }

    if (decision.decision === 'tag' && decision.pillar_name) {
        const matched = allPillars.find(
            p => p.name.trim().toLowerCase() === decision.pillar_name!.trim().toLowerCase(),
        );
        if (matched) {
            await tagVideoToPillar(supabase, videoId, matched.id, decision.subtopic);
            result.tagged.push(matched.id);
            return result;
        }
        // LLM hallucinated a pillar name that doesn't exactly match any existing
        // one. Their *intent* was clearly "tag" though — so instead of dropping
        // through to "new" (which would create a pillar the LLM never proposed)
        // or leaving the video untagged, fall back to the closest cosine match.
        // This is the failure mode that produced "Uncategorized" videos in
        // testing — LLM said "tag this to <something close>" but spelled it
        // wrong.
        if (top && top.similarity >= TAG_AMBIGUOUS_FLOOR) {
            await tagVideoToPillar(supabase, videoId, top.id, decision.subtopic);
            result.tagged.push(top.id);
            return result;
        }
    }

    if (decision.decision === 'new' && decision.name && decision.description) {
        const proposalName = decision.name.trim();
        const proposalDesc = decision.description.trim();
        if (!proposalName || !proposalDesc) {
            result.untagged = true;
            return result;
        }

        // Embed + dedup. Belt-and-suspenders for when the LLM ignores the
        // "don't propose duplicates" instruction.
        let proposalEmbedding: number[];
        try {
            proposalEmbedding = await embedText(`${proposalName}. ${proposalDesc}`);
        } catch (err) {
            console.error('Proposal embedding failed:', err);
            result.untagged = true;
            return result;
        }

        const dup = await findClosestPillar(supabase, userId, proposalEmbedding, PILLAR_DEDUP_COSINE_THRESHOLD);
        if (dup) {
            await tagVideoToPillar(supabase, videoId, dup.id);
            result.tagged.push(dup.id);
            return result;
        }

        const colorCombo = getCombo(allPillars.length);
        const { data: inserted, error: insertErr } = await supabase
            .from('pillars')
            .insert({
                user_id: userId,
                name: proposalName,
                description: proposalDesc,
                embedding: proposalEmbedding,
                subtopics: [],
                source: 'ai_detected',
                source_origin: 'ai_detected',
                color: colorCombo.bg,
            })
            .select('id')
            .single();

        let pillarId: string | null = null;
        if (insertErr) {
            // Race loser path: fetch by name and tag against the winner.
            const { data: existing } = await supabase
                .from('pillars')
                .select('id')
                .eq('user_id', userId)
                .ilike('name', proposalName)
                .maybeSingle();
            pillarId = existing ? (existing.id as string) : null;
        } else {
            pillarId = inserted!.id as string;
            result.created.push(pillarId);
        }

        if (pillarId) {
            await tagVideoToPillar(supabase, videoId, pillarId);
            result.tagged.push(pillarId);
            return result;
        }
    }

    // Nothing landed. Leaves the video untagged so the stale-pillar nudge can fire.
    result.untagged = true;
    return result;
}
