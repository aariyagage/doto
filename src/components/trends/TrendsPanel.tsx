'use client';

import { useEffect, useState } from 'react';
import { Loader2, Flame, Pencil, Check, X } from 'lucide-react';
import TrendChip, { type TrendChipData } from './TrendChip';
import RedditTrendCard, { type RedditTrendData } from './RedditTrendCard';
import { TIKTOK_INDUSTRIES } from '@/lib/trends/industries';

type TrendsResponse = {
    source: 'tiktok' | 'reddit' | null;
    trends: TrendChipData[] | RedditTrendData[];
    industryName: string | null;
    subreddits: string[];
    lastRefresh: string | null;
    isStale: boolean;
    needsMapping: boolean;
    industryScore?: number | null;
};

type Props = {
    pillarId: string;
    pillarName: string;
    onIdeaGenerated: (idea: Record<string, unknown>) => void;
    onMessage: (msg: string) => void;
    getToken: () => Promise<string | undefined>;
};

function formatRelativeTime(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export default function TrendsPanel({ pillarId, pillarName, onIdeaGenerated, onMessage, getToken }: Props) {
    const [data, setData] = useState<TrendsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isEditingNiche, setIsEditingNiche] = useState(false);
    const [pendingNiche, setPendingNiche] = useState<string>('');
    const [isSavingNiche, setIsSavingNiche] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setIsLoading(true);
            setErrorMsg(null);
            try {
                const token = await getToken();
                const res = await fetch(`/api/trends?pillarId=${encodeURIComponent(pillarId)}`, {
                    headers: { 'Authorization': `Bearer ${token ?? ''}` },
                });
                const body = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (!res.ok) {
                    setErrorMsg(body?.error || `Failed to load trends (HTTP ${res.status})`);
                    setData(null);
                } else {
                    setData(body as TrendsResponse);
                }
            } catch (err) {
                if (cancelled) return;
                setErrorMsg(err instanceof Error ? err.message : 'Network error');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [pillarId, getToken, reloadKey]);

    const startEditNiche = () => {
        const current = TIKTOK_INDUSTRIES.find(i => i.name === data?.industryName);
        setPendingNiche(current?.id ?? '');
        setIsEditingNiche(true);
    };

    const saveNiche = async () => {
        if (!pendingNiche) return;
        setIsSavingNiche(true);
        try {
            const token = await getToken();
            const res = await fetch(`/api/pillars/${pillarId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token ?? ''}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    tiktok_industry_id: pendingNiche,
                    tiktok_industry_secondary: null,
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                onMessage(body?.error || 'Failed to update niche');
                return;
            }
            const newIndustry = TIKTOK_INDUSTRIES.find(i => i.id === pendingNiche);
            onMessage(`niche set to ${newIndustry?.name ?? 'updated'}`);
            setIsEditingNiche(false);
            setReloadKey(k => k + 1);
        } catch (err) {
            onMessage(err instanceof Error ? err.message : 'Network error');
        } finally {
            setIsSavingNiche(false);
        }
    };

    // Source-specific subtitle for the header.
    const sourceLabel = (() => {
        if (!data) return '';
        if (data.source === 'tiktok') {
            return data.industryName ? `via tiktok · ${data.industryName.toLowerCase()}` : 'via tiktok';
        }
        if (data.source === 'reddit') {
            const subs = data.subreddits.slice(0, 3).map(s => `r/${s}`).join(' · ');
            return subs ? `via reddit · ${subs}` : 'via reddit';
        }
        return '';
    })();

    const isReddit = data?.source === 'reddit';
    const hasTrends = data?.trends && data.trends.length > 0;

    return (
        <div className="rounded-2xl border border-rule bg-paper-elevated/60 px-5 py-4">
            <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                    <Flame className="h-4 w-4 text-ink-muted" />
                    <h3 className="text-sm font-semibold text-ink">
                        trending in {pillarName.toLowerCase()} this week
                    </h3>
                    {!isEditingNiche && data?.source && sourceLabel && (
                        <span className="text-[10px] uppercase tracking-wide text-ink-faint flex items-center gap-1">
                            {sourceLabel}
                            {data.source === 'tiktok' && (
                                <button
                                    onClick={startEditNiche}
                                    className="ml-1 hover:text-ink-muted transition-colors"
                                    title="Change tiktok niche"
                                >
                                    <Pencil className="h-2.5 w-2.5" />
                                </button>
                            )}
                        </span>
                    )}
                    {isEditingNiche && (
                        <span className="flex items-center gap-1">
                            <select
                                value={pendingNiche}
                                onChange={(e) => setPendingNiche(e.target.value)}
                                className="text-[10px] border border-rule rounded px-2 py-0.5 bg-paper-elevated text-ink"
                            >
                                <option value="">— pick a tiktok niche —</option>
                                {TIKTOK_INDUSTRIES.map(i => (
                                    <option key={i.id} value={i.id}>{i.name}</option>
                                ))}
                            </select>
                            <button
                                onClick={saveNiche}
                                disabled={isSavingNiche || !pendingNiche}
                                className="text-ink hover:text-ink-muted disabled:opacity-40"
                                title="Save"
                            >
                                {isSavingNiche ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            </button>
                            <button
                                onClick={() => setIsEditingNiche(false)}
                                className="text-ink-faint hover:text-ink-muted"
                                title="Cancel"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    )}
                </div>
                {data?.lastRefresh && !isEditingNiche && (
                    <span className={`text-[10px] ${data.isStale ? 'text-amber-600' : 'text-ink-faint'}`}>
                        {data.isStale ? 'stale · ' : ''}refreshed {formatRelativeTime(data.lastRefresh)}
                    </span>
                )}
            </div>

            {isLoading && (
                <div className="flex items-center gap-2 text-xs text-ink-muted py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading trends…
                </div>
            )}

            {!isLoading && errorMsg && (
                <p className="text-xs text-red-500 py-2">{errorMsg}</p>
            )}

            {!isLoading && !errorMsg && data?.needsMapping && !isEditingNiche && (
                <div className="text-xs text-ink-muted py-2 flex items-center gap-2">
                    <span>we couldn&apos;t auto-detect a niche for this pillar.</span>
                    <button
                        onClick={startEditNiche}
                        className="font-medium text-blue-600 hover:underline"
                    >
                        pick a tiktok niche →
                    </button>
                </div>
            )}

            {!isLoading && !errorMsg && data && !data.needsMapping && !hasTrends && (
                <p className="text-xs text-ink-muted py-2">
                    no trends yet — first batch lands within 24 hours of the daily refresh.
                </p>
            )}

            {!isLoading && !errorMsg && data && hasTrends && !isReddit && (
                <>
                    <div className="flex flex-wrap gap-2">
                        {(data.trends as TrendChipData[]).map(t => (
                            <TrendChip
                                key={t.hashtag_id}
                                trend={t}
                                pillarId={pillarId}
                                onIdea={onIdeaGenerated}
                                onMessage={onMessage}
                                getToken={getToken}
                            />
                        ))}
                    </div>
                    <p className="mt-2 text-[10px] text-ink-faint">
                        click any hashtag to generate an idea anchored to that trend, in your voice.
                    </p>
                </>
            )}

            {!isLoading && !errorMsg && data && hasTrends && isReddit && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {(data.trends as RedditTrendData[]).map(p => (
                            <RedditTrendCard
                                key={p.post_id}
                                post={p}
                                pillarId={pillarId}
                                onIdea={onIdeaGenerated}
                                onMessage={onMessage}
                                getToken={getToken}
                            />
                        ))}
                    </div>
                    <p className="mt-2 text-[10px] text-ink-faint">
                        click any discussion to generate an idea responding to its underlying topic, in your voice.
                    </p>
                </>
            )}
        </div>
    );
}
