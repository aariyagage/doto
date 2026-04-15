import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness check. Intentionally does NOT touch Supabase or external APIs — this
 * endpoint must always respond quickly so load balancers can distinguish "the
 * process is up" from "a downstream dependency is slow." For deeper checks,
 * add `/api/health/ready` later that pings Supabase.
 */
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
}
