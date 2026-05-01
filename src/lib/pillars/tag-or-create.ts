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
                content: `You decide which content pillar (folder) a new video belongs in. Either it fits an existing pillar (tag it there) or it's a genuinely different domain (create a new pillar with a BROAD name).

CRITICAL: STRONG bias toward reuse. Default to "tag" if any existing pillar is a reasonable home — even if the fit is loose. Only propose "new" when the video's domain is fundamentally different from EVERY existing pillar.

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
- only "Vlogs" exists + video about "AI and originality" → new "Cultural Commentary"
- (no pillars exist yet) + ANY video → new (use a broad name like "Vlogs", "Productivity", "Cultural Commentary")

NEW PILLAR NAMING RULES (when proposing "new"):
- 1-3 words. Title Case. Broad enough to host future videos in the same vein.
- ✅ "Vlogs", "Productivity", "Beauty", "Cultural Commentary", "Founder Diaries", "Daily Life", "Cooking", "Creative Thinking"
- ❌ "College Life" (a college vlog is just "Daily Life" or "Vlogs")
- ❌ "Female Voice" (a video discussing women's voices online is just "Cultural Commentary")
- ❌ "Brand X Reviews" (one product mentioned doesn't justify a Brand X pillar — it's "Beauty" or "Reviews")
- ❌ "Morning Routines" (that's a subtopic of "Productivity")

When proposing "tag", also extract the specific subtopic this video covers (1-3 words, e.g. "time blocking", "college life", "female voices online"). When proposing "new", leave subtopic empty — the broad pillar can accumulate subtopics later.

Return only valid JSON.`,
            },
            {
                role: 'user',
                content: `ALL of the creator's existing pillars (you must tag against one of these unless the video is a fundamentally different domain):
${fullPillarList || '(none yet — propose new with a BROAD name)'}

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

export async function appendSubtopic(
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

// Shared by tag-or-create's fast / LLM paths AND by series-detector. Centralizing
// the insert + last_tagged_at + subtopic appending here means a future change
// (e.g. logging, telemetry, retry) only needs to land in one place.
export async function tagVideoToPillar(
    supabase: SupabaseServer,
    videoId: string,
    pillarId: string,
    subtopic?: string,
): Promise<void> {
    const { error } = await supabase
        .from('video_pillars')
        .insert({ video_id: videoId, pillar_id: pillarId });
    // Tolerate "already tagged" errors (the DB has a UNIQUE(video_id, pillar_id)
    // constraint as of migration 005, so a redundant insert raises 23505 here).
    // Anything else is logged but not fatal.
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

    // 1. Load this transcript's essence + embedding + topic. essence_topic
    //    feeds straight into pillars.subtopics so the "don't retread" rule in
    //    idea generation actually has data to work with — even on the fast-tag
    //    path that bypasses the LLM.
    const { data: transcript, error: tErr } = await supabase
        .from('transcripts')
        .select('essence, essence_embedding, essence_topic')
        .eq('id', transcriptId)
        .single();

    if (tErr || !transcript) {
        throw new Error(`tagOrCreate: transcript ${transcriptId} not found: ${tErr?.message}`);
    }
    const essence = (transcript.essence as string | null) || '';
    const essenceEmbedding = parseEmbedding(transcript.essence_embedding);
    const transcriptTopic = (transcript.essence_topic as string | null) || undefined;
    if (!essence || !essenceEmbedding) {
        console.warn(`tag-or-create video=${videoId}: missing essence or embedding, leaving untagged`);
        result.untagged = true;
        return result;
    }

    // 2. Cosine match against the user's existing pillars.
    const matches = await findSimilarPillars(supabase, userId, essenceEmbedding, TAG_AMBIGUOUS_FLOOR);
    const top = matches[0];
    console.log(`tag-or-create video=${videoId}: top cosine match = ${top ? `${top.name} (${top.similarity.toFixed(3)})` : 'none above floor'}`);

    // 3. Strong match → tag fast, no LLM call. We pass the v2-essence topic
    //    so subtopics still accumulate without a Groq call. Pre-v2 transcripts
    //    have no topic; appendSubtopic short-circuits cleanly on undefined.
    if (top && top.similarity >= TAG_FAST_THRESHOLD) {
        await tagVideoToPillar(supabase, videoId, top.id, transcriptTopic);
        result.tagged.push(top.id);
        console.log(`tag-or-create video=${videoId}: fast-tagged to ${top.name}`);
        const second = matches[1];
        if (
            second &&
            second.similarity >= TAG_SECOND_PILLAR_THRESHOLD &&
            (top.similarity - second.similarity) <= TAG_SECOND_PILLAR_GAP
        ) {
            await tagVideoToPillar(supabase, videoId, second.id, transcriptTopic);
            result.tagged.push(second.id);
            console.log(`tag-or-create video=${videoId}: also multi-tagged to ${second.name}`);
        }
        return result;
    }

    // 4. Ambiguous band OR no existing pillars at all. Ask the LLM to pick an
    //    existing pillar OR propose a new BROAD one. Pulls full pillar list so
    //    the LLM can't dupe a pillar that didn't make the cosine top-N.
    const { data: allPillarsRaw } = await supabase
        .from('pillars')
        .select('id, name, description')
        .eq('user_id', userId);
    const allPillars = (allPillarsRaw || []).map(r => ({
        id: r.id as string,
        name: r.name as string,
        description: (r.description as string | null) || null,
    }));

    // Local helper so every fallback path uses the same lenient cosine rescue.
    // If we have ANY cosine match above the ambiguous floor, that pillar is a
    // better home than Uncategorized — use it instead of dropping the video.
    const cosineFallback = async (subtopicHint?: string): Promise<boolean> => {
        if (top && top.similarity >= TAG_AMBIGUOUS_FLOOR) {
            await tagVideoToPillar(supabase, videoId, top.id, subtopicHint || transcriptTopic);
            result.tagged.push(top.id);
            console.log(`tag-or-create video=${videoId}: cosine-fallback-tagged to ${top.name}`);
            return true;
        }
        return false;
    };

    let decision: LlmTagDecision;
    try {
        decision = await decideTagOrCreate(essence, matches, allPillars, groq);
    } catch (err) {
        console.error(`tag-or-create video=${videoId}: LLM decision threw, trying cosine fallback:`, err);
        if (await cosineFallback()) return result;
        result.untagged = true;
        return result;
    }
    console.log(`tag-or-create video=${videoId}: LLM decision = ${decision.decision}${decision.pillar_name ? ` → ${decision.pillar_name}` : ''}${decision.name ? ` → new "${decision.name}"` : ''}`);

    if (decision.decision === 'tag' && decision.pillar_name) {
        const matched = allPillars.find(
            p => p.name.trim().toLowerCase() === decision.pillar_name!.trim().toLowerCase(),
        );
        if (matched) {
            await tagVideoToPillar(supabase, videoId, matched.id, decision.subtopic || transcriptTopic);
            result.tagged.push(matched.id);
            console.log(`tag-or-create video=${videoId}: LLM-tagged to ${matched.name}`);
            return result;
        }
        // LLM intended "tag" but spelled the pillar name wrong. Cosine fallback.
        if (await cosineFallback(decision.subtopic)) return result;
    }

    if (decision.decision === 'new' && decision.name && decision.description) {
        const proposalName = decision.name.trim();
        const proposalDesc = decision.description.trim();
        if (proposalName && proposalDesc) {
            // Embed + dedup. If the LLM proposed a name that's semantically the
            // same as an existing pillar (≥ PILLAR_DEDUP_COSINE_THRESHOLD), tag
            // against the existing one rather than spawning a near-duplicate.
            let proposalEmbedding: number[] | null = null;
            try {
                proposalEmbedding = await embedText(`${proposalName}. ${proposalDesc}`);
            } catch (err) {
                console.error(`tag-or-create video=${videoId}: proposal embedding failed:`, err);
            }

            if (proposalEmbedding) {
                const dup = await findClosestPillar(supabase, userId, proposalEmbedding, PILLAR_DEDUP_COSINE_THRESHOLD);
                if (dup) {
                    await tagVideoToPillar(supabase, videoId, dup.id, transcriptTopic);
                    result.tagged.push(dup.id);
                    console.log(`tag-or-create video=${videoId}: proposal "${proposalName}" deduped to existing ${dup.name}`);
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
                        subtopics: transcriptTopic ? [transcriptTopic] : [],
                        source: 'ai_detected',
                        source_origin: 'ai_detected',
                        color: colorCombo.bg,
                    })
                    .select('id')
                    .single();

                let pillarId: string | null = null;
                if (insertErr) {
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
                    console.log(`tag-or-create video=${videoId}: created new pillar "${proposalName}"`);
                }

                if (pillarId) {
                    await tagVideoToPillar(supabase, videoId, pillarId, transcriptTopic);
                    result.tagged.push(pillarId);
                    return result;
                }
            }
        }

        // New-pillar branch failed (embedding unavailable, insert raced and
        // race-recovery fetch returned nothing). Try cosine fallback so we
        // don't lose the video to Uncategorized over an HF outage.
        if (await cosineFallback()) return result;
    }

    // LAST RESORT: every prior path failed. If we have ANY cosine match above
    // the ambiguous floor, use it. This catches cases where the LLM returned
    // a malformed decision shape that didn't satisfy either branch above.
    if (await cosineFallback()) return result;

    console.warn(`tag-or-create video=${videoId}: no path produced a tag, leaving untagged`);
    result.untagged = true;
    return result;
}
