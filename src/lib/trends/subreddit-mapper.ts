import { embedText, cosineSimilarity } from '@/lib/pillars/embeddings';
import { SUBREDDITS, type Subreddit } from './subreddits';

// Mirrors industry-mapper.ts. Subreddit descriptions are static, so we embed
// them lazily on first call and reuse for the lifetime of the process.
let subredditEmbeddingsPromise: Promise<{ subreddit: Subreddit; embedding: number[] }[]> | null = null;

async function getSubredditEmbeddings() {
    if (!subredditEmbeddingsPromise) {
        subredditEmbeddingsPromise = (async () => {
            const results = await Promise.all(
                SUBREDDITS.map(async (s) => ({
                    subreddit: s,
                    embedding: await embedText(`r/${s.name}. ${s.description}`),
                })),
            );
            return results;
        })().catch((err) => {
            subredditEmbeddingsPromise = null;
            throw err;
        });
    }
    return subredditEmbeddingsPromise;
}

const TOP_K = 3;
// Lower than the TikTok industry threshold because Reddit is the FALLBACK
// source — we'd rather show some Reddit signal than nothing. Anything above
// 0.30 means at least one sub clearly relates to the pillar.
const MIN_SCORE = 0.30;

export type SubredditMatch = {
    subreddits: string[];        // names, ordered best-first
    topScore: number;
};

export async function mapPillarToSubreddits(
    pillarName: string,
    pillarDescription: string | null,
): Promise<SubredditMatch | null> {
    const text = pillarDescription
        ? `${pillarName}. ${pillarDescription}`
        : pillarName;

    const [pillarEmbedding, subredditEmbeddings] = await Promise.all([
        embedText(text),
        getSubredditEmbeddings(),
    ]);

    const scored = subredditEmbeddings
        .map(({ subreddit, embedding }) => ({
            subreddit,
            score: cosineSimilarity(pillarEmbedding, embedding),
        }))
        .sort((a, b) => b.score - a.score);

    const top = scored[0];
    if (!top || top.score < MIN_SCORE) return null;

    return {
        subreddits: scored.slice(0, TOP_K).map(s => s.subreddit.name),
        topScore: top.score,
    };
}
