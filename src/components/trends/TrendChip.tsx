'use client';

import { useState } from 'react';
import { Loader2, Sparkles, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export type TrendChipData = {
    hashtag_id: string;
    hashtag_name: string;
    rank: number | null;
    rank_diff_type: number | null;   // 1=up 2=same 3=down 4=new
    video_views: number | null;
};

type Props = {
    trend: TrendChipData;
    pillarId: string;
    /** Called with the inserted idea row when generation succeeds. */
    onIdea: (idea: Record<string, unknown>) => void;
    /** Called with a human-readable message on no-fit or error. */
    onMessage: (msg: string) => void;
    /** Auth token getter — uses the same Supabase session token the rest of /ideas uses. */
    getToken: () => Promise<string | undefined>;
};

function formatViews(n: number | null): string {
    if (n == null) return '';
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
}

function rankIcon(diffType: number | null) {
    if (diffType === 1) return <TrendingUp className="h-3 w-3" aria-label="trending up" />;
    if (diffType === 3) return <TrendingDown className="h-3 w-3" aria-label="trending down" />;
    if (diffType === 4) return <span className="text-[9px] font-bold uppercase">new</span>;
    return <Minus className="h-3 w-3 opacity-40" aria-label="unchanged" />;
}

export default function TrendChip({ trend, pillarId, onIdea, onMessage, getToken }: Props) {
    const [isGenerating, setIsGenerating] = useState(false);

    const handleClick = async () => {
        if (isGenerating) return;
        setIsGenerating(true);
        try {
            const token = await getToken();
            const res = await fetch('/api/ideas/generate-from-trend', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token ?? ''}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pillarId, hashtagId: trend.hashtag_id }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                onMessage(body?.error || `Generation failed (HTTP ${res.status})`);
                return;
            }
            if (body.noFit) {
                onMessage(`#${trend.hashtag_name} doesn't fit your pillar — ${body.reason || 'no honest intersection.'}`);
                return;
            }
            if (body.idea) {
                onIdea(body.idea);
                onMessage(`✦ idea generated from #${trend.hashtag_name}`);
            } else {
                onMessage('Generator returned an empty response.');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Network error';
            onMessage(msg);
        } finally {
            setIsGenerating(false);
        }
    };

    const views = formatViews(trend.video_views);

    return (
        <button
            onClick={handleClick}
            disabled={isGenerating}
            title={`Generate an idea from #${trend.hashtag_name}`}
            className="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-paper-elevated hover:bg-ink hover:text-paper border border-rule transition-colors text-xs font-medium whitespace-nowrap disabled:opacity-60 disabled:cursor-wait"
        >
            <span className="flex items-center gap-1 text-ink-faint group-hover:text-paper/70">
                {rankIcon(trend.rank_diff_type)}
            </span>
            <span className="text-ink group-hover:text-paper">#{trend.hashtag_name}</span>
            {views && (
                <span className="text-ink-muted group-hover:text-paper/70">{views}</span>
            )}
            <span className="ml-1 inline-flex items-center text-ink-faint group-hover:text-paper/80">
                {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            </span>
        </button>
    );
}
