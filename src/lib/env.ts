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
// vNext preview env should set: CONCEPT_PIPELINE=true BRAINSTORM_INBOX=true
//                               WORKSPACE_V1=true RESEARCH_PASS=true
// Prod env keeps all of these unset (false) until the M9 cutover.
//
// See docs/feature-flags.md for the full matrix and dark-launch process.

function envFlag(name: string): boolean {
    return process.env[name] === 'true';
}

export const featureFlags = {
    conceptPipeline: () => envFlag('CONCEPT_PIPELINE'),
    brainstormInbox: () => envFlag('BRAINSTORM_INBOX') && featureFlags.conceptPipeline(),
    workspaceV1:    () => envFlag('WORKSPACE_V1')     && featureFlags.conceptPipeline(),
    researchPass:   () => envFlag('RESEARCH_PASS'),
    scriptRefiner:  () => envFlag('SCRIPT_REFINER')   && featureFlags.conceptPipeline(),
};

// Per-user allowlist for M9 dark-launch (48h soak before flipping flags
// global). Empty in vnext-workspace; populated at M9 cutover with the
// dogfood account's auth user_id.
const ALLOWLIST_USER_IDS: string[] = [];

export function flagFor(userId: string | null | undefined, flag: keyof typeof featureFlags): boolean {
    if (userId && ALLOWLIST_USER_IDS.includes(userId)) return true;
    return featureFlags[flag]();
}
