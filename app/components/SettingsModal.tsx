"use client";

import { useState } from "react";
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

interface SettingsModalProps {
    session: Session | null;
    onClose: () => void;
}

export default function SettingsModal({ session, onClose }: SettingsModalProps) {
    const { theme, toggleTheme } = useTheme();
    const [selectedAvatarStyle, setSelectedAvatarStyle] = useState(
        session?.user.user_metadata?.avatarStyle || "avataaars"
    );
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    if (!session?.user) {
        return null;
    }

    const handleAvatarChange = async (style: string) => {
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
            setMessage({ type: "success", text: "Avatar updated!" });
        } catch (error) {
            console.error("Error updating avatar:", error);
            setMessage({ type: "error", text: "Failed to update avatar." });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="max-h-[90dvh] w-full max-w-md overflow-auto rounded-2xl border border-slate-300/80 bg-white/92 p-6 shadow-xl backdrop-blur-sm">
                {/* Header */}
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
                    <button
                        onClick={onClose}
                        className="rounded-lg hover:bg-slate-100 p-1 text-slate-600 transition"
                    >
                        ✕
                    </button>
                </div>

                {/* Message */}
                {message && (
                    <div
                        className={`mb-4 rounded-lg px-3 py-2 text-xs font-medium ${
                            message.type === "success"
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                        }`}
                    >
                        {message.text}
                    </div>
                )}

                {/* Theme Section */}
                <div className="mb-6 pb-6 border-b border-slate-200">
                    <h3 className="mb-3 text-sm font-semibold text-slate-900">Appearance</h3>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-slate-600">
                                Current: <span className="capitalize font-medium">{theme}</span>
                            </p>
                        </div>
                        <button
                            onClick={toggleTheme}
                            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
                        >
                            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
                        </button>
                    </div>
                </div>

                {/* Avatar Section */}
                <div>
                    <h3 className="mb-3 text-sm font-semibold text-slate-900">Avatar</h3>

                    {/* Current Avatar Preview */}
                    <div className="mb-4 flex justify-center rounded-lg bg-slate-100 p-3">
                        <img
                            src={`https://api.dicebear.com/7.x/${selectedAvatarStyle}/svg?seed=${session.user.id}`}
                            alt="Current avatar"
                            className="h-16 w-16 rounded-lg border border-slate-300"
                        />
                    </div>

                    {/* Avatar Style Selection */}
                    <p className="mb-3 text-xs font-medium text-slate-700">Choose a style:</p>
                    <div className="grid grid-cols-3 gap-2">
                        {AVATAR_PRESETS.map((style) => (
                            <button
                                key={style}
                                onClick={() => handleAvatarChange(style)}
                                disabled={isSaving}
                                className={`rounded-lg p-2 transition ${
                                    selectedAvatarStyle === style
                                        ? "ring-2 ring-blue-500 bg-blue-50"
                                        : "bg-slate-100 hover:bg-slate-200"
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                <img
                                    src={`https://api.dicebear.com/7.x/${style}/svg?seed=${session.user.id}`}
                                    alt={style}
                                    className="h-10 w-10 rounded mx-auto"
                                />
                            </button>
                        ))}
                    </div>

                    {isSaving && (
                        <p className="mt-2 text-xs text-slate-600 text-center">
                            Saving...
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
