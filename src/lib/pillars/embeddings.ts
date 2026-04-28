import { requireEnv } from '@/lib/env';

const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

// HuggingFace cold-start sometimes 503s for ~20s while the model loads. We retry
// three times before giving up so the caller can decide whether the failure is
// fatal (e.g. essence persistence) or non-fatal (e.g. background backfill).
export async function embedText(text: string): Promise<number[]> {
    const hfToken = requireEnv('HF_API_TOKEN');
    const { HfInference } = await import('@huggingface/inference');
    const hf = new HfInference(hfToken);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const result = await hf.featureExtraction({
                model: EMBEDDING_MODEL,
                inputs: text,
            });

            let vec: number[] | null = null;
            if (Array.isArray(result) && Array.isArray(result[0])) {
                vec = result[0] as number[];
            } else if (Array.isArray(result)) {
                vec = result as number[];
            }
            if (!vec) throw new Error('Unexpected embedding response shape.');
            if (vec.length !== EMBEDDING_DIM) {
                throw new Error(`Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${vec.length}`);
            }
            return vec;
        } catch (err: unknown) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            const code = (err as { statusCode?: number })?.statusCode;
            const isColdStart = code === 503 || msg.includes('503');
            if (!isColdStart || attempt === 3) break;
            await new Promise(r => setTimeout(r, 20_000));
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Embedding failed after retries.');
}

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error(`Cosine length mismatch: ${a.length} vs ${b.length}`);
    }
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// supabase-js returns pgvector columns as JSON-encoded strings ("[0.1,0.2,...]")
// rather than parsed arrays. This helper accepts both forms so consumers can
// stop caring which they got. Returns null when the value is missing or malformed.
export function parseEmbedding(value: unknown): number[] | null {
    if (value == null) return null;
    if (Array.isArray(value)) {
        return value.length > 0 ? (value as number[]) : null;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed as number[];
        } catch {
            // fall through
        }
    }
    return null;
}
