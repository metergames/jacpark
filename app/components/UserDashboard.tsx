"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getUserRank } from "../lib/leaderboard";
import { getSupabaseBrowserClient } from "../lib/supabaseBrowser";

interface UserDashboardProps {
    session: Session | null;
    onSignOut: () => Promise<void>;
    isSigningOut: boolean;
    onSettingsClick: () => void;
    onLeaderboardClick: () => void;
    onClose: () => void;
}

export default function UserDashboard({ session, onSignOut, isSigningOut, onSettingsClick, onLeaderboardClick, onClose }: UserDashboardProps) {
    const [userPoints, setUserPoints] = useState<number>(0);
    const [userRank, setUserRank] = useState<number | null>(null);
    const [userReports, setUserReports] = useState<number>(0);

    useEffect(() => {
        if (!session?.user?.id) {
            setUserPoints(0);
            setUserRank(null);
            setUserReports(0);
            return;
        }

        let isActive = true;

        const loadProfileStats = async () => {
            try {
                const rankData = await getUserRank(session.user.id);

                const supabase = getSupabaseBrowserClient();
                const { count } = await supabase
                    .from("parking_reports")
                    .select("id", { count: "exact", head: true })
                    .eq("user_id", session.user.id);

                if (!isActive) {
                    return;
                }

                setUserPoints(rankData?.points ?? 0);
                setUserRank(rankData?.rank ?? null);
                setUserReports(count ?? 0);
            } catch {
                if (!isActive) {
                    return;
                }

                setUserPoints(0);
                setUserRank(null);
                setUserReports(0);
            }
        };

        void loadProfileStats();

        return () => {
            isActive = false;
        };
    }, [session?.user?.id]);

    if (!session?.user) {
        return null;
    }

    const userName =
        typeof session.user.user_metadata?.full_name === "string"
            ? session.user.user_metadata.full_name
            : session.user.email?.split("@")[0] || "User";

    return (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 sm:absolute sm:inset-auto sm:top-3 sm:right-3 sm:z-10 sm:bg-transparent sm:backdrop-blur-none sm:p-0">
            <div className="w-full max-h-[90dvh] sm:max-h-none sm:w-auto rounded-2xl sm:rounded-2xl shadow-xl p-4 sm:p-4 backdrop-blur-sm overflow-auto" style={{
                backgroundColor: "var(--surface)",
                borderColor: "var(--line)",
                borderWidth: "1px",
                color: "var(--foreground)",
            }}>
                {/* Header with close button */}
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg sm:text-sm font-semibold" style={{ color: "var(--foreground)" }}>Profile</h3>
                    <button
                        onClick={onClose}
                        className="transition text-2xl sm:text-base"
                        style={{ color: "var(--muted)" }}
                    >
                        ✕
                    </button>
                </div>

                {/* User info */}
                <div className="mb-4 pb-4" style={{ borderBottomColor: "var(--line)", borderBottomWidth: "1px" }}>
                    <h4 className="font-semibold text-base sm:text-sm" style={{ color: "var(--foreground)" }}>{userName}</h4>
                    <p className="text-xs sm:text-xs" style={{ color: "var(--muted)" }}>{session.user.email}</p>
                </div>

                {/* Points card */}
                <div className="rounded-lg p-4 mb-4" style={{
                    background: "linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(5, 150, 105, 0.2))",
                    borderColor: "rgba(34, 197, 94, 0.4)",
                    borderWidth: "1px",
                }}>
                    <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>Your Points</p>
                    <p className="text-3xl sm:text-2xl font-bold text-green-500">{userPoints}</p>
                    <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>Earn points from reports</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                    <div className="rounded-lg p-3 sm:p-3 text-center" style={{
                        background: "rgba(59, 130, 246, 0.15)",
                        borderColor: "rgba(59, 130, 246, 0.3)",
                        borderWidth: "1px",
                    }}>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>Reports</p>
                        <p className="text-2xl sm:text-lg font-semibold text-blue-500">{userReports}</p>
                    </div>
                    <div className="rounded-lg p-3 sm:p-3 text-center" style={{
                        background: "rgba(147, 51, 234, 0.15)",
                        borderColor: "rgba(147, 51, 234, 0.3)",
                        borderWidth: "1px",
                    }}>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>Rank</p>
                        <p className="text-2xl sm:text-lg font-semibold text-purple-500">{userRank ? `#${userRank}` : "—"}</p>
                    </div>
                </div>

                {/* Action buttons */}
                <div className="space-y-2">
                    <button
                        onClick={onLeaderboardClick}
                        className="w-full px-4 py-3 sm:py-2 rounded-lg text-sm sm:text-sm font-medium transition"
                        style={{
                            borderColor: "var(--line)",
                            borderWidth: "1px",
                            color: "var(--foreground)",
                            backgroundColor: "transparent",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-strong)"}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                        🏆 Leaderboard
                    </button>
                    <button
                        onClick={onSettingsClick}
                        className="w-full px-4 py-3 sm:py-2 rounded-lg text-sm sm:text-sm font-medium transition"
                    style={{
                        borderColor: "var(--line)",
                        borderWidth: "1px",
                        color: "var(--foreground)",
                        backgroundColor: "transparent",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-strong)"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                >
                    ⚙️ Settings
                </button>
                <button
                    onClick={onSignOut}
                    disabled={isSigningOut}
                    className="w-full px-4 py-3 sm:py-2 rounded-lg text-sm sm:text-sm font-medium transition"
                    style={{
                        background: "rgba(239, 68, 68, 0.15)",
                        borderColor: "rgba(239, 68, 68, 0.3)",
                        borderWidth: "1px",
                        color: "#ef4444",
                        opacity: isSigningOut ? 0.5 : 1,
                        cursor: isSigningOut ? "not-allowed" : "pointer",
                    }}
                >
                    {isSigningOut ? "Signing out..." : "Sign Out"}
                </button>
            </div>
            </div>
        </div>
    );
}
