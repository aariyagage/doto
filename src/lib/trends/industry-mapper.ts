import { embedText, cosineSimilarity } from '@/lib/pillars/embeddings';
import { TIKTOK_INDUSTRIES, type TikTokIndustry } from './industries';

// Computed once per process. The 18 industry descriptions are static, so we
// embed them lazily on first call and cache in module scope. Serverless cold
// starts will pay this once (~5-15s with HF cold start), then it's free for
// the lifetime of the function instance.
let industryEmbeddingsPromise: Promise<{ industry: TikTokIndustry; embedding: number[] }[]> | null = null;

async function getIndustryEmbeddings() {
    if (!industryEmbeddingsPromise) {
        industryEmbeddingsPromise = (async () => {
            const results = await Promise.all(
                TIKTOK_INDUSTRIES.map(async (industry) => ({
                    industry,
                    embedding: await embedText(`${industry.name}. ${industry.description}`),
                })),
            );
            return results;
        })().catch((err) => {
            // If the batch fails, drop the cached promise so the next call retries.
            industryEmbeddingsPromise = null;
            throw err;
        });
    }
    return industryEmbeddingsPromise;
}

export type PillarIndustryMatch = {
    primary: TikTokIndustry;
    secondary: TikTokIndustry | null;
    primaryScore: number;
    secondaryScore: number | null;
};

// Below this cosine, even the top match is too weak to be useful. The pillar
// will be left unmapped and the trends panel will prompt the user to pick one
// manually. 0.35 chosen empirically — same MiniLM-L6-v2 model the pillar
// pipeline uses, where 0.55 is "fast tag" threshold; we set the bar lower for
// industry mapping because pillar names are intentionally broad ("Vlogs",
// "Daily Life") and won't always score high against any single industry.
const MIN_PRIMARY_SCORE = 0.35;

// Secondary is only kept if it's clearly relevant, not just second-place.
// Without this guard, e.g. "Productivity" would always pull a secondary that
// doesn't add real signal.
const MIN_SECONDARY_SCORE = 0.45;
// And it has to be close enough to primary to count as a true blend, not just
// the runner-up of an unrelated category.
const SECONDARY_MAX_GAP = 0.12;

export async function mapPillarToIndustry(
    pillarName: string,
    pillarDescription: string | null,
): Promise<PillarIndustryMatch | null> {
    const text = pillarDescription
        ? `${pillarName}. ${pillarDescription}`
        : pillarName;

    const [pillarEmbedding, industryEmbeddings] = await Promise.all([
        embedText(text),
        getIndustryEmbeddings(),
    ]);

    const scored = industryEmbeddings
        .map(({ industry, embedding }) => ({
            industry,
            score: cosineSimilarity(pillarEmbedding, embedding),
        }))
        .sort((a, b) => b.score - a.score);

    const top = scored[0];
    if (!top || top.score < MIN_PRIMARY_SCORE) return null;

    const second = scored[1];
    const secondaryQualifies =
        second &&
        second.score >= MIN_SECONDARY_SCORE &&
        top.score - second.score <= SECONDARY_MAX_GAP;

    return {
        primary: top.industry,
        secondary: secondaryQualifies ? second.industry : null,
        primaryScore: top.score,
        secondaryScore: secondaryQualifies ? second.score : null,
    };
}
