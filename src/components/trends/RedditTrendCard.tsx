'use client';

import { useState } from 'react';
import { Loader2, Sparkles, MessageSquare, ArrowBigUp } from 'lucide-react';

export type RedditTrendData = {
    post_id: string;
    subreddit: string;
    title: string;
    score: number | null;
    num_comments: number | null;
    permalink: string | null;
};

type Props = {
    post: RedditTrendData;
    pillarId: string;
    /** Called with the inserted idea row when generation succeeds. */
    onIdea: (idea: Record<string, unknown>) => void;
    /** Called with a human-readable message on no-fit or error. */
    onMessage: (msg: string) => void;
    getToken: () => Promise<string | undefined>;
};

function formatCount(n: number | null): string {
    if (n == null) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

export default function RedditTrendCard({ post, pillarId, onIdea, onMessage, getToken }: Props) {
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
                body: JSON.stringify({ pillarId, kind: 'reddit_post', postId: post.post_id }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                onMessage(body?.error || `Generation failed (HTTP ${res.status})`);
                return;
            }
            if (body.noFit) {
                onMessage(`r/${post.subreddit} post doesn't fit your pillar — ${body.reason || 'no honest intersection.'}`);
                return;
            }
            if (body.idea) {
                onIdea(body.idea);
                onMessage(`✦ idea generated from r/${post.subreddit}`);
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

    return (
        <button
            onClick={handleClick}
            disabled={isGenerating}
            title={`Generate an idea from this r/${post.subreddit} discussion`}
            className="group flex flex-col gap-2 text-left w-full px-4 py-3 rounded-xl bg-paper-elevated hover:bg-paper-sunken border border-rule transition-colors disabled:opacity-60 disabled:cursor-wait"
        >
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-faint">
                <span className="font-medium">r/{post.subreddit}</span>
                {post.score != null && (
                    <span className="flex items-center gap-0.5">
                        <ArrowBigUp className="h-3 w-3" />
                        {formatCount(post.score)}
                    </span>
                )}
                {post.num_comments != null && (
                    <span className="flex items-center gap-0.5">
                        <MessageSquare className="h-3 w-3" />
                        {formatCount(post.num_comments)}
                    </span>
                )}
                <span className="ml-auto inline-flex items-center text-ink-faint group-hover:text-ink-muted">
                    {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                </span>
            </div>
            <p className="text-sm text-ink leading-snug line-clamp-2">{post.title}</p>
        </button>
    );
}
