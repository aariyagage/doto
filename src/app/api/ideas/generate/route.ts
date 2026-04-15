import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireEnv } from '@/lib/env';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import Groq from 'groq-sdk';

// -----------------------------------------------------------------------------
// Slop filter. The idea prompt asks the model to vary titles/hooks across a
// batch, but LLMs cluster. These checks catch the exact template patterns the
// model kept falling back to (e.g. "The X Paradox: How Y Can Lead to Z") and
// near-duplicate ideas so only distinct ideas reach the DB.
// -----------------------------------------------------------------------------

// Structural title templates we reject. We don't ban vocabulary — a title can
// contain "paradox" as a word. We ban titles whose SHAPE matches these regexes.
const TITLE_TEMPLATE_PATTERNS: RegExp[] = [
    /^The\s+\w+\s+(Paradox|Revolution|Effect|Leap|Surprise|Secret)\b/i,
    /^The\s+(Liberating|Unexpected|Surprising|Hidden|Unknown)\s+(Power|Truth|Path|Outcome|Cost|Price|Secret)\s+of\b/i,
    /^The\s+(Unlikely|Unexpected|Surprising)\s+(Path|Outcome|Road|Journey)\s+(to|of)\b/i,
    /^How\s+I\s+Learned\s+to\b/i,
    /^How\s+\w+\s+Can\s+(Lead|Transform|Change|Become)\s+(to|into)?/i,
    /\b(Paradox|Revolution|Effect|Leap)\s*:\s*How\b/i,
    /:\s*How\s+\w+\s+Can\s+(Lead|Transform|Change|Become)/i,
];

function titleLooksTemplated(title: string): boolean {
    if (!title || title.trim().length === 0) return true;
    return TITLE_TEMPLATE_PATTERNS.some((p) => p.test(title));
}

// A hook is weak if it's too short to be a real hook, OR if it's the
// "[pronoun] [verb] [reflexive]" shape the model kept producing
// ("I lied to myself", "I stopped to think", "I reversed my thinking").
function hookIsWeak(hook: string): boolean {
    if (!hook) return true;
    const cleaned = hook.trim().replace(/^["“]|["”\.]$/g, '');
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length < 6) return true;
    if (/^(i|my|we)\s+\w+\s+(my|myself|yourself|ourselves|it|this|that)\.?$/i.test(cleaned)) return true;
    return false;
}

// Very small stopword list — removing only the words that inflate Jaccard
// similarity between unrelated sentences.
const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
    'by', 'from', 'is', 'it', 'as', 'my', 'me', 'we', 'our', 'you', 'your', 'i',
    'can', 'will', 'has', 'have', 'had', 'was', 'were', 'be', 'been', 'this', 'that',
    'how', 'when', 'where', 'why', 'what', 'who', 'not', 'no', 'so', 'if', 'do', 'did',
]);

function contentWords(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let intersection = 0;
    for (const word of a) if (b.has(word)) intersection += 1;
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

interface CandidateIdea {
    pillar?: string;
    tension_type?: string;
    anchor_moment?: string;
    hook?: string;
    format?: string;
    structure?: string;
    retention_beat?: string;
    cta?: string;
    title?: string;
    description?: string;
    reasoning?: string;
}

// Remove ideas whose combined title+hook is too close (by Jaccard) to any
// already-kept idea. First one wins.
function dedupeBySimilarity(ideas: CandidateIdea[], threshold = 0.45): CandidateIdea[] {
    const kept: { idea: CandidateIdea; words: Set<string> }[] = [];
    for (const idea of ideas) {
        const fingerprint = contentWords(`${idea.title ?? ''} ${idea.hook ?? ''} ${idea.anchor_moment ?? ''}`);
        const duplicate = kept.some((k) => jaccardSimilarity(fingerprint, k.words) >= threshold);
        if (!duplicate) kept.push({ idea, words: fingerprint });
    }
    return kept.map((k) => k.idea);
}

function filterCandidates(candidates: CandidateIdea[]): { kept: CandidateIdea[]; rejected: { idea: CandidateIdea; reason: string }[] } {
    const rejected: { idea: CandidateIdea; reason: string }[] = [];
    const firstPass: CandidateIdea[] = [];
    for (const idea of candidates) {
        if (titleLooksTemplated(idea.title ?? '')) {
            rejected.push({ idea, reason: 'title matches a templated shape' });
            continue;
        }
        if (hookIsWeak(idea.hook ?? '')) {
            rejected.push({ idea, reason: 'hook too short or pronoun-verb-reflexive shape' });
            continue;
        }
        firstPass.push(idea);
    }
    const deduped = dedupeBySimilarity(firstPass);
    const droppedAsDuplicate = firstPass.filter((i) => !deduped.includes(i));
    for (const d of droppedAsDuplicate) rejected.push({ idea: d, reason: 'too similar to an idea already kept' });
    return { kept: deduped, rejected };
}

// -----------------------------------------------------------------------------
// Prompt construction. Kept as functions so a retry pass can reuse the base
// prompt and append an escalation nudge without duplicating strings.
// -----------------------------------------------------------------------------

const SYSTEM_MESSAGE = `You are a senior creative director for a short-form-video creator. You have read this creator's transcripts and studied how they actually think and speak. You do not produce "content ideas" that sound like a LinkedIn post factory. You produce ideas only this creator could make, rooted in specific moments from their own life.

TENSION — every idea must commit to one of these shapes before the hook is written:
- reversal — the creator did the opposite of what was expected
- confession — the creator admits something uncomfortable and specific
- specific_number — the idea hangs on a concrete dollar amount, day count, or metric from the transcripts
- contradiction — two things the creator believes that appear to disagree
- identity_challenge — a direct claim about who the viewer actually is
- unexpected_outcome — a concrete outcome that surprised the creator

WORKED HOOK EXAMPLES (study the shape, specificity, and rhythm — imitate the REGISTER, not the words):
1. "My therapist told me I was lying to myself. I was furious. She was right."
2. "Ben Francis built Gymshark from a garage. I built mine in the back of a Corolla."
3. "I fired my best client last Tuesday. Here's the email I sent."
4. "If your content sounds like a LinkedIn post, you don't have a voice — you have a template."
5. "I wrote for three hours every day for a year. My writing got worse."
6. "You're optimizing the wrong thing. It's not your pricing. It's not your product."
7. "Productivity gurus will tell you to wake up at 5am. I sleep until 10 and made $400K last year."
8. "The first client who ever paid me $10,000 sent an email at 2am that just said 'ok.'"

Notice what these share: specific proper nouns, specific numbers, specific scenes, concrete objects, a clear turn. Notice what they do NOT share: any template structure, any repeated grammar, any abstract "X paradox" framing.

HARD RULES — break any of these and the idea is wrong:
- If a generic creator with a different worldview could make this same idea, it is wrong. Rewrite.
- If you cannot hear this exact creator saying the hook out loud, it is wrong. Rewrite.
- "Title" is an internal working name for the creator, NOT a blog headline. 3–8 words. Functional, not SEO. No subtitles, no colons introducing a "How X Can Lead to Y" clause.
- No title may start with the patterns: "The [Noun] [Paradox/Revolution/Effect/Leap]", "The [Adjective] Power of", "The Unlikely Path to", "How I Learned to", "How [X] Can Lead to". Those are lazy templates. Titles that match will be rejected programmatically.
- Hooks are 8–18 words. Must contain at least one: (a) proper noun, (b) specific number, (c) concrete sensory detail, (d) named person. No pronoun-verb-reflexive hooks like "I lied to myself" or "My fake confidence" — those are tweet drafts, not hooks.

INTRA-BATCH DIVERSITY — this is the most important rule. These ideas are produced as a BATCH. Within one batch:
- No two ideas may share the same tension_type.
- Each idea must anchor on a different transcript moment (different story, client, scene).
- Each idea must use a different format from: talking-head | story-cold-open | list | reaction | demo | green-screen-commentary | direct-address-rant.
- No two titles may share more than three substantive words (excluding articles, prepositions).
- No two hooks may describe the same event or use the same proper noun / number.

If you cannot generate that many distinct ideas from the source material, return FEWER ideas. Duplicates are worse than a short list.`;

function buildUserMessage(params: {
    voiceProfile: VoiceProfileRow;
    combinedTranscripts: string;
    pillarNames: string[];
    requestedCount: number;
    escalation?: string;
}): string {
    const { voiceProfile, combinedTranscripts, pillarNames, requestedCount, escalation } = params;
    const escalationBlock = escalation ? `\n\nPREVIOUS ATTEMPT FAILED FILTER — ${escalation}\n` : '';
    return `Creator voice profile:
Niche: ${voiceProfile.niche_summary ?? '(none)'}
Tone: ${(voiceProfile.tone_descriptors || []).join(', ') || '(none)'}
Style: ${voiceProfile.content_style ?? '(none)'}
Phrases they actually say: ${(voiceProfile.recurring_phrases || []).join(', ') || '(none)'}
Signature argument (core belief — every idea must depend on this being true): ${voiceProfile.signature_argument || '(not yet identified)'}
Enemy / foil (what they push back against): ${(voiceProfile.enemy_or_foil || []).join(', ') || '(not yet identified)'}
Things this creator would NEVER say: ${(voiceProfile.would_never_say || []).join(' | ') || '(none provided)'}

Sample transcripts from their content (mine these for real moments — specific clients, numbers, places, people, mistakes):
${combinedTranscripts}
${escalationBlock}
Generate ${requestedCount} Instagram Reel ideas distributed across these content pillars: ${pillarNames.join(', ')}. Aim for pillar balance — do not stack ideas in the most obvious pillar. Ideas will be programmatically filtered for template titles, weak hooks, and near-duplicates. Ideas that fail those filters are thrown away.

For EACH idea, fill the JSON fields in this exact order. Commit to pillar, tension_type, and anchor_moment BEFORE writing the hook — the hook must flow from the anchor.

Field order:
1. pillar — exact name from: ${pillarNames.join(', ')}
2. tension_type — one of: reversal | confession | specific_number | contradiction | identity_challenge | unexpected_outcome. DO NOT repeat a tension_type within this batch.
3. anchor_moment — one short sentence quoting or paraphrasing a specific transcript moment this idea is built on. MUST be different from the anchor_moment of every other idea in this batch.
4. hook — 8 to 18 words. The literal first sentence the creator would say out loud. Must contain a proper noun OR a specific number OR a concrete sensory detail OR a named person. No pronoun-verb-reflexive shape ("I lied to myself" is forbidden).
5. hook_word_count — integer. If < 8 or > 18, rewrite the hook before continuing.
6. format — one of: talking-head | story-cold-open | list | reaction | demo | green-screen-commentary | direct-address-rant. DO NOT repeat a format within this batch.
7. structure — Hook (0-2s) → Pattern interrupt (3-8s) → 2–3 body beats with escalating tension → Payoff that closes the loop the hook opened.
8. retention_beat — the specific mid-video moment designed to re-hook viewers about to scroll.
9. cta — one of save | comment | follow | DM | share, with a one-line reason it fits this idea.
10. title — 3–8 words. Internal working name, not a blog headline. No subtitles. No "The X Paradox" template. Avoid abstract-noun colon-how patterns.
11. description — how the creator would uniquely execute this, anchored on the anchor_moment and their voice.

Return ONLY a JSON object with this exact shape:
{ "ideas": [ { ...all fields above... }, ... ] }`;
}

type VoiceProfileRow = {
    niche_summary?: string | null;
    tone_descriptors?: string[] | null;
    content_style?: string | null;
    recurring_phrases?: string[] | null;
    signature_argument?: string | null;
    enemy_or_foil?: string[] | null;
    would_never_say?: string[] | null;
};

async function callGroq(groq: Groq, systemMessage: string, userMessage: string): Promise<CandidateIdea[]> {
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
    if (Array.isArray(parsed)) return parsed as CandidateIdea[];
    if (parsed && Array.isArray(parsed.ideas)) return parsed.ideas as CandidateIdea[];
    if (parsed && typeof parsed === 'object') return [parsed as CandidateIdea];
    return [];
}

export async function POST(request: Request) {
    try {
        const supabase = createClient();

        // 1. Auth
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const rl = rateLimit({ key: `ideas-generate:${user.id}`, ...RATE_LIMITS.llmGeneration });
        if (!rl.ok) {
            return NextResponse.json(
                { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
            );
        }

        // 2. Optional body params
        let body: { pillar_ids?: unknown; count?: unknown } = {};
        try {
            body = await request.json();
        } catch {
            // body is optional
        }
        const pillar_ids: string[] = Array.isArray(body.pillar_ids) ? (body.pillar_ids as string[]) : [];
        const requestedCount = Math.min(Number(body.count) || 5, 10);

        // 3. Voice profile
        const { data: voiceProfile, error: vpError } = await supabase
            .from('voice_profile')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (vpError || !voiceProfile) {
            return NextResponse.json({ error: 'No voice profile found. Upload videos first.' }, { status: 400 });
        }

        // 4. Pillars
        let pillarsQuery = supabase.from('pillars').select('id, name').eq('user_id', user.id);
        if (pillar_ids.length > 0) pillarsQuery = pillarsQuery.in('id', pillar_ids);
        const { data: pillars, error: pillarsError } = await pillarsQuery;
        if (pillarsError) throw new Error(`Failed to fetch pillars: ${pillarsError.message}`);
        const pillarNames = pillars?.map((p) => p.name) || [];

        // 5. Transcripts
        let transcriptsData: { raw_text: string; word_count: number }[] = [];
        if (pillar_ids.length > 0) {
            const { data: vpData, error: vpErr } = await supabase
                .from('video_pillars')
                .select('video_id')
                .in('pillar_id', pillar_ids);
            if (vpErr) throw new Error(`Failed to fetch video_pillars: ${vpErr.message}`);
            const videoIds = vpData?.map((vp) => vp.video_id) || [];
            if (videoIds.length > 0) {
                const { data: tData, error: tErr } = await supabase
                    .from('transcripts')
                    .select('raw_text, word_count')
                    .eq('user_id', user.id)
                    .in('video_id', videoIds)
                    .order('word_count', { ascending: false })
                    .limit(10);
                if (tErr) throw new Error(`Failed to fetch transcripts: ${tErr.message}`);
                transcriptsData = tData || [];
            }
        } else {
            const { data: tData, error: tErr } = await supabase
                .from('transcripts')
                .select('raw_text, word_count')
                .eq('user_id', user.id)
                .order('word_count', { ascending: false })
                .limit(10);
            if (tErr) throw new Error(`Failed to fetch transcripts: ${tErr.message}`);
            transcriptsData = tData || [];
        }

        const top3 = transcriptsData.slice(0, 3);
        let combinedTranscripts = top3.map((t) => t.raw_text).join('\n---\n');
        if (combinedTranscripts.length > 4000) combinedTranscripts = combinedTranscripts.substring(0, 4000);

        // 6. Two-pass generation: over-generate, filter, retry once if short.
        const overGenerateCount = Math.min(requestedCount + 4, 12);
        const groq = new Groq({ apiKey: requireEnv('GROQ_API_KEY') });

        const firstPassUser = buildUserMessage({
            voiceProfile: voiceProfile as VoiceProfileRow,
            combinedTranscripts,
            pillarNames,
            requestedCount: overGenerateCount,
        });

        let candidates = await callGroq(groq, SYSTEM_MESSAGE, firstPassUser);
        let { kept, rejected } = filterCandidates(candidates);

        console.log(
            `ideas/generate pass 1 — candidates=${candidates.length} kept=${kept.length} rejected=${rejected.length}`
        );

        // If first pass yields fewer than requested, escalate once.
        if (kept.length < requestedCount) {
            const rejectReasons = rejected.slice(0, 3).map((r) => `"${(r.idea.title || '').slice(0, 60)}" — ${r.reason}`).join('; ');
            const escalation = `${rejected.length} ideas were thrown out (e.g. ${rejectReasons}). Try again. Push harder on divergence. Each idea must be about a meaningfully different moment or belief, not a rewording. If you only have source material for ${kept.length} good ideas, return that many — do not pad with variations.`;

            const retryUser = buildUserMessage({
                voiceProfile: voiceProfile as VoiceProfileRow,
                combinedTranscripts,
                pillarNames,
                requestedCount: overGenerateCount,
                escalation,
            });
            const retryCandidates = await callGroq(groq, SYSTEM_MESSAGE, retryUser);
            const retryFilter = filterCandidates(retryCandidates);
            console.log(
                `ideas/generate pass 2 — candidates=${retryCandidates.length} kept=${retryFilter.kept.length} rejected=${retryFilter.rejected.length}`
            );
            // Merge pass 1 + pass 2 kept, then dedupe across the full merged set.
            const merged = dedupeBySimilarity([...kept, ...retryFilter.kept]);
            kept = merged;
            rejected = [...rejected, ...retryFilter.rejected];
        }

        // Trim to the requested count.
        const finalIdeas = kept.slice(0, requestedCount);

        if (finalIdeas.length === 0) {
            return NextResponse.json(
                { error: 'Could not generate any distinct ideas. Try again or upload more varied transcripts.' },
                { status: 502 }
            );
        }

        // 7. Insert into content_ideas
        const insertedIdeas = [];
        const insertErrors: { title: string | undefined; error: string; code?: string; details?: string | null; hint?: string | null }[] = [];

        for (const idea of finalIdeas) {
            const cleanIdeaPillar = idea.pillar?.trim().toLowerCase() || '';
            const matchedPillar = pillars?.find((p) => p.name.trim().toLowerCase() === cleanIdeaPillar);
            const pillar_id = matchedPillar ? matchedPillar.id : null;

            const reasoningParts = [
                idea.description || idea.reasoning,
                idea.tension_type ? `Tension: ${idea.tension_type}` : null,
                idea.anchor_moment ? `Anchor moment: ${idea.anchor_moment}` : null,
                idea.format ? `Format: ${idea.format}` : null,
                idea.retention_beat ? `Retention beat: ${idea.retention_beat}` : null,
                idea.cta ? `CTA: ${idea.cta}` : null,
            ].filter(Boolean);

            const { data: inserted, error: insertError } = await supabase
                .from('content_ideas')
                .insert({
                    user_id: user.id,
                    title: idea.title,
                    hook: idea.hook,
                    structure: idea.structure,
                    reasoning: reasoningParts.join('\n\n'),
                    pillar_id,
                    is_saved: false,
                    is_used: false,
                })
                .select()
                .single();

            if (insertError) {
                console.error('Failed to insert idea:', JSON.stringify(insertError));
                insertErrors.push({
                    title: idea.title,
                    error: insertError.message,
                    code: insertError.code,
                    details: insertError.details,
                    hint: insertError.hint,
                });
            } else if (inserted) {
                insertedIdeas.push(inserted);
            }
        }

        console.log(
            `ideas/generate summary — requested=${requestedCount} final=${finalIdeas.length} inserted=${insertedIdeas.length} failed=${insertErrors.length} total_rejected=${rejected.length}`
        );

        if (finalIdeas.length > 0 && insertedIdeas.length === 0) {
            const first = insertErrors[0];
            return NextResponse.json(
                {
                    error: `Generated ${finalIdeas.length} ideas but Supabase rejected all inserts. First error: ${first?.error || 'unknown'}`,
                    code: first?.code,
                    details: first?.details,
                    hint: first?.hint,
                    allErrors: insertErrors,
                },
                { status: 500 }
            );
        }

        return NextResponse.json(insertedIdeas);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Idea generator error:', err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
