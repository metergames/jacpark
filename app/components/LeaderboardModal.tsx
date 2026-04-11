"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { fetchLeaderboard, getUserRank } from "../lib/leaderboard";

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

export default function LeaderboardModal({ session, onClose }: LeaderboardModalProps) {
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [userRank, setUserRank] = useState<{ rank: number; points: number } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadLeaderboard = async () => {
            setIsLoading(true);
            setError(null);

            try {
                // Fetch leaderboard data
                const leaderboardData = await fetchLeaderboard(10);
                setLeaderboard(leaderboardData);

                // Fetch user rank if logged in
                if (session?.user?.id) {
                    const rank = await getUserRank(session.user.id);
                    setUserRank(rank);
                }
            } catch (err) {
                console.error("Error loading leaderboard:", err);
                setError("Failed to load leaderboard. Please try again later.");
            } finally {
                setIsLoading(false);
            }
        };

        loadLeaderboard();
    }, [session?.user?.id]);

    return (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="max-h-[90dvh] w-full max-w-md overflow-auto rounded-2xl shadow-xl p-6 backdrop-blur-sm" style={{
                backgroundColor: "var(--surface)",
                borderColor: "var(--line)",
                borderWidth: "1px",
                color: "var(--foreground)",
            }}>
                {/* Header */}
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold">🏆 Leaderboard</h2>
                        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Top parking reporters</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1 transition"
                        style={{ color: "var(--muted)" }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-strong)"}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                        ✕
                    </button>
                </div>

                {/* Your Rank Card */}
                {session?.user && (
                    <div className="mb-6 rounded-lg p-4" style={{
                        background: "linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(34, 211, 238, 0.15))",
                        borderColor: "rgba(59, 130, 246, 0.3)",
                        borderWidth: "1px",
                    }}>
                        <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>Your Rank</p>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-lg font-bold text-blue-500">#{userRank?.rank || "—"}</p>
                                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{userRank?.points || 0} points</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm font-semibold">
                                    {session.user.user_metadata?.full_name || session.user.email?.split("@")[0]}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Loading State */}
                {isLoading && (
                    <div className="flex items-center justify-center py-12">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                    </div>
                )}

                {/* Error State */}
                {error && (
                    <div className="mb-6 rounded-lg p-4" style={{
                        background: "rgba(239, 68, 68, 0.15)",
                        borderColor: "rgba(239, 68, 68, 0.3)",
                        borderWidth: "1px",
                    }}>
                        <p className="text-sm text-red-500">{error}</p>
                    </div>
                )}

                {/* Leaderboard List */}
                {!isLoading && !error && (
                    <div className="space-y-2">
                        {leaderboard.length === 0 ? (
                            <p className="text-center text-sm py-8" style={{ color: "var(--muted)" }}>
                                No leaderboard data yet. Be the first to report!
                            </p>
                        ) : (
                            leaderboard.map((entry) => {
                                let bgColor = "var(--surface-strong)";
                                let borderColor = "var(--line)";
                                
                                if (userRank?.rank === entry.rank) {
                                    bgColor = "rgba(59, 130, 246, 0.15)";
                                    borderColor = "rgba(59, 130, 246, 0.3)";
                                } else if (entry.rank === 1) {
                                    bgColor = "rgba(234, 179, 8, 0.15)";
                                    borderColor = "rgba(234, 179, 8, 0.3)";
                                } else if (entry.rank === 2) {
                                    bgColor = "rgba(107, 114, 128, 0.15)";
                                    borderColor = "rgba(107, 114, 128, 0.3)";
                                } else if (entry.rank === 3) {
                                    bgColor = "rgba(249, 115, 22, 0.15)";
                                    borderColor = "rgba(249, 115, 22, 0.3)";
                                }

                                return (
                                    <div
                                        key={entry.id}
                                        className="rounded-lg p-3 transition"
                                        style={{
                                            backgroundColor: bgColor,
                                            borderColor: borderColor,
                                            borderWidth: "1px",
                                        }}
                                    >
                                        <div className="flex items-center gap-3">
                                            {/* Rank */}
                                            <div className="w-8 text-center">
                                                <span className="text-lg font-bold">
                                                    {entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : `#${entry.rank}`}
                                                </span>
                                            </div>

                                            {/* Name and Points */}
                                            <div className="flex-1">
                                                <p className="text-sm font-semibold">{entry.full_name}</p>
                                                <p className="text-xs" style={{ color: "var(--muted)" }}>{entry.points} points</p>
                                            </div>

                                            {/* Points Badge */}
                                            <div className="rounded-full px-2.5 py-1 text-xs font-bold" style={{
                                                backgroundColor: "var(--surface-strong)",
                                                color: "var(--foreground)",
                                            }}>
                                                {entry.points}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {/* Footer */}
                <div className="mt-6 rounded-lg p-3" style={{
                    background: "rgba(59, 130, 246, 0.15)",
                    borderColor: "rgba(59, 130, 246, 0.3)",
                    borderWidth: "1px",
                }}>
                    <p className="text-xs">
                        <span className="font-semibold">💡 Tip:</span> <span style={{ color: "var(--muted)" }}>Earn points by submitting accurate parking updates!</span>
                    </p>
                </div>
            </div>
        </div>
    );
}
