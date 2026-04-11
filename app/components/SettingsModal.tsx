"use client";

import { useTheme } from "../lib/ThemeContext";
import type { Session } from "@supabase/supabase-js";

interface SettingsModalProps {
    session: Session | null;
    onClose: () => void;
}

export default function SettingsModal({ session, onClose }: SettingsModalProps) {
    const { theme, setTheme } = useTheme();

    if (!session?.user) {
        return null;
    }

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
                    <h2 className="text-lg font-semibold">Settings</h2>
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

                {/* Theme Section */}
                <div style={{ borderBottomColor: "var(--line)", borderBottomWidth: "1px" }}>
                    <h3 className="mb-3 text-sm font-semibold">Appearance</h3>
                    <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
                        Choose your theme:
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            onClick={() => setTheme("dark")}
                            className="rounded-lg px-3 py-2 text-xs font-semibold transition"
                            style={{
                                backgroundColor: theme === "dark" ? "rgba(59, 130, 246, 0.2)" : "var(--surface-strong)",
                                borderColor: theme === "dark" ? "#3b82f6" : "var(--line)",
                                borderWidth: "1px",
                                color: "var(--foreground)",
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = "0.8"}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
                        >
                            🌙 Dark
                        </button>
                        <button
                            onClick={() => setTheme("light")}
                            className="rounded-lg px-3 py-2 text-xs font-semibold transition"
                            style={{
                                backgroundColor: theme === "light" ? "rgba(59, 130, 246, 0.2)" : "var(--surface-strong)",
                                borderColor: theme === "light" ? "#3b82f6" : "var(--line)",
                                borderWidth: "1px",
                                color: "var(--foreground)",
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = "0.8"}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
                        >
                            ☀️ Light
                        </button>
                        <button
                            onClick={() => setTheme("auto")}
                            className="rounded-lg px-3 py-2 text-xs font-semibold transition"
                            style={{
                                backgroundColor: theme === "auto" ? "rgba(59, 130, 246, 0.2)" : "var(--surface-strong)",
                                borderColor: theme === "auto" ? "#3b82f6" : "var(--line)",
                                borderWidth: "1px",
                                color: "var(--foreground)",
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = "0.8"}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
                        >
                            🌅 Auto
                        </button>
                    </div>
                    {theme === "auto" && (
                        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                            Theme changes based on sunrise and sunset
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
