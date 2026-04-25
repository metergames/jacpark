"use client";

import { useState } from "react";
import { useTheme } from "../lib/ThemeContext";
import type { Session } from "@supabase/supabase-js";

interface SettingsModalProps {
    session: Session | null;
    onClose: () => void;
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            onClick={() => onChange(!on)}
            className="relative cursor-pointer flex-shrink-0 transition-all duration-200"
            style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--accent)" : "var(--line)" }}
            role="switch"
            aria-checked={on}
        >
            <div
                className="absolute top-[2px] w-[22px] h-[22px] rounded-full bg-white transition-all duration-200"
                style={{ left: on ? 20 : 2, boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
            />
        </div>
    );
}

function Row({
    label,
    sub,
    children,
    onClick,
    last,
}: {
    label: string;
    sub?: string;
    children?: React.ReactNode;
    onClick?: () => void;
    last?: boolean;
}) {
    return (
        <div
            onClick={onClick}
            className="flex items-center px-4 py-3.5 gap-3"
            style={{
                borderBottom: last ? "none" : "1px solid var(--line)",
                cursor: onClick ? "pointer" : "default",
            }}
        >
            <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold" style={{ color: "var(--foreground)" }}>{label}</div>
                {sub && <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{sub}</div>}
            </div>
            {children}
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="mb-2">
            <div
                className="px-5 py-2 text-[11px] font-extrabold uppercase tracking-[0.06em]"
                style={{ color: "var(--muted)" }}
            >
                {title}
            </div>
            <div
                className="mx-3 overflow-hidden rounded-2xl"
                style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
            >
                {children}
            </div>
        </div>
    );
}

const ChevronRight = () => (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M9 6l6 6-6 6" />
    </svg>
);

export default function SettingsModal({ session, onClose }: SettingsModalProps) {
    const { theme, setTheme } = useTheme();
    const [push, setPush] = useState(true);
    const [haptics, setHaptics] = useState(() => {
        if (typeof localStorage !== "undefined") return localStorage.getItem("haptics") !== "false";
        return true;
    });
    const [units, setUnits] = useState<"metric" | "imperial">(() => {
        if (typeof localStorage !== "undefined") return (localStorage.getItem("units") as "metric" | "imperial") || "metric";
        return "metric";
    });
    const [heatmap, setHeatmap] = useState(true);

    const handleHapticsChange = (v: boolean) => {
        setHaptics(v);
        localStorage.setItem("haptics", String(v));
    };

    const handleUnitsToggle = () => {
        const next = units === "metric" ? "imperial" : "metric";
        setUnits(next);
        localStorage.setItem("units", next);
    };

    return (
        <div
            className="fixed inset-0 z-30 overflow-auto md:hidden"
            style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
        >
            {/* Header */}
            <div
                className="flex items-center gap-3 px-5 mb-2"
                style={{ paddingTop: "calc(3.5rem + max(0px, env(safe-area-inset-top)))", paddingBottom: "0.75rem" }}
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
                <div className="text-[24px] font-extrabold tracking-tight">Settings</div>
            </div>

            {/* Appearance */}
            <Section title="Appearance">
                <div className="p-3">
                    <div
                        className="grid grid-cols-3 gap-1.5 p-1 rounded-xl"
                        style={{ backgroundColor: "var(--surface-strong)" }}
                    >
                        {(["light", "dark", "auto"] as const).map((k) => {
                            const labels = { light: "Light", dark: "Dark", auto: "Auto" };
                            const icons = { light: "☀️", dark: "🌙", auto: "✨" };
                            const sel = theme === k;
                            return (
                                <button
                                    key={k}
                                    onClick={() => setTheme(k)}
                                    className="flex items-center justify-center gap-1.5 py-2.5 rounded-[10px] text-xs font-bold transition"
                                    style={{
                                        backgroundColor: sel ? "var(--surface)" : "transparent",
                                        color: sel ? "var(--foreground)" : "var(--muted)",
                                        border: "none",
                                        boxShadow: sel ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                                    }}
                                >
                                    {icons[k]} {labels[k]}
                                </button>
                            );
                        })}
                    </div>
                    {theme === "auto" && (
                        <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
                            Auto switches at sunrise / sunset.
                        </p>
                    )}
                </div>
            </Section>

            {/* Notifications */}
            <Section title="Notifications">
                <Row label="Push notifications" sub="Daily challenge reminders, achievements">
                    <Toggle on={push} onChange={setPush} />
                </Row>
                <Row label="Quiet hours" sub="22:00 – 07:00" onClick={() => {}} last>
                    <span style={{ color: "var(--muted)" }}><ChevronRight /></span>
                </Row>
            </Section>

            {/* Map & data */}
            <Section title="Map & data">
                <Row label="Haptic feedback" sub="Buzz on report submit">
                    <Toggle on={haptics} onChange={handleHapticsChange} />
                </Row>
                <Row label="Distance units" sub={units === "metric" ? "Metric (m / km)" : "Imperial (ft / mi)"} onClick={handleUnitsToggle}>
                    <span className="text-[13px] font-bold" style={{ color: "var(--accent)" }}>
                        {units === "metric" ? "Metric" : "Imperial"}
                    </span>
                </Row>
                <Row label="Show heatmap" sub="Detailed live density" last>
                    <Toggle on={heatmap} onChange={setHeatmap} />
                </Row>
            </Section>

            {/* Account */}
            <Section title="Account">
                {session?.user && (
                    <Row label="Signed in as" sub={session.user.email ?? "Unknown"}>
                        <span />
                    </Row>
                )}
                <Row label="Privacy" sub="Reports are anonymous" onClick={() => {}}>
                    <ChevronRight />
                </Row>
                <Row label="Help & feedback" onClick={() => {}} last>
                    <ChevronRight />
                </Row>
            </Section>

            <div
                className="text-center text-[11px] py-6"
                style={{ color: "var(--muted)", paddingBottom: "calc(1.5rem + max(0px, env(safe-area-inset-bottom)))" }}
            >
                Omnilots · v2.0 · made for students
            </div>
        </div>
    );
}
