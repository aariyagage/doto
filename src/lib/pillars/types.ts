import type { createClient } from '@/lib/supabase/server';

export type SupabaseServer = ReturnType<typeof createClient>;
