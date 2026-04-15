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
