"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { useTheme } from "../lib/ThemeContext";
import type { Session } from "@supabase/supabase-js";

export default function SettingsPage() {
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const checkSession = async () => {
            try {
                const supabase = getSupabaseBrowserClient();
                const { data } = await supabase.auth.getSession();
                if (data.session) {
                    setSession(data.session);
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

                {/* Theme Section */}
                <section className="rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-6 transition-colors">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Appearance</h2>

                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                        Choose your theme:
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                        <button
                            onClick={() => setTheme("dark")}
                            className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
                                theme === "dark"
                                    ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/30"
                                    : "bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
                            }`}
                        >
                            🌙 Dark
                        </button>
                        <button
                            onClick={() => setTheme("light")}
                            className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
                                theme === "light"
                                    ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/30"
                                    : "bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
                            }`}
                        >
                            ☀️ Light
                        </button>
                        <button
                            onClick={() => setTheme("auto")}
                            className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
                                theme === "auto"
                                    ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/30"
                                    : "bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
                            }`}
                        >
                            🌅 Auto
                        </button>
                    </div>
                    {theme === "auto" && (
                        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                            Theme changes based on sunrise and sunset
                        </p>
                    )}
                </section>
            </div>
        </div>
    );
}
