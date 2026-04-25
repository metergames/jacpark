"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getUserRank } from "../lib/leaderboard";
import { getSupabaseBrowserClient } from "../lib/supabaseBrowser";
import { computeAchievements, computeDistinctLots, computeLevel } from "../lib/gamification";

export type PremiumStatus = {
    points: number;
    premiumExpiresAt: string | null;
    isPremium: boolean;
    premiumMonthCostPoints: number;
    parkedCarLocation: {
        latitude: number;
        longitude: number;
        parkedAt: string;
    } | null;
};

interface UserDashboardProps {
    session: Session | null;
    onSignOut: () => Promise<void>;
    isSigningOut: boolean;
    onSettingsClick: () => void;
    onLeaderboardClick: () => void;
    onClose: () => void;
    onPremiumStatusChange?: (status: PremiumStatus) => void;
    streakDays?: number;
}

const ChevronRightIcon = () => (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6l6 6-6 6" />
    </svg>
);

const CrownIcon = () => (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" />
    </svg>
);

const PinIcon = () => (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z" />
        <circle cx="12" cy="9" r="2.5" />
    </svg>
);

const TrophyIcon = () => (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 1 1-10 0V4z" />
        <path d="M17 6h2a2 2 0 0 1 0 4h-2M7 6H5a2 2 0 0 0 0 4h2" />
    </svg>
);

const GearIcon = () => (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
);

export default function UserDashboard({
    session,
    onSignOut,
    isSigningOut,
    onSettingsClick,
    onLeaderboardClick,
    onClose,
    onPremiumStatusChange,
    streakDays = 0,
}: UserDashboardProps) {
    const [userPoints, setUserPoints] = useState<number>(0);
    const [userRank, setUserRank] = useState<number | null>(null);
    const [userReports, setUserReports] = useState<number>(0);
    const [distinctLots, setDistinctLots] = useState<number>(0);
    const [premiumExpiresAt, setPremiumExpiresAt] = useState<string | null>(null);
    const [premiumMonthCostPoints, setPremiumMonthCostPoints] = useState<number>(60);
    const [hasSavedCar, setHasSavedCar] = useState<boolean>(false);
    const [premiumFeedback, setPremiumFeedback] = useState<string>("");
    const [isBuyingPremium, setIsBuyingPremium] = useState<boolean>(false);

    const isPremiumActive = useMemo(() => {
        if (!premiumExpiresAt) return false;
        const expiresMs = Date.parse(premiumExpiresAt);
        return !Number.isNaN(expiresMs) && expiresMs > Date.now();
    }, [premiumExpiresAt]);

    const formattedPremiumExpiry = useMemo(() => {
        if (!premiumExpiresAt) return "";
        const d = new Date(premiumExpiresAt);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    }, [premiumExpiresAt]);

    const levelData = useMemo(() => computeLevel(userPoints), [userPoints]);

    const achievements = useMemo(
        () => computeAchievements({ totalReports: userReports, streakDays, rank: userRank, distinctLots }),
        [userReports, streakDays, userRank, distinctLots],
    );

    const applyPremiumStatus = useCallback(
        (status: PremiumStatus): void => {
            setUserPoints(status.points);
            setPremiumExpiresAt(status.premiumExpiresAt);
            setPremiumMonthCostPoints(status.premiumMonthCostPoints);
            setHasSavedCar(Boolean(status.parkedCarLocation));
            onPremiumStatusChange?.(status);
        },
        [onPremiumStatusChange],
    );

    const loadPremiumStatus = useCallback(async (accessToken: string): Promise<PremiumStatus | null> => {
        const response = await fetch("/api/premium", {
            method: "GET",
            cache: "no-store",
            headers: { authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<PremiumStatus> & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load premium status.");
        return {
            points: Number.isFinite(payload.points) ? Number(payload.points) : 0,
            premiumExpiresAt: typeof payload.premiumExpiresAt === "string" ? payload.premiumExpiresAt : null,
            isPremium: Boolean(payload.isPremium),
            premiumMonthCostPoints: Number.isFinite(payload.premiumMonthCostPoints) ? Number(payload.premiumMonthCostPoints) : 60,
            parkedCarLocation:
                payload.parkedCarLocation &&
                typeof payload.parkedCarLocation.latitude === "number" &&
                typeof payload.parkedCarLocation.longitude === "number" &&
                typeof payload.parkedCarLocation.parkedAt === "string"
                    ? payload.parkedCarLocation
                    : null,
        };
    }, []);

    useEffect(() => {
        if (!session?.user?.id || !session.access_token) return;
        let isActive = true;

        const load = async () => {
            try {
                const [rankData, premiumStatus, lotsCount] = await Promise.all([
                    getUserRank(session.user.id),
                    loadPremiumStatus(session.access_token).catch(() => null),
                    computeDistinctLots(session.user.id),
                ]);

                const supabase = getSupabaseBrowserClient();
                const { count } = await supabase
                    .from("parking_reports")
                    .select("id", { count: "exact", head: true })
                    .eq("user_id", session.user.id);

                if (!isActive) return;

                setUserPoints(rankData?.points ?? 0);
                setUserRank(rankData?.rank ?? null);
                setUserReports(count ?? 0);
                setDistinctLots(lotsCount);
                if (premiumStatus) applyPremiumStatus(premiumStatus);
            } catch {
                if (!isActive) return;
                setUserPoints(0);
                setUserRank(null);
                setUserReports(0);
            }
        };

        void load();
        return () => { isActive = false; };
    }, [session?.user?.id, session?.access_token, applyPremiumStatus, loadPremiumStatus]);

    const handlePurchasePremium = useCallback(async (): Promise<void> => {
        if (!session?.access_token || isBuyingPremium) return;
        setIsBuyingPremium(true);
        setPremiumFeedback("");
        try {
            const response = await fetch("/api/premium", {
                method: "POST",
                cache: "no-store",
                headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ months: 1 }),
            });
            const payload = (await response.json().catch(() => ({}))) as Partial<PremiumStatus> & { error?: string };
            if (!response.ok) {
                setPremiumFeedback(payload.error ?? "Unable to purchase premium.");
                return;
            }
            const status: PremiumStatus = {
                points: Number.isFinite(payload.points) ? Number(payload.points) : userPoints,
                premiumExpiresAt: typeof payload.premiumExpiresAt === "string" ? payload.premiumExpiresAt : premiumExpiresAt,
                isPremium: Boolean(payload.isPremium),
                premiumMonthCostPoints: Number.isFinite(payload.premiumMonthCostPoints) ? Number(payload.premiumMonthCostPoints) : premiumMonthCostPoints,
                parkedCarLocation: null,
            };
            applyPremiumStatus(status);
            setPremiumFeedback(status.isPremium ? "Premium activated!" : "Premium updated.");
        } catch {
            setPremiumFeedback("Unable to purchase premium.");
        } finally {
            setIsBuyingPremium(false);
        }
    }, [session?.access_token, isBuyingPremium, applyPremiumStatus, userPoints, premiumExpiresAt, premiumMonthCostPoints]);

    if (!session?.user) return null;

    const userName =
        typeof session.user.user_metadata?.full_name === "string"
            ? session.user.user_metadata.full_name
            : session.user.email?.split("@")[0] ?? "User";

    const initial = userName.charAt(0).toUpperCase();

    return (
        <div
            className="fixed inset-0 z-30 overflow-auto md:hidden"
            style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
        >
            <div className="px-5" style={{ paddingTop: "calc(3.5rem + max(0px, env(safe-area-inset-top)))", paddingBottom: "2.5rem" }}>
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                    <div className="text-[26px] font-extrabold tracking-tight">You</div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
                        aria-label="Close profile"
                    >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </div>

                {/* User identity */}
                <div className="flex items-center gap-3.5 mb-4">
                    <div
                        className="w-[60px] h-[60px] rounded-full flex items-center justify-center font-extrabold text-2xl text-white flex-shrink-0"
                        style={{ background: "linear-gradient(135deg, var(--accent), #5b8df7)" }}
                    >
                        {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[18px] font-extrabold truncate">{userName}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                            Level {levelData.level} · {levelData.title}
                        </div>
                    </div>
                    {isPremiumActive && (
                        <div
                            className="px-2.5 py-1 rounded-full text-[11px] font-extrabold flex-shrink-0"
                            style={{ background: "var(--accent)", color: "#fff" }}
                        >
                            PRO
                        </div>
                    )}
                </div>

                {/* Level progress */}
                <div className="mb-4">
                    <div className="flex justify-between text-[11px] font-bold mb-1.5" style={{ color: "var(--muted)" }}>
                        <span>Lv {levelData.level}</span>
                        <span style={{ fontFamily: "var(--font-geist-mono, monospace)" }}>
                            {userPoints} / {levelData.nextPts} → Lv {levelData.level + 1}
                        </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--line)" }}>
                        <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                                width: `${Math.round(levelData.progress * 100)}%`,
                                background: "linear-gradient(90deg, var(--accent), #5b8df7)",
                            }}
                        />
                    </div>
                </div>

                {/* 3-stat row */}
                <div className="grid grid-cols-3 gap-2 mb-3.5">
                    {[
                        { label: "Points", value: String(userPoints), color: "var(--accent)", mono: true },
                        { label: "Streak", value: `${streakDays}d`, color: "var(--streak)" },
                        { label: "Rank", value: userRank ? `#${userRank}` : "—", color: "#10b981" },
                    ].map((s) => (
                        <div
                            key={s.label}
                            className="py-3 px-2.5 rounded-[14px]"
                            style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
                        >
                            <div className="text-[10px] font-bold mb-1" style={{ color: "var(--muted)" }}>{s.label}</div>
                            <div
                                className="text-xl font-extrabold"
                                style={{
                                    color: s.color,
                                    fontFamily: s.mono ? "var(--font-geist-mono, monospace)" : undefined,
                                }}
                            >
                                {s.value}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Premium card */}
                <div
                    className="p-3.5 rounded-2xl mb-3.5"
                    style={{
                        background: isPremiumActive
                            ? "linear-gradient(135deg, rgba(34,211,194,0.14), rgba(34,211,194,0.04))"
                            : "var(--surface)",
                        border: `1px solid ${isPremiumActive ? "rgba(34,211,194,0.3)" : "var(--line)"}`,
                    }}
                >
                    <div className="flex items-center gap-2 mb-2" style={{ color: "var(--accent)" }}>
                        <CrownIcon />
                        <span className="text-[13px] font-extrabold">
                            {isPremiumActive ? `Premium · until ${formattedPremiumExpiry || "soon"}` : "Premium"}
                        </span>
                    </div>
                    <div className="text-[11px] mb-3" style={{ color: "var(--muted)" }}>
                        {isPremiumActive
                            ? "Live heatmap · report history · custom themes"
                            : "Unlock detailed heatmap, report history, and Find My Car."}
                    </div>
                    <button
                        onClick={() => { void handlePurchasePremium(); }}
                        disabled={isBuyingPremium || userPoints < premiumMonthCostPoints}
                        className="w-full py-2.5 rounded-xl text-[13px] font-extrabold transition disabled:cursor-not-allowed"
                        style={{
                            backgroundColor: isBuyingPremium || userPoints < premiumMonthCostPoints ? "var(--line)" : "var(--foreground)",
                            color: isBuyingPremium || userPoints < premiumMonthCostPoints ? "var(--muted)" : "var(--background)",
                            opacity: isBuyingPremium ? 0.7 : 1,
                        }}
                    >
                        {isBuyingPremium
                            ? "Processing..."
                            : `${isPremiumActive ? "Add" : "Buy"} 1 month · ${premiumMonthCostPoints} pts`}
                    </button>
                    {userPoints < premiumMonthCostPoints && (
                        <p className="mt-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
                            Need {premiumMonthCostPoints - userPoints} more points.
                        </p>
                    )}
                    {premiumFeedback && (
                        <p className="mt-1.5 text-[11px] font-semibold" style={{ color: "var(--foreground)" }}>
                            {premiumFeedback}
                        </p>
                    )}
                </div>

                {/* Achievements */}
                <div className="mb-3.5">
                    <div className="flex justify-between items-center mb-2">
                        <div className="text-[13px] font-extrabold">Achievements</div>
                        <div className="text-[11px] font-bold" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono, monospace)" }}>
                            {achievements.filter((a) => a.earned).length} / {achievements.length}
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {achievements.map((badge) => (
                            <div
                                key={badge.id}
                                className="py-2.5 px-1.5 rounded-xl text-center"
                                style={{
                                    backgroundColor: badge.earned ? "var(--surface)" : "var(--surface-strong)",
                                    border: `1px solid ${badge.earned ? "rgba(34,211,194,0.22)" : "var(--line)"}`,
                                    opacity: badge.earned ? 1 : 0.45,
                                }}
                                title={badge.description}
                            >
                                <div
                                    className="text-[22px] mb-1"
                                    style={{ filter: badge.earned ? "none" : "grayscale(1)" }}
                                >
                                    {badge.emoji}
                                </div>
                                <div className="text-[10px] font-bold leading-tight" style={{ color: "var(--foreground)" }}>
                                    {badge.name}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Find My Car (premium only) */}
                {isPremiumActive && (
                    <div
                        className="flex items-center gap-3 p-3 rounded-[14px] mb-2 cursor-pointer"
                        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
                    >
                        <div
                            className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
                            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                        >
                            <PinIcon />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-extrabold">Find My Car</div>
                            <div className="text-xs" style={{ color: "var(--muted)" }}>
                                {hasSavedCar ? "Saved location available on map" : "Park first to save your spot"}
                            </div>
                        </div>
                        <ChevronRightIcon />
                    </div>
                )}

                {/* Nav rows */}
                {[
                    { icon: <TrophyIcon />, label: "Leaderboard", sub: userRank ? `Currently #${userRank}` : "See rankings", onClick: onLeaderboardClick },
                    { icon: <GearIcon />, label: "Settings", sub: "Theme · push · account", onClick: onSettingsClick },
                ].map((row) => (
                    <div
                        key={row.label}
                        onClick={row.onClick}
                        className="flex items-center gap-3 p-3 rounded-[14px] mb-2 cursor-pointer"
                        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
                    >
                        <div
                            className="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: "var(--surface-strong)", color: "var(--foreground)" }}
                        >
                            {row.icon}
                        </div>
                        <div className="flex-1">
                            <div className="text-[14px] font-extrabold">{row.label}</div>
                            <div className="text-xs" style={{ color: "var(--muted)" }}>{row.sub}</div>
                        </div>
                        <ChevronRightIcon />
                    </div>
                ))}

                {/* Sign out */}
                <button
                    onClick={() => { void onSignOut(); }}
                    disabled={isSigningOut}
                    className="w-full py-3 rounded-[14px] text-[14px] font-bold mt-3 transition disabled:opacity-50"
                    style={{
                        background: "transparent",
                        border: "1px solid rgba(239,68,68,0.3)",
                        color: "#ef4444",
                    }}
                >
                    {isSigningOut ? "Signing out..." : "Sign out"}
                </button>
            </div>
        </div>
    );
}
