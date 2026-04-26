"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { fetchLeaderboard, getUserRank, type LeaderboardPeriod } from "../lib/leaderboard";

interface LeaderboardEntry {
    id: string;
    full_name: string;
    points: number;
    rank?: number;
}

interface LeaderboardModalProps {
    session: Session | null;
    onClose: () => void;
}

const MEDAL_COLORS: Record<number, string> = {
    1: "#f4b942",
    2: "#9aa6ad",
    3: "#cd8a5e",
};

const CACHE_TTL_MS = 60_000;

type CacheEntry = { data: LeaderboardEntry[]; rank: { rank: number; points: number } | null; ts: number };

export default function LeaderboardModal({ session, onClose }: LeaderboardModalProps) {
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [userRank, setUserRank] = useState<{ rank: number; points: number } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<LeaderboardPeriod>("week");
    const cache = useRef<Partial<Record<LeaderboardPeriod, CacheEntry>>>({});
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: 0 });

        const cached = cache.current[activeTab];
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
            setLeaderboard(cached.data);
            setUserRank(cached.rank);
            setError(null);
            setIsLoading(false);
            return;
        }

        const load = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [data, rank] = await Promise.all([
                    fetchLeaderboard(10, activeTab),
                    session?.user?.id ? getUserRank(session.user.id, activeTab) : Promise.resolve(null),
                ]);
                cache.current[activeTab] = { data, rank, ts: Date.now() };
                setLeaderboard(data);
                setUserRank(rank);
            } catch {
                setError("Failed to load leaderboard. Check your connection and try again.");
            } finally {
                setIsLoading(false);
            }
        };
        void load();
    }, [session?.user?.id, activeTab]);

    const top3 = leaderboard.slice(0, 3);
    const rest = leaderboard.slice(3);

    const podiumOrder = [
        top3.find((p) => p.rank === 2) ?? null,
        top3.find((p) => p.rank === 1) ?? null,
        top3.find((p) => p.rank === 3) ?? null,
    ];

    const podiumHeights = [72, 100, 56];

    const userName =
        session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "You";

    return (
        <div
            ref={scrollRef}
            className="fixed inset-0 z-30 overflow-auto md:hidden"
            style={{ backgroundColor: "var(--background)", color: "var(--foreground)", overscrollBehaviorY: "contain" }}
        >
            <div style={{ paddingBottom: "2.5rem" }}>
                {/* Header */}
                <div
                    className="flex items-center gap-3 px-5"
                    style={{ paddingTop: "calc(3.5rem + max(0px, env(safe-area-inset-top)))", paddingBottom: "1rem" }}
                >
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
                        aria-label="Back"
                    >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M15 6l-6 6 6 6" />
                        </svg>
                    </button>
                    <div>
                        <div className="text-[22px] font-extrabold tracking-tight">Leaderboard</div>
                        <div className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>
                            {isLoading ? "Loading..." : `${leaderboard.length} reporters`}
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="px-5 mb-4">
                    <div
                        className="flex gap-1 p-1 rounded-xl"
                        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
                    >
                        {(["week", "month", "all"] as const).map((tab, i) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className="flex-1 py-2 rounded-[10px] text-xs font-extrabold transition"
                                style={{
                                    backgroundColor: activeTab === tab ? "var(--accent)" : "transparent",
                                    color: activeTab === tab ? "#fff" : "var(--muted)",
                                    border: "none",
                                }}
                            >
                                {["Week", "Month", "All-time"][i]}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Your rank */}
                {session?.user && userRank && (
                    <div className="px-5 mb-4">
                        <div
                            className="flex items-center gap-3 p-3 rounded-[14px]"
                            style={{
                                background: "linear-gradient(135deg, rgba(34,211,194,0.12), rgba(34,211,194,0.04))",
                                border: "1px solid rgba(34,211,194,0.25)",
                            }}
                        >
                            <div
                                className="w-8 h-8 rounded-full flex items-center justify-center font-extrabold text-sm text-white flex-shrink-0"
                                style={{ background: "var(--accent)" }}
                            >
                                {userName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1">
                                <div className="text-[13px] font-extrabold">{userName}</div>
                                <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                                    {userRank.points} pts
                                </div>
                            </div>
                            <div className="text-[18px] font-extrabold" style={{ color: "var(--accent)", fontFamily: "var(--font-geist-mono, monospace)" }}>
                                #{userRank.rank}
                            </div>
                        </div>
                    </div>
                )}

                {isLoading && (
                    <div className="flex justify-center py-12">
                        <div className="h-8 w-8 rounded-full border-b-2 animate-spin" style={{ borderColor: "var(--accent)" }} />
                    </div>
                )}

                {error && !isLoading && (
                    <div className="mx-5 p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)" }}>
                        <p className="text-sm text-red-500">{error}</p>
                    </div>
                )}

                {!isLoading && !error && leaderboard.length === 0 && (
                    <p className="text-center text-sm py-12" style={{ color: "var(--muted)" }}>
                        No leaderboard data yet. Be the first to report!
                    </p>
                )}

                {/* Podium */}
                {!isLoading && !error && top3.length >= 1 && (
                    <div className="flex items-end gap-2 justify-center px-5 mb-4" style={{ paddingTop: "4px" }}>
                        {podiumOrder.map((player, i) => {
                            if (!player) return <div key={i} className="flex-1" />;
                            const rank = player.rank as number;
                            const medal = MEDAL_COLORS[rank] ?? "#9aa6ad";
                            const h = podiumHeights[i] as number;
                            const isCenter = i === 1;
                            const avatarSize = isCenter ? 52 : 42;

                            return (
                                <div key={rank} className="flex-1 flex flex-col items-center">
                                    <div
                                        className="rounded-full flex items-center justify-center font-extrabold text-white mb-1.5"
                                        style={{
                                            width: avatarSize,
                                            height: avatarSize,
                                            background: medal,
                                            fontSize: isCenter ? 18 : 14,
                                            boxShadow: `0 0 0 3px var(--background), 0 0 0 5px ${medal}`,
                                        }}
                                    >
                                        {player.full_name.charAt(0).toUpperCase()}
                                    </div>
                                    <div
                                        className="text-[11px] font-extrabold text-center mb-1 max-w-[88px] overflow-hidden"
                                        style={{ textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--foreground)" }}
                                    >
                                        {player.full_name}
                                    </div>
                                    <div
                                        className="text-[11px] font-bold mb-1.5"
                                        style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono, monospace)" }}
                                    >
                                        {player.points} pts
                                    </div>
                                    <div
                                        className="w-full rounded-t-xl flex items-start justify-center pt-1.5 text-base font-extrabold"
                                        style={{
                                            height: h,
                                            background: `linear-gradient(180deg, ${medal}66, ${medal}18)`,
                                            border: `1px solid ${medal}44`,
                                            borderBottom: "none",
                                            color: medal,
                                        }}
                                    >
                                        {rank}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Rest of list */}
                {!isLoading && !error && rest.length > 0 && (
                    <div className="px-3 space-y-1.5">
                        {rest.map((entry) => {
                            const isYou = entry.id === session?.user?.id;
                            return (
                                <div
                                    key={entry.id}
                                    className="flex items-center gap-3 p-3 rounded-[14px]"
                                    style={{
                                        backgroundColor: isYou ? "rgba(34,211,194,0.1)" : "var(--surface)",
                                        border: `1px solid ${isYou ? "rgba(34,211,194,0.25)" : "var(--line)"}`,
                                    }}
                                >
                                    <div
                                        className="text-xs font-extrabold text-center w-7 flex-shrink-0"
                                        style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono, monospace)" }}
                                    >
                                        #{entry.rank}
                                    </div>
                                    <div
                                        className="w-[34px] h-[34px] rounded-full flex-shrink-0 flex items-center justify-center font-bold text-sm"
                                        style={{
                                            backgroundColor: isYou ? "var(--accent)" : "var(--surface-strong)",
                                            color: isYou ? "#fff" : "var(--muted)",
                                        }}
                                    >
                                        {entry.full_name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 text-[14px] font-bold truncate">{entry.full_name}</div>
                                    <div
                                        className="text-[13px] font-extrabold flex-shrink-0"
                                        style={{ color: "var(--foreground)", fontFamily: "var(--font-geist-mono, monospace)" }}
                                    >
                                        {entry.points}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
