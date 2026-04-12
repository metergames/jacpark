"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getUserRank } from "../lib/leaderboard";
import { getSupabaseBrowserClient } from "../lib/supabaseBrowser";

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
}

export default function UserDashboard({
    session,
    onSignOut,
    isSigningOut,
    onSettingsClick,
    onLeaderboardClick,
    onClose,
    onPremiumStatusChange,
}: UserDashboardProps) {
    const [userPoints, setUserPoints] = useState<number>(0);
    const [userRank, setUserRank] = useState<number | null>(null);
    const [userReports, setUserReports] = useState<number>(0);
    const [premiumExpiresAt, setPremiumExpiresAt] = useState<string | null>(null);
    const [premiumMonthCostPoints, setPremiumMonthCostPoints] = useState<number>(60);
    const [hasSavedCar, setHasSavedCar] = useState<boolean>(false);
    const [premiumFeedback, setPremiumFeedback] = useState<string>("");
    const [isBuyingPremium, setIsBuyingPremium] = useState<boolean>(false);

    const isPremiumActive = useMemo(() => {
        if (!premiumExpiresAt) {
            return false;
        }

        const expiresMs = Date.parse(premiumExpiresAt);

        if (Number.isNaN(expiresMs)) {
            return false;
        }

        return expiresMs > Date.now();
    }, [premiumExpiresAt]);

    const formattedPremiumExpiry = useMemo(() => {
        if (!premiumExpiresAt) {
            return "";
        }

        const parsedDate = new Date(premiumExpiresAt);

        if (Number.isNaN(parsedDate.getTime())) {
            return "";
        }

        return parsedDate.toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }, [premiumExpiresAt]);

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
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });

        const payload = (await response.json().catch(() => ({}))) as Partial<PremiumStatus> & { error?: string };

        if (!response.ok) {
            throw new Error(payload.error ?? "Unable to load premium status.");
        }

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
        if (!session?.user?.id || !session.access_token) {
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

                let premiumStatus: PremiumStatus | null = null;

                try {
                    premiumStatus = await loadPremiumStatus(session.access_token);
                } catch {
                    premiumStatus = null;
                }

                if (!isActive) {
                    return;
                }

                setUserPoints(rankData?.points ?? 0);
                setUserRank(rankData?.rank ?? null);
                setUserReports(count ?? 0);

                if (premiumStatus) {
                    applyPremiumStatus(premiumStatus);
                }
            } catch {
                if (!isActive) {
                    return;
                }

                setUserPoints(0);
                setUserRank(null);
                setUserReports(0);
                setPremiumExpiresAt(null);
                setHasSavedCar(false);
            }
        };

        void loadProfileStats();

        return () => {
            isActive = false;
        };
    }, [session?.user?.id, session?.access_token, applyPremiumStatus, loadPremiumStatus]);

    const handlePurchasePremium = useCallback(async (): Promise<void> => {
        if (!session?.access_token || isBuyingPremium) {
            return;
        }

        setIsBuyingPremium(true);
        setPremiumFeedback("");

        try {
            const response = await fetch("/api/premium", {
                method: "POST",
                cache: "no-store",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ months: 1 }),
            });

            const payload = (await response.json().catch(() => ({}))) as Partial<PremiumStatus> & { error?: string };

            if (!response.ok) {
                setPremiumFeedback(payload.error ?? "Unable to purchase premium.");
                return;
            }

            const premiumStatus: PremiumStatus = {
                points: Number.isFinite(payload.points) ? Number(payload.points) : userPoints,
                premiumExpiresAt: typeof payload.premiumExpiresAt === "string" ? payload.premiumExpiresAt : premiumExpiresAt,
                isPremium: Boolean(payload.isPremium),
                premiumMonthCostPoints: Number.isFinite(payload.premiumMonthCostPoints)
                    ? Number(payload.premiumMonthCostPoints)
                    : premiumMonthCostPoints,
                parkedCarLocation:
                    payload.parkedCarLocation &&
                    typeof payload.parkedCarLocation.latitude === "number" &&
                    typeof payload.parkedCarLocation.longitude === "number" &&
                    typeof payload.parkedCarLocation.parkedAt === "string"
                        ? payload.parkedCarLocation
                        : null,
            };

            applyPremiumStatus(premiumStatus);
            setPremiumFeedback(premiumStatus.isPremium ? "Premium time added successfully." : "Premium updated.");
        } catch {
            setPremiumFeedback("Unable to purchase premium.");
        } finally {
            setIsBuyingPremium(false);
        }
    }, [session?.access_token, isBuyingPremium, applyPremiumStatus, userPoints, premiumExpiresAt, premiumMonthCostPoints]);

    if (!session?.user) {
        return null;
    }

    const userName =
        typeof session.user.user_metadata?.full_name === "string"
            ? session.user.user_metadata.full_name
            : session.user.email?.split("@")[0] || "User";

    return (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 sm:absolute sm:inset-auto sm:top-3 sm:right-3 sm:z-10 sm:bg-transparent sm:backdrop-blur-none sm:p-0">
            <div
                className="w-full max-h-[90dvh] sm:max-h-none sm:w-auto rounded-2xl sm:rounded-2xl shadow-xl p-4 sm:p-4 backdrop-blur-sm overflow-auto"
                style={{
                    backgroundColor: "var(--surface)",
                    borderColor: "var(--line)",
                    borderWidth: "1px",
                    color: "var(--foreground)",
                }}
            >
                {/* Header with close button */}
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg sm:text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                        Profile
                    </h3>
                    <button onClick={onClose} className="transition text-2xl sm:text-base" style={{ color: "var(--muted)" }}>
                        ✕
                    </button>
                </div>

                {/* User info */}
                <div className="mb-4 pb-4" style={{ borderBottomColor: "var(--line)", borderBottomWidth: "1px" }}>
                    <h4 className="font-semibold text-base sm:text-sm" style={{ color: "var(--foreground)" }}>
                        {userName}
                    </h4>
                    <p className="text-xs sm:text-xs" style={{ color: "var(--muted)" }}>
                        {session.user.email}
                    </p>
                </div>

                {/* Points card */}
                <div
                    className="rounded-lg p-4 mb-4"
                    style={{
                        background: "linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(5, 150, 105, 0.2))",
                        borderColor: "rgba(34, 197, 94, 0.4)",
                        borderWidth: "1px",
                    }}
                >
                    <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>
                        Your Points
                    </p>
                    <p className="text-3xl sm:text-2xl font-bold text-green-500">{userPoints}</p>
                    <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                        Earn points from reports
                    </p>

                    <div
                        className="mt-3 rounded-lg p-3"
                        style={{
                            background: isPremiumActive
                                ? "linear-gradient(135deg, rgba(250, 204, 21, 0.22), rgba(245, 158, 11, 0.2))"
                                : "rgba(15, 23, 42, 0.22)",
                            borderColor: isPremiumActive ? "rgba(245, 158, 11, 0.42)" : "rgba(148, 163, 184, 0.36)",
                            borderWidth: "1px",
                        }}
                    >
                        <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                            {isPremiumActive ? "Premium Active" : "Premium Locked"}
                        </p>
                        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                            {isPremiumActive ? `Expires ${formattedPremiumExpiry || "soon"}` : "Unlock heatmaps + Find My Car."}
                        </p>
                        <button
                            onClick={() => {
                                void handlePurchasePremium();
                            }}
                            disabled={isBuyingPremium || userPoints < premiumMonthCostPoints}
                            className="mt-2 w-full rounded-lg px-3 py-2 text-xs font-semibold transition"
                            style={{
                                backgroundColor:
                                    isBuyingPremium || userPoints < premiumMonthCostPoints
                                        ? "rgba(148, 163, 184, 0.34)"
                                        : "rgba(15, 163, 127, 0.82)",
                                color: "white",
                                cursor: isBuyingPremium || userPoints < premiumMonthCostPoints ? "not-allowed" : "pointer",
                                opacity: isBuyingPremium ? 0.75 : 1,
                            }}
                        >
                            {isBuyingPremium
                                ? "Processing..."
                                : `${isPremiumActive ? "Add" : "Buy"} 1 month (${premiumMonthCostPoints} points)`}
                        </button>

                        {userPoints < premiumMonthCostPoints ? (
                            <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
                                Need {premiumMonthCostPoints - userPoints} more points.
                            </p>
                        ) : null}

                        {hasSavedCar && isPremiumActive ? (
                            <p className="mt-2 text-[11px] text-emerald-600">Find My Car is ready on the map.</p>
                        ) : null}

                        {premiumFeedback ? (
                            <p className="mt-2 text-[11px] font-medium" style={{ color: "var(--foreground)" }}>
                                {premiumFeedback}
                            </p>
                        ) : null}
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                    <div
                        className="rounded-lg p-3 sm:p-3 text-center"
                        style={{
                            background: "rgba(59, 130, 246, 0.15)",
                            borderColor: "rgba(59, 130, 246, 0.3)",
                            borderWidth: "1px",
                        }}
                    >
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                            Reports
                        </p>
                        <p className="text-2xl sm:text-lg font-semibold text-blue-500">{userReports}</p>
                    </div>
                    <div
                        className="rounded-lg p-3 sm:p-3 text-center"
                        style={{
                            background: "rgba(147, 51, 234, 0.15)",
                            borderColor: "rgba(147, 51, 234, 0.3)",
                            borderWidth: "1px",
                        }}
                    >
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                            Rank
                        </p>
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
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-strong)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
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
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-strong)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
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
