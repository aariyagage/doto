const REQUIRED_SERVER_ENV = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'GROQ_API_KEY',
    'HF_API_TOKEN',
] as const;

type RequiredEnv = typeof REQUIRED_SERVER_ENV[number];

export function assertServerEnv(required: readonly RequiredEnv[] = REQUIRED_SERVER_ENV): void {
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.join(', ')}. ` +
            `Copy .env.example to .env.local and fill in values.`
        );
    }
}

export function requireEnv(key: RequiredEnv): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

// ---- vNext feature flags --------------------------------------------------
// Flags default false unless the env var is exactly "true". Layering rules
// are enforced inside the helpers so callers can't accidentally enable a
// dependent flag without its prerequisite.
//
// All vNext flags are NEXT_PUBLIC_* so client components can gate UI
// (nav items, page mounts) without round-tripping to a server endpoint.
// These flags are toggles, not secrets; exposing them in the browser
// bundle is safe.
//
// vNext preview env should set:
//   NEXT_PUBLIC_CONCEPT_PIPELINE=true
//   NEXT_PUBLIC_BRAINSTORM_INBOX=true
//   NEXT_PUBLIC_WORKSPACE_V1=true
//   NEXT_PUBLIC_RESEARCH_PASS=true
//
// Prod env keeps all of these unset (false) until the M9 cutover.
//
// See docs/feature-flags.md for the full matrix and dark-launch process.

// IMPORTANT: every flag here uses a LITERAL `process.env.NEXT_PUBLIC_*`
// access. Don't refactor through a helper that takes the name as a string
// parameter — webpack's DefinePlugin can only inline literal property
// accesses, and `process.env[name]` becomes `undefined` in the client
// bundle (process.env doesn't exist in the browser; only inlined statics
// survive). Asking once, paying forever.

export const featureFlags = {
    conceptPipeline: () => process.env.NEXT_PUBLIC_CONCEPT_PIPELINE === 'true',
    brainstormInbox: () =>
        process.env.NEXT_PUBLIC_BRAINSTORM_INBOX === 'true' &&
        featureFlags.conceptPipeline(),
    workspaceV1: () =>
        process.env.NEXT_PUBLIC_WORKSPACE_V1 === 'true' &&
        featureFlags.conceptPipeline(),
    researchPass: () => process.env.NEXT_PUBLIC_RESEARCH_PASS === 'true',
    scriptRefiner: () =>
        process.env.NEXT_PUBLIC_SCRIPT_REFINER === 'true' &&
        featureFlags.conceptPipeline(),
};

// Per-user allowlist for M9 dark-launch (48h soak before flipping flags
// global). Empty in vnext-workspace; populated at M9 cutover with the
// dogfood account's auth user_id.
const ALLOWLIST_USER_IDS: string[] = [];

export function flagFor(userId: string | null | undefined, flag: keyof typeof featureFlags): boolean {
    if (userId && ALLOWLIST_USER_IDS.includes(userId)) return true;
    return featureFlags[flag]();
}
