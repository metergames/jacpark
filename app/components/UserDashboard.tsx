"use client";

import type { Session } from "@supabase/supabase-js";

interface UserDashboardProps {
    session: Session | null;
    onSignOut: () => Promise<void>;
    isSigningOut: boolean;
    onSettingsClick: () => void;
    onLeaderboardClick: () => void;
    onClose: () => void;
}

export default function UserDashboard({ session, onSignOut, isSigningOut, onSettingsClick, onLeaderboardClick, onClose }: UserDashboardProps) {
    if (!session?.user) {
        return null;
    }

    const userName =
        typeof session.user.user_metadata?.full_name === "string"
            ? session.user.user_metadata.full_name
            : session.user.email?.split("@")[0] || "User";

    const userPoints = typeof session.user.user_metadata?.points === "number" ? session.user.user_metadata.points : 0;

    return (
        <div className="absolute top-3 right-3 z-10 rounded-2xl shadow-xl p-4 max-w-sm backdrop-blur-sm" style={{
            backgroundColor: "var(--surface)",
            borderColor: "var(--line)",
            borderWidth: "1px",
            color: "var(--foreground)",
        }}>
            {/* Header with close button */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Profile</h3>
                <button
                    onClick={onClose}
                    className="transition"
                    style={{ color: "var(--muted)" }}
                >
                    ✕
                </button>
            </div>

            {/* User info */}
            <div className="mb-4 pb-4" style={{ borderBottomColor: "var(--line)", borderBottomWidth: "1px" }}>
                <h4 className="font-semibold" style={{ color: "var(--foreground)" }}>{userName}</h4>
                <p className="text-xs" style={{ color: "var(--muted)" }}>{session.user.email}</p>
            </div>

            {/* Points card */}
            <div className="rounded-lg p-3 mb-4" style={{
                background: "linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(5, 150, 105, 0.2))",
                borderColor: "rgba(34, 197, 94, 0.4)",
                borderWidth: "1px",
            }}>
                <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>Your Points</p>
                <p className="text-2xl font-bold text-green-500">{userPoints}</p>
                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Earn points by reporting parking updates</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="rounded-lg p-3 text-center" style={{
                    background: "rgba(59, 130, 246, 0.15)",
                    borderColor: "rgba(59, 130, 246, 0.3)",
                    borderWidth: "1px",
                }}>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>Reports</p>
                    <p className="text-lg font-semibold text-blue-500">0</p>
                </div>
                <div className="rounded-lg p-3 text-center" style={{
                    background: "rgba(147, 51, 234, 0.15)",
                    borderColor: "rgba(147, 51, 234, 0.3)",
                    borderWidth: "1px",
                }}>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>Rank</p>
                    <p className="text-lg font-semibold text-purple-500">#1</p>
                </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-2">
                <button
                    onClick={onLeaderboardClick}
                    className="w-full px-3 py-2 rounded-lg text-sm font-medium transition"
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
                    className="w-full px-3 py-2 rounded-lg text-sm font-medium transition"
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
                    className="w-full px-3 py-2 rounded-lg text-sm font-medium transition"
                    style={{
                        background: "rgba(239, 68, 68, 0.15)",
                        borderColor: "rgba(239, 68, 68, 0.3)",
                        borderWidth: "1px",
                        color: "#ef4444",
                        opacity: isSigningOut ? 0.5 : 1,
                    }}
                >
                    {isSigningOut ? "Signing out..." : "Sign Out"}
                </button>
            </div>
        </div>
    );
}
