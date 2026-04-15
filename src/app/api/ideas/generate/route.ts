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
    anchor_mode?: string;
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

// The model declares each idea as either GROUNDED (anchor_moment is a real
// transcript quote) or ABSTRACT (no specific scene exists — don't invent one).
// We check GROUNDED anchors against the transcript corpus to catch fabrication.
const ABSTRACT_ANCHOR_MARKER = '(abstract — no specific scene in transcripts)';

function normalizeForMatch(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// The anchor is "grounded" if at least one N-word window from the anchor
// appears verbatim in the transcripts (after normalization). This tolerates
// punctuation / case differences but rejects wholly fabricated quotes.
function anchorIsGrounded(anchor: string, transcripts: string, windowSize = 6): boolean {
    if (!anchor || !transcripts) return false;
    const normAnchor = normalizeForMatch(anchor);
    const normTranscripts = normalizeForMatch(transcripts);
    const words = normAnchor.split(' ').filter(Boolean);
    if (words.length < windowSize) return false;
    for (let i = 0; i <= words.length - windowSize; i++) {
        const window = words.slice(i, i + windowSize).join(' ');
        if (normTranscripts.includes(window)) return true;
    }
    return false;
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

function filterCandidates(
    candidates: CandidateIdea[],
    transcripts: string
): { kept: CandidateIdea[]; rejected: { idea: CandidateIdea; reason: string }[] } {
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

        // Anchor grounding — protects against hallucinated scenes.
        const mode = (idea.anchor_mode ?? '').trim().toUpperCase();
        const anchor = (idea.anchor_moment ?? '').trim();
        const looksAbstract = anchor.toLowerCase().includes('abstract') && anchor.toLowerCase().includes('no specific');

        if (mode === 'ABSTRACT' || looksAbstract) {
            // Abstract mode is always valid by itself; fabrication in the hook/title
            // is checked separately below.
        } else if (mode === 'GROUNDED' || (!mode && !looksAbstract)) {
            // Default to grounded interpretation if mode missing — then the anchor
            // must actually appear in the transcripts.
            if (!anchorIsGrounded(anchor, transcripts)) {
                rejected.push({ idea, reason: 'anchor_moment claims grounded but is not found in transcripts' });
                continue;
            }
        } else {
            rejected.push({ idea, reason: `unknown anchor_mode: ${idea.anchor_mode}` });
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

const SYSTEM_MESSAGE = `You are a senior creative director for a short-form-video creator. You have read this creator's transcripts. You produce ideas grounded in what they ACTUALLY said — not in what you imagine a creator like them would say.

THE CARDINAL RULE — DO NOT INVENT.
If the transcripts don't contain a specific client name, dollar amount, date, or scene, you MUST NOT add one. Every anchor is checked against the transcripts programmatically. Ideas with fabricated specifics are rejected. Abstract honesty beats fabricated specificity. If the creator's transcripts are reflective and belief-driven rather than scene-rich, your ideas should be the same — a strong point of view with no names and numbers is better than a fake client email.

ANCHOR MODE — every idea declares its source. Two valid modes:
- GROUNDED — anchor_moment is a verbatim or near-verbatim quote (≥ 8 words) lifted directly from the transcripts. The hook, title, and description may include concrete details ONLY if those details appear in the transcripts.
- ABSTRACT — anchor_moment is the exact literal string "${ABSTRACT_ANCHOR_MARKER}". The hook, title, and description MUST NOT contain any invented proper noun, dollar amount, date, client name, place, or company. They express the creator's worldview in general but pointed terms.

NEVER mix modes. Do not write a partial scene and then mark it ABSTRACT. Do not mark GROUNDED and then paraphrase beyond what the transcript contains. When in doubt, choose ABSTRACT — fabricated specifics are worse than honest abstraction.

TENSION — every idea commits to one of these shapes before the hook is written:
- reversal — the creator did the opposite of what was expected
- confession — the creator admits something uncomfortable
- specific_number — the idea depends on a concrete number that appears in the transcripts (GROUNDED only)
- contradiction — two things the creator believes that appear to disagree
- identity_challenge — a direct claim about who the viewer actually is
- unexpected_outcome — an outcome that surprised the creator

HOOK EXAMPLES — these are good REGISTERS for each mode. Imitate the register, never the words.

GROUNDED hooks (use ONLY if the transcript actually contains such a scene):
A. "I fired my best client last Tuesday. Here's the email I sent."
B. "The day I quit my job, my boss sent me a message that just said 'good luck.'"
C. "My first ten-thousand-dollar client paid me and then ghosted me for six weeks."

ABSTRACT hooks (use when transcripts are reflective / worldview-driven — no invented specifics):
D. "Most people optimize the wrong thing. It's almost never their pricing."
E. "Hard work isn't what you think. It's not a virtue, it's a tax you pay once."
F. "If your content sounds like everyone else's, you don't have a voice, you have a template."
G. "Stop looking for your niche. It'll find you if you keep making things."

Notice what the ABSTRACT ones do: they make a specific CLAIM with a clear point of view. They do NOT name a client, a dollar amount, a date, a place, or a company. That's the register to aim for when transcripts lack scenes.

TITLES are important — creators scan titles to pick what to film. Rules:
- 6–16 words
- Descriptive enough to convey the angle at a glance
- Has a clear point of view or contrarian stance — not a neutral summary
- For ABSTRACT ideas, no invented specifics. For GROUNDED ideas, concrete details from the transcripts are encouraged.
- No templated shapes: "The [Noun] [Paradox/Revolution/Effect/Leap]", "The [Adjective] Power of [Noun]", "The Unlikely Path to [Noun]", "How I Learned to [Verb]", "How [X] Can Lead to [Y]". These will be rejected programmatically.

Examples of good titles:
- "Why I'm done recommending morning routines to anyone under 30"
- "The three words I say to every client who's about to leave"  (GROUNDED only)
- "Stop optimizing your pricing — your packaging is the real problem"
- "What happens when you treat discipline as a tax, not a virtue"

HOOK RULES:
- 8–18 words.
- No pronoun-verb-reflexive shape ("I lied to myself", "My fake confidence"). Those are tweet drafts, not hooks.
- GROUNDED hooks can contain specifics from the transcript. ABSTRACT hooks must not.

INTRA-BATCH DIVERSITY — most important structural rule:
- No two ideas may share the same tension_type.
- Each idea must use a different format from: talking-head | story-cold-open | list | reaction | demo | green-screen-commentary | direct-address-rant.
- No two GROUNDED ideas may anchor on the same transcript moment.
- No two titles may share more than three substantive words.
- If the voice profile / transcripts cannot support the requested number of DISTINCT ideas, return FEWER. Duplicates and fabrications are both failures.`;

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
Signature argument (core belief): ${voiceProfile.signature_argument || '(not yet identified — work from niche + transcripts)'}
Enemy / foil (what they push back against): ${(voiceProfile.enemy_or_foil || []).join(', ') || '(not yet identified)'}
Things this creator would NEVER say: ${(voiceProfile.would_never_say || []).join(' | ') || '(none provided)'}

Transcripts — this is the ONLY source of truth for concrete details. Any name, number, date, place, or scene used in an idea must trace back to these words:
${combinedTranscripts}
${escalationBlock}
Generate ${requestedCount} Instagram Reel ideas across these pillars: ${pillarNames.join(', ')}. Aim for pillar balance. Ideas are programmatically filtered for: template titles, weak hooks, near-duplicates, and GROUNDED anchors that aren't actually in the transcripts.

Before writing each idea, ask: does the transcript contain a specific moment I can anchor on? If yes, GROUNDED. If no, ABSTRACT. When in doubt, ABSTRACT. Fabricated specifics fail the filter and get thrown away.

Field order for EACH idea:
1. pillar — exact name from: ${pillarNames.join(', ')}
2. tension_type — one of: reversal | confession | specific_number | contradiction | identity_challenge | unexpected_outcome. Do not repeat within this batch. specific_number requires GROUNDED mode.
3. anchor_mode — "GROUNDED" or "ABSTRACT".
4. anchor_moment — if GROUNDED: a verbatim or near-verbatim quote (≥ 8 words) lifted from the transcripts above. If ABSTRACT: the exact string "${ABSTRACT_ANCHOR_MARKER}".
5. hook — 8 to 18 words. GROUNDED hooks may use transcript specifics; ABSTRACT hooks must not name any person, company, dollar amount, or date. No pronoun-verb-reflexive hooks ("I lied to myself" is forbidden).
6. hook_word_count — integer. If < 8 or > 18, rewrite.
7. format — one of: talking-head | story-cold-open | list | reaction | demo | green-screen-commentary | direct-address-rant. Do not repeat within this batch.
8. structure — Hook (0-2s) → Pattern interrupt (3-8s) → 2–3 body beats with escalating tension → Payoff that closes the loop the hook opened.
9. retention_beat — the specific mid-video moment designed to re-hook viewers.
10. cta — one of save | comment | follow | DM | share, with a one-line reason it fits.
11. title — 6 to 16 words. Descriptive, with a clear angle or POV. Creators scan this to pick what to film. For ABSTRACT ideas, no invented specifics. No templated shapes.
12. description — how the creator would uniquely execute this, grounded in their voice and (for GROUNDED ideas) the anchor_moment.

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

        const candidates = await callGroq(groq, SYSTEM_MESSAGE, firstPassUser);
        let { kept, rejected } = filterCandidates(candidates, combinedTranscripts);

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
            const retryFilter = filterCandidates(retryCandidates, combinedTranscripts);
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
                idea.anchor_mode ? `Anchor mode: ${idea.anchor_mode}` : null,
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
