"use client";

import type { Session } from "@supabase/supabase-js";

interface UserDashboardProps {
    session: Session | null;
    onSignOut: () => Promise<void>;
    isSigningOut: boolean;
    onSettingsClick: () => void;
    onClose: () => void;
}

export default function UserDashboard({ session, onSignOut, isSigningOut, onSettingsClick, onClose }: UserDashboardProps) {
    if (!session?.user) {
        return null;
    }

    const userName =
        typeof session.user.user_metadata?.full_name === "string"
            ? session.user.user_metadata.full_name
            : session.user.email?.split("@")[0] || "User";

    const userPoints = typeof session.user.user_metadata?.points === "number" ? session.user.user_metadata.points : 0;

    // Get user avatar from Google profile picture if available
    const avatarUrl = session.user.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.id}`;

    return (
        <div className="absolute top-3 right-3 z-10 bg-white/92 rounded-2xl border border-slate-300/80 shadow-xl p-4 max-w-sm backdrop-blur-sm">
            {/* Header with close button */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-900">Profile</h3>
                <button
                    onClick={onClose}
                    className="text-slate-400 hover:text-slate-600 transition"
                >
                    ✕
                </button>
            </div>

            {/* User info */}
            <div className="flex items-start gap-3 mb-4 pb-4 border-b border-slate-200">
                <img
                    src={avatarUrl}
                    alt={userName}
                    className="w-12 h-12 rounded-full object-cover bg-slate-200"
                />
                <div className="flex-1">
                    <h4 className="font-semibold text-slate-900">{userName}</h4>
                    <p className="text-xs text-slate-600">{session.user.email}</p>
                </div>
            </div>

            {/* Points card */}
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-3 mb-4 border border-green-200">
                <p className="text-xs text-slate-600 mb-1">Your Points</p>
                <p className="text-2xl font-bold text-green-600">{userPoints}</p>
                <p className="text-xs text-slate-600 mt-1">Earn points by reporting parking updates</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-blue-50 rounded-lg p-3 text-center border border-blue-200">
                    <p className="text-xs text-slate-600">Reports</p>
                    <p className="text-lg font-semibold text-blue-600">0</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center border border-purple-200">
                    <p className="text-xs text-slate-600">Rank</p>
                    <p className="text-lg font-semibold text-purple-600">#1</p>
                </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-2">
                <button
                    onClick={onSettingsClick}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition"
                >
                    ⚙️ Settings
                </button>
                <button
                    onClick={onSignOut}
                    disabled={isSigningOut}
                    className="w-full px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 transition disabled:opacity-50"
                >
                    {isSigningOut ? "Signing out..." : "Sign Out"}
                </button>
            </div>
        </div>
    );
}
