"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { useTheme } from "../lib/ThemeContext";
import type { Session } from "@supabase/supabase-js";

const AVATAR_PRESETS = [
    "avataaars",
    "adventurer",
    "avataaars-neutral",
    "personas",
    "pixel-art",
    "lorelei",
];

export default function SettingsPage() {
    const router = useRouter();
    const { theme, toggleTheme } = useTheme();
    const [session, setSession] = useState<Session | null>(null);
    const [selectedAvatarStyle, setSelectedAvatarStyle] = useState("avataaars");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    useEffect(() => {
        const checkSession = async () => {
            try {
                const supabase = getSupabaseBrowserClient();
                const { data } = await supabase.auth.getSession();
                if (data.session) {
                    setSession(data.session);
                    const currentStyle = data.session.user.user_metadata?.avatarStyle || "avataaars";
                    setSelectedAvatarStyle(currentStyle);
                } else {
                    router.push("/");
                }
            } catch (error) {
                console.error("Error checking session:", error);
                router.push("/");
            } finally {
                setIsLoading(false);
            }
        };

        checkSession();
    }, [router]);

    const handleAvatarChange = async (style: string) => {
        if (!session) return;

        setIsSaving(true);
        setMessage(null);

        try {
            const supabase = getSupabaseBrowserClient();
            const newAvatarUrl = `https://api.dicebear.com/7.x/${style}/svg?seed=${session.user.id}`;

            const { error } = await supabase.auth.updateUser({
                data: {
                    avatar_url: newAvatarUrl,
                    avatarStyle: style,
                },
            });

            if (error) throw error;

            setSelectedAvatarStyle(style);
            setMessage({ type: "success", text: "Avatar updated successfully!" });
            setSession({
                ...session,
                user: {
                    ...session.user,
                    user_metadata: {
                        ...session.user.user_metadata,
                        avatar_url: newAvatarUrl,
                        avatarStyle: style,
                    },
                },
            });
        } catch (error) {
            console.error("Error updating avatar:", error);
            setMessage({ type: "error", text: "Failed to update avatar. Please try again." });
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-900">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!session) {
        return null;
    }

    const currentAvatarUrl = `https://api.dicebear.com/7.x/${selectedAvatarStyle}/svg?seed=${session.user.id}`;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
            <div className="max-w-2xl mx-auto px-4 py-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Settings</h1>
                    <button
                        onClick={() => router.push("/map")}
                        className="rounded-lg bg-slate-200 dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-300 dark:hover:bg-slate-700 transition"
                    >
                        ← Back to Map
                    </button>
                </div>

                {/* Message */}
                {message && (
                    <div
                        className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${
                            message.type === "success"
                                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        }`}
                    >
                        {message.text}
                    </div>
                )}

                {/* Theme Section */}
                <section className="mb-8 rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-6 transition-colors">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Appearance</h2>

                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Theme</p>
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                Current: <span className="capitalize font-semibold">{theme}</span>
                            </p>
                        </div>
                        <button
                            onClick={toggleTheme}
                            className="rounded-lg bg-blue-50 dark:bg-blue-900/30 px-4 py-2 text-sm font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition"
                        >
                            {theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode"}
                        </button>
                    </div>
                </section>

                {/* Avatar Section */}
                <section className="rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-6 transition-colors">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Avatar</h2>

                    {/* Current Avatar Preview */}
                    <div className="mb-6 p-4 rounded-lg bg-slate-100 dark:bg-slate-700 flex justify-center">
                        <img
                            src={currentAvatarUrl}
                            alt="Current avatar"
                            className="w-24 h-24 rounded-lg border-2 border-slate-300 dark:border-slate-600"
                        />
                    </div>

                    {/* Avatar Style Selection */}
                    <div className="mb-6">
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                            Choose an avatar style:
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {AVATAR_PRESETS.map((style) => (
                                <button
                                    key={style}
                                    onClick={() => handleAvatarChange(style)}
                                    disabled={isSaving}
                                    className={`rounded-lg p-3 transition ${
                                        selectedAvatarStyle === style
                                            ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/30"
                                            : "bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    <div className="flex flex-col items-center gap-2">
                                        <img
                                            src={`https://api.dicebear.com/7.x/${style}/svg?seed=${session.user.id}`}
                                            alt={style}
                                            className="w-12 h-12 rounded"
                                        />
                                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300 text-center capitalize">
                                            {style.replace("-", " ")}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {isSaving && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 text-center">
                            Saving changes...
                        </p>
                    )}
                </section>
            </div>
        </div>
    );
}
