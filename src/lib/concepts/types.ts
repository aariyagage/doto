// Domain types for the concepts pipeline.
//
// Mirrors migrations/008_concepts_workspace.sql, 009_concept_events.sql,
// 010_pipeline_runs.sql. When the schema changes, update both ends.
//
// Voice profile is intentionally NOT imported here — only the stylist (PASS 3)
// and refiner (PASS 4) read voice profile, and they import the existing
// V2VoiceProfile type from src/lib/ideas/v2/idea-prompt.ts.

export type ConceptStatus =
    | 'draft'
    | 'reviewed'
    | 'saved'
    | 'used'
    | 'rejected'
    | 'archived';

export type ConceptSourceKind =
    | 'brainstorm'
    | 'transcript'
    | 'trend'
    | 'manual'
    | 'autogen';

export type BrainstormStatus = 'inbox' | 'clustered' | 'converted' | 'archived';

export type PipelineRunKind =
    | 'upload'
    | 'generate'
    | 'expand'
    | 'validate'
    | 'style'
    | 'refine'
    | 'research'
    | 'cluster'
    | 'topup'
    | 'import_legacy';

export type PipelineRunStatus = 'running' | 'succeeded' | 'failed';

export type PipelineErrorKind =
    | 'rate_limit'
    | 'timeout'
    | '5xx'
    | 'parse_error'
    | 'validation'
    | 'unknown';

export type ConceptEventType =
    | 'created'
    | 'validated'
    | 'styled'
    | 'reviewed'
    | 'saved'
    | 'used'
    | 'rejected'
    | 'archived'
    | 'edited'
    | 'refined';

// 0..1 score components produced by the validator (PASS 2). Composite is the
// validator's weighted combo: 0.4 novelty + 0.35 fit + 0.25 specificity.
export interface ConceptScore {
    novelty: number;
    fit: number;
    specificity: number;
    composite: number;
}

// Persisted shape (matches the concepts table). Some fields are nullable
// because they're populated by later passes (voice_adapted_*) or by
// downstream actions (saved_at, used_at, etc.).
export interface Concept {
    id: string;
    user_id: string;
    pillar_id: string | null;

    title: string;
    hook: string | null;
    angle: string | null;
    structure: unknown | null; // jsonb

    research_summary: string | null;
    ai_reason: string | null;
    score: ConceptScore | null;

    voice_adapted_title: string | null;
    voice_adapted_hook: string | null;
    voice_adapted_text: string | null;

    status: ConceptStatus;

    source_kind: ConceptSourceKind;
    source_brainstorm_id: string | null;
    source_transcript_id: string | null;
    source_trend_hashtag: string | null;
    source_trend_reddit_post: string | null;
    source_content_idea_id: string | null;

    concept_embedding: number[] | null;
    pipeline_run_id: string | null;

    created_at: string;
    updated_at: string;
    reviewed_at: string | null;
    saved_at: string | null;
    used_at: string | null;
}

export interface BrainstormNote {
    id: string;
    user_id: string;
    raw_text: string;
    expanded_text: string | null;
    cluster_id: string | null;
    pillar_id: string | null;
    note_embedding: number[] | null;
    status: BrainstormStatus;
    converted_concept_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface ConceptEvent {
    id: number;
    user_id: string;
    concept_id: string;
    event_type: ConceptEventType;
    from_status: ConceptStatus | null;
    to_status: ConceptStatus | null;
    metadata: unknown | null;
    created_at: string;
}

export interface PipelineRun {
    id: string;
    user_id: string;
    kind: PipelineRunKind;
    status: PipelineRunStatus;
    groq_calls: number;
    hf_calls: number;
    tokens_in: number | null;
    tokens_out: number | null;
    latency_ms: number | null;
    error_kind: PipelineErrorKind | null;
    metadata: unknown | null;
    created_at: string;
    finished_at: string | null;
}

// ---- Pipeline pass I/O shapes --------------------------------------------

// PASS 1 output (one entry per generated candidate, before scoring/dedup).
export interface ConceptCandidate {
    title: string;
    hook: string;
    angle: string;
    structure: unknown; // free-form jsonb; LLM is asked to produce a small object
    ai_reason: string;
}

// PASS 2 output for a single candidate.
export interface ValidatorOutput {
    id: string; // candidate id passed in by the caller (we use index strings)
    scores: ConceptScore;
    keep: boolean;
    reject_reason?: string;
}

// PASS 3 output.
export interface StylistOutput {
    voice_adapted_title: string;
    voice_adapted_hook: string;
    voice_adapted_text: string;
}

// Seed for PASS 1 — the optional starting point that biases generation.
export type ConceptSeed =
    | { kind: 'brainstorm'; ref_id: string; raw_text: string }
    | { kind: 'transcript'; ref_id: string; essence: string }
    | { kind: 'trend'; ref_id: string; label: string }
    | null;

// What concept-generator returns to the orchestrator before validation.
export interface GeneratorResult {
    candidates: ConceptCandidate[];
    candidateEmbeddings: number[][]; // parallel to candidates; same length
    groqCalls: number;
    hfCalls: number;
}

// Dedup decision per candidate.
export interface DedupDecision {
    keep: boolean;
    reason?: 'cosine_self' | 'cosine_saved_concept' | 'cosine_saved_idea';
    againstId?: string;
    similarity?: number;
}
