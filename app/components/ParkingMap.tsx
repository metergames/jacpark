"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type TouchEvent } from "react";
import { useRouter } from "next/navigation";
import type { FeatureCollection, Polygon } from "geojson";
import type { Session } from "@supabase/supabase-js";
import mapboxgl from "mapbox-gl";
import useCampusProximity from "../hooks/useCampusProximity";
import { CAMPUS_RADIUS_METERS, type LatLng } from "../lib/geo";
import { PARKING_LOTS, getLotForLocation } from "../lib/lots";
import { buildHeatmapFeatures, buildHeatmapPaint, type HeatmapReport } from "../lib/heatmap";
import { getSupabaseBrowserClient } from "../lib/supabaseBrowser";
import { useTheme } from "../lib/ThemeContext";
import { checkAndRequestNotificationPermission, showNotification, subscribeToPushNotifications } from "../lib/notifications";
import { computeStreak } from "../lib/gamification";
import UserDashboard, { type PremiumStatus } from "./UserDashboard";
import SettingsModal from "./SettingsModal";
import LeaderboardModal from "./LeaderboardModal";
import "mapbox-gl/dist/mapbox-gl.css";

type LngLatTuple = [number, number];

type ParkingAvailability = "open" | "limited" | "full";
type ReportActionType = "parked" | "leaving" | "observing";

type ParkingReport = {
    id: string;
    lotName: string;
    availability: ParkingAvailability;
    actionType: ReportActionType;
    fullnessLevel: number | null;
    note: string;
    distanceToCampusMeters: number;
    createdAt: string;
    reporterLatitude: number;
    reporterLongitude: number;
};

type ViewerParkingState = {
    latestActionType: "parked" | "leaving" | null;
    latestActionAt: string | null;
    isParkedToday: boolean;
};

type ReportsResponse = {
    reports?: ParkingReport[];
    viewerParkingState?: ViewerParkingState | null;
    error?: string;
};

type PremiumStatusResponse = Partial<PremiumStatus> & {
    error?: string;
};

type ZoneAvailabilityState = "open" | "limited" | "full";

type ReportResponse = {
    report?: ParkingReport;
    error?: string;
};


const JOHN_ABBOTT_CENTER: LngLatTuple = [-73.94212693281301, 45.408822013619336];
const JOHN_ABBOTT_ZOOM = 16;
const LIGHT_STYLE_URL = "mapbox://styles/mapbox/standard";
const BOUNDARY_SOURCE_ID = "parking-boundary-source";
const BOUNDARY_FILL_LAYER_ID = "parking-boundary-fill";
const BOUNDARY_LINE_LAYER_ID = "parking-boundary-line";
const LOT_LABELS_SOURCE_ID = "parking-lot-labels-source";
const LOT_LABELS_LAYER_ID = "parking-lot-labels-layer";
const REPORTS_HEATMAP_SOURCE_ID = "parking-reports-heatmap";
const REPORTS_HEATMAP_LAYER_ID = "parking-reports-heatmap-layer";
const HEATMAP_REPORTS_LIMIT = 120;
const FAST_REPORTS_REFRESH_INTERVAL_MS = 10000;
const SLOW_REPORTS_REFRESH_INTERVAL_MS = 90000;
const FAST_REFRESH_DISTANCE_METERS = 2000;
const SWIPE_DISMISS_THRESHOLD_PX = 90;
const SWIPE_UP_DISMISS_THRESHOLD_PX = 70;
const PANEL_SWIPE_CLOSE_THRESHOLD_PX = 100;
const USER_LOCATION_MARKER_CLASS_NAME = "jac-user-location-marker";
const SUBMIT_RETRY_BASE_DELAY_MS = 400;
const SUBMIT_RETRY_MAX_ATTEMPTS = 3;
const DEV_REPORTS_RESET_ENABLED = process.env.NODE_ENV !== "production";
const DEV_PREMIUM_STORAGE_KEY = "omnilots_dev_premium";
const REPORTS_RESET_KEY_HEADER = "x-omnilots-reset-key";
const DEFAULT_PREMIUM_MONTH_COST_POINTS = 60;

const NON_PREMIUM_ZONE_STYLE: Record<
    ZoneAvailabilityState,
    {
        fillColor: string;
        fillOpacity: number;
        lineColor: string;
    }
> = {
    open: {
        fillColor: "#16a34a",
        fillOpacity: 0.3,
        lineColor: "#166534",
    },
    limited: {
        fillColor: "#f59e0b",
        fillOpacity: 0.3,
        lineColor: "#b45309",
    },
    full: {
        fillColor: "#dc2626",
        fillOpacity: 0.32,
        lineColor: "#991b1b",
    },
};

const TRANSIENT_SUBMIT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

const REPORT_ACTION_CONFIG: Record<ReportActionType, { label: string; description: string }> = {
    parked: {
        label: "I just parked",
        description: "I found a spot and parked right now.",
    },
    leaving: {
        label: "I am leaving now",
        description: "I am leaving and freeing up a spot.",
    },
    observing: {
        label: "I am just checking",
        description: "I am on-site and sharing how full it looks.",
    },
};

const ACTION_BUTTON_RENDER_ORDER: ReportActionType[] = ["parked", "leaving", "observing"];

const ACTION_BUTTON_ENTRANCE_DELAY_MS: Record<ReportActionType, number> = {
    observing: 0,
    leaving: 90,
    parked: 180,
};

const ACTION_BUTTON_VISUALS: Record<
    ReportActionType,
    { gradient: string; borderColor: string; glow: string; iconSurface: string }
> = {
    parked: {
        gradient: "linear-gradient(135deg, rgba(15, 163, 127, 0.94), rgba(5, 122, 85, 0.93))",
        borderColor: "rgba(167, 243, 208, 0.58)",
        glow: "0 16px 32px rgba(6, 95, 70, 0.42)",
        iconSurface: "rgba(209, 250, 229, 0.25)",
    },
    leaving: {
        gradient: "linear-gradient(135deg, rgba(245, 125, 32, 0.94), rgba(194, 65, 12, 0.93))",
        borderColor: "rgba(254, 215, 170, 0.56)",
        glow: "0 16px 32px rgba(154, 52, 18, 0.42)",
        iconSurface: "rgba(255, 237, 213, 0.25)",
    },
    observing: {
        gradient: "linear-gradient(135deg, rgba(14, 165, 233, 0.94), rgba(3, 105, 161, 0.93))",
        borderColor: "rgba(186, 230, 253, 0.56)",
        glow: "0 16px 32px rgba(12, 74, 110, 0.42)",
        iconSurface: "rgba(224, 242, 254, 0.25)",
    },
};

const FULLNESS_DESCRIPTIONS: Record<number, string> = {
    1: "Basically empty. Lots of spots available.",
    2: "Fairly open. You should find a spot quickly.",
    3: "Moderate. You may need to circle once.",
    4: "Almost full. Very limited spots left.",
    5: "There might be one spot somewhere, good luck to the others.",
};

const ACTION_CARD_STYLES: Record<ReportActionType, { selected: string; idle: string; iconBg: string }> = {
    parked: {
        selected: "border-emerald-500 bg-emerald-50 text-emerald-900 shadow-[0_10px_30px_rgba(16,185,129,0.18)]",
        idle: "border-emerald-300/70 bg-[var(--surface)] text-[var(--foreground)] hover:border-emerald-400 hover:bg-[var(--surface-strong)]",
        iconBg: "bg-emerald-100 text-emerald-700",
    },
    leaving: {
        selected: "border-orange-500 bg-orange-50 text-orange-900 shadow-[0_10px_30px_rgba(251,146,60,0.2)]",
        idle: "border-orange-300/70 bg-[var(--surface)] text-[var(--foreground)] hover:border-orange-400 hover:bg-[var(--surface-strong)]",
        iconBg: "bg-orange-100 text-orange-700",
    },
    observing: {
        selected: "border-sky-500 bg-sky-50 text-sky-900 shadow-[0_10px_30px_rgba(14,165,233,0.2)]",
        idle: "border-sky-300/70 bg-[var(--surface)] text-[var(--foreground)] hover:border-sky-400 hover:bg-[var(--surface-strong)]",
        iconBg: "bg-sky-100 text-sky-700",
    },
};

const FULLNESS_BUTTON_STYLES: Record<number, { selected: string; idle: string }> = {
    1: {
        selected: "border-emerald-500 bg-emerald-100 text-emerald-950 dark:bg-emerald-950/65 dark:text-emerald-100",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-emerald-500",
    },
    2: {
        selected: "border-lime-500 bg-lime-100 text-lime-950 dark:bg-lime-950/65 dark:text-lime-100",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-lime-500",
    },
    3: {
        selected: "border-amber-500 bg-amber-100 text-amber-950 dark:bg-amber-950/65 dark:text-amber-100",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-amber-500",
    },
    4: {
        selected: "border-orange-600 bg-orange-200 text-orange-950 dark:bg-orange-950/70 dark:text-orange-100",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-orange-500",
    },
    5: {
        selected:
            "border-red-700 bg-red-600 text-white shadow-[0_12px_24px_rgba(185,28,28,0.35)] dark:bg-red-700 dark:text-red-50",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-red-500",
    },
};

const FULLNESS_ICON_SELECTED_COLORS: Record<number, string> = {
    1: "#16a34a",
    2: "#65a30d",
    3: "#f59e0b",
    4: "#ea580c",
    5: "#b91c1c",
};

const ActionIcon = ({ actionType }: { actionType: ReportActionType }) => {
    if (actionType === "parked") {
        return (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 16h12" />
                <path d="M7 16l1.5-5h7L17 16" />
                <circle cx="8" cy="18" r="1.5" />
                <circle cx="16" cy="18" r="1.5" />
            </svg>
        );
    }

    if (actionType === "leaving") {
        return (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h12" />
                <path d="M13 8l4 4-4 4" />
                <circle cx="5" cy="18" r="1.5" />
            </svg>
        );
    }

    return (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
            <circle cx="12" cy="12" r="2.5" />
        </svg>
    );
};

const ProfileOutlineIcon = () => (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <circle cx="12" cy="7.4" r="3.1" />
        <path d="M5.1 18.7c.85-2.75 3.32-4.68 6.02-4.68" />
        <path d="M18.9 18.7c-.85-2.75-3.32-4.68-6.02-4.68" />
    </svg>
);

const RecenterIcon = () => (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <circle cx="12" cy="12" r="6.4" />
        <circle cx="12" cy="12" r="1.8" />
        <path d="M12 1.9v2.2" />
        <path d="M12 19.9v2.2" />
        <path d="M1.9 12h2.2" />
        <path d="M19.9 12h2.2" />
    </svg>
);

const FullnessIcon = ({ level, selected }: { level: number; selected: boolean }) => (
    <svg viewBox="0 0 28 20" className="h-5 w-7" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => {
            const height = 4 + index * 3;
            const y = 19 - height;
            const filled = index < level;

            return (
                <rect
                    key={index}
                    x={2 + index * 5}
                    y={y}
                    width={3.6}
                    height={height}
                    rx={1}
                    fill={
                        filled
                            ? selected
                                ? FULLNESS_ICON_SELECTED_COLORS[level]
                                : "rgba(51, 65, 85, 0.95)"
                            : selected
                              ? "rgba(148, 163, 184, 0.36)"
                              : "rgba(148, 163, 184, 0.58)"
                    }
                />
            );
        })}
    </svg>
);

const LocateIcon = () => (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
);

const FlameIcon = () => (
    <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 22a7 7 0 0 0 7-7c0-3-2-5-3-7 0 2-1 3-2 3 0-3-2-6-5-9-1 4-4 6-4 11a7 7 0 0 0 7 9z" />
    </svg>
);

const BoltIcon = () => (
    <svg viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
);

const FlagIcon = () => (
    <svg viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
);

const CheckIcon = () => (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M5 12l5 5L20 7" />
    </svg>
);

const PinIcon = () => (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z" />
        <circle cx="12" cy="9" r="2.5" />
    </svg>
);

function PointBurst({ value, onDone }: { value: number; onDone: () => void }) {
    useEffect(() => {
        const t = setTimeout(onDone, 1400);
        return () => clearTimeout(t);
    }, [onDone]);
    return (
        <div className="fixed inset-0 z-50 pointer-events-none flex items-end justify-center pb-64">
            <div
                style={{
                    animation: "point-fly 1.4s cubic-bezier(.2,.7,.3,1) forwards",
                    fontWeight: 900,
                    fontSize: 48,
                    color: "var(--accent)",
                    textShadow: "0 4px 20px rgba(0,0,0,0.4)",
                    fontFamily: "var(--font-geist-mono, monospace)",
                }}
            >
                +{value}
            </div>
        </div>
    );
}

const getCurrentPosition = (): Promise<LatLng> =>
    new Promise((resolve, reject) => {
        if (!("geolocation" in navigator)) {
            reject(new Error("Geolocation is not supported by this browser."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                });
            },
            () => {
                reject(new Error("Unable to fetch current location for report submission."));
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 5000,
            },
        );
    });

const resolveReporterLocation = async (currentLocation: LatLng | null): Promise<LatLng> => {
    if (currentLocation) {
        return currentLocation;
    }

    return getCurrentPosition();
};

const deriveAvailabilityFromFullness = (fullnessLevel: number): ParkingAvailability => {
    if (fullnessLevel <= 2) {
        return "open";
    }

    if (fullnessLevel === 3) {
        return "limited";
    }

    return "full";
};

const deriveFullnessValue = (report: ParkingReport): number => {
    if (Number.isInteger(report.fullnessLevel) && report.fullnessLevel !== null) {
        return clampNumber(report.fullnessLevel, 1, 5);
    }

    if (report.availability === "open") {
        return 2;
    }

    if (report.availability === "limited") {
        return 3.2;
    }

    return 4.7;
};

const buildOptimisticReport = (
    actionType: ReportActionType,
    fullnessLevel: number,
    distanceToCampusMeters: number,
    reporterLocation: LatLng,
    lotName: string,
): ParkingReport => ({
    id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lotName,
    availability: deriveAvailabilityFromFullness(fullnessLevel),
    actionType,
    fullnessLevel,
    note: "",
    distanceToCampusMeters,
    reporterLatitude: reporterLocation.latitude,
    reporterLongitude: reporterLocation.longitude,
    createdAt: new Date().toISOString(),
});

const sleep = (delayMs: number): Promise<void> =>
    new Promise((resolve) => {
        window.setTimeout(resolve, delayMs);
    });

const parseRetryAfterMs = (response: Response): number | null => {
    const retryAfterHeader = response.headers.get("retry-after");

    if (!retryAfterHeader) {
        return null;
    }

    const seconds = Number.parseInt(retryAfterHeader, 10);

    if (!Number.isNaN(seconds)) {
        return Math.max(0, seconds * 1000);
    }

    const retryDateMs = Date.parse(retryAfterHeader);

    if (Number.isNaN(retryDateMs)) {
        return null;
    }

    return Math.max(0, retryDateMs - Date.now());
};

const submitReportWithRetry = async (
    accessToken: string,
    actionType: ReportActionType,
    fullnessLevel: number,
    reporterLocation: LatLng,
    lotName: string,
): Promise<{ response: Response; payload: ReportResponse }> => {
    for (let attempt = 1; attempt <= SUBMIT_RETRY_MAX_ATTEMPTS; attempt += 1) {
        let response: Response;

        try {
            response = await fetch("/api/reports", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    actionType,
                    fullnessLevel,
                    reporterLatitude: reporterLocation.latitude,
                    reporterLongitude: reporterLocation.longitude,
                    lotName,
                }),
            });
        } catch (error) {
            if (attempt >= SUBMIT_RETRY_MAX_ATTEMPTS) {
                throw error;
            }

            const retryDelayMs = SUBMIT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
            await sleep(retryDelayMs);
            continue;
        }

        let payload: ReportResponse = {};

        try {
            payload = (await response.json()) as ReportResponse;
        } catch {
            payload = {};
        }

        if (response.ok || !TRANSIENT_SUBMIT_STATUSES.has(response.status) || attempt >= SUBMIT_RETRY_MAX_ATTEMPTS) {
            return { response, payload };
        }

        const retryAfterMs = parseRetryAfterMs(response);
        const retryDelayMs = retryAfterMs ?? SUBMIT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        await sleep(retryDelayMs);
    }

    throw new Error("Report submission exhausted retry attempts.");
};

const formatDistance = (meters: number, units: "metric" | "imperial" = "metric"): string => {
    if (!Number.isFinite(meters)) return "unknown";
    if (units === "imperial") {
        const feet = Math.round(meters * 3.28084);
        return feet >= 5280 ? `${(feet / 5280).toFixed(1)} mi` : `${feet} ft`;
    }
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
};

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const formatAvailabilityLabel = (availability: ParkingAvailability): string => {
    if (availability === "open") {
        return "Open";
    }

    if (availability === "limited") {
        return "Limited";
    }

    return "Full";
};

const isActionDisabledForParkState = (actionType: ReportActionType, isUserParkedToday: boolean): boolean => {
    if (actionType === "parked") {
        return isUserParkedToday;
    }

    if (actionType === "leaving") {
        return !isUserParkedToday;
    }

    return false;
};

const formatPublicUpdateText = (actionType: ReportActionType): string => {
    if (actionType === "parked") {
        return "Someone just parked";
    }

    if (actionType === "leaving") {
        return "Someone just left";
    }

    return "Someone checked the lot";
};

const formatUpdateTime = (isoTime: string): string =>
    new Date(isoTime).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });

const getMapLightPreset = (): "day" | "night" => (document.documentElement.classList.contains("dark") ? "night" : "day");

const getSessionDisplayName = (session: Session | null): string => {
    if (!session?.user) {
        return "";
    }

    const fullName =
        typeof session.user.user_metadata?.full_name === "string"
            ? session.user.user_metadata.full_name.trim()
            : typeof session.user.user_metadata?.name === "string"
              ? session.user.user_metadata.name.trim()
              : "";

    if (fullName) {
        return fullName;
    }

    const email = session.user.email ?? "";
    const prefix = email.split("@")[0]?.trim();
    return prefix || "Unknown user";
};

export default function ParkingMap() {
    const router = useRouter();
    const { theme } = useTheme();
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const userLocationMarkerRef = useRef<mapboxgl.Marker | null>(null);
    const parkedCarMarkerRef = useRef<mapboxgl.Marker | null>(null);
    const mapLightPresetRef = useRef<"day" | "night">("day");
    const panelTouchStartYRef = useRef<number | null>(null);
    const notificationsInitializedRef = useRef<boolean>(false);
    const panelCloseTimeoutRef = useRef<number | null>(null);
    const selectedActionRef = useRef<ReportActionType | null>(null);
    const isManualLotSelectionRef = useRef<boolean>(false);

    const [session, setSession] = useState<Session | null>(null);
    const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
    const [authFeedback, setAuthFeedback] = useState<string>("");
    const [isSigningOut, setIsSigningOut] = useState<boolean>(false);
    const [showDashboard, setShowDashboard] = useState<boolean>(false);
    const [showSettings, setShowSettings] = useState<boolean>(false);
    const [showLeaderboard, setShowLeaderboard] = useState<boolean>(false);

    const [selectedAction, setSelectedAction] = useState<ReportActionType | null>(null);
    const [fullnessLevel, setFullnessLevel] = useState<number | null>(null);

    const [reports, setReports] = useState<ParkingReport[]>([]);
    const [isLoadingReports, setIsLoadingReports] = useState<boolean>(true);
    const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);
    const [boundaryLoadError, setBoundaryLoadError] = useState<string>("");
    const [reportsLoadError, setReportsLoadError] = useState<string>("");
    const [reportFeedback, setReportFeedback] = useState<string>("");
    const [isUserParkedToday, setIsUserParkedToday] = useState<boolean>(false);
    const [latestReport, setLatestReport] = useState<ParkingReport | null>(null);
    const [previousReport, setPreviousReport] = useState<ParkingReport | null>(null);
    const [isPreviousReportFading, setIsPreviousReportFading] = useState<boolean>(false);
    const [isLatestReportEntering, setIsLatestReportEntering] = useState<boolean>(false);
    const [dismissedLatestReportId, setDismissedLatestReportId] = useState<string | null>(null);
    const [latestCardSwipeOffsetX, setLatestCardSwipeOffsetX] = useState<number>(0);
    const [latestCardSwipeOffsetY, setLatestCardSwipeOffsetY] = useState<number>(0);
    const [isLatestCardDragging, setIsLatestCardDragging] = useState<boolean>(false);
    const [panelSwipeOffsetY, setPanelSwipeOffsetY] = useState<number>(0);
    const [isPanelDragging, setIsPanelDragging] = useState<boolean>(false);
    const [isPanelClosing, setIsPanelClosing] = useState<boolean>(false);
    const [isMapReady, setIsMapReady] = useState<boolean>(false);
    const [areBoundaryLayersReady, setAreBoundaryLayersReady] = useState<boolean>(false);
    const [isRecenteringMap, setIsRecenteringMap] = useState<boolean>(false);
    const [isPointEditorEnabled, setIsPointEditorEnabled] = useState<boolean>(false);
    const [devPointActionType, setDevPointActionType] = useState<ReportActionType>("observing");
    const [devPointFullnessLevel, setDevPointFullnessLevel] = useState<number>(3);
    const [isAddingDevPoint, setIsAddingDevPoint] = useState<boolean>(false);
    const [isSeedingReports, setIsSeedingReports] = useState<boolean>(false);
    const [isResettingReports, setIsResettingReports] = useState<boolean>(false);
    const [resetReportsFeedback, setResetReportsFeedback] = useState<string>("");
    const [isPremiumActive, setIsPremiumActive] = useState<boolean>(false);
    const devPremiumOverrideRef = useRef<boolean | null>(null);
    const [premiumExpiresAt, setPremiumExpiresAt] = useState<string | null>(null);
    const [premiumMonthCostPoints, setPremiumMonthCostPoints] = useState<number>(DEFAULT_PREMIUM_MONTH_COST_POINTS);
    const [parkedCarLocation, setParkedCarLocation] = useState<PremiumStatus["parkedCarLocation"]>(null);
    const [isFindingParkedCar, setIsFindingParkedCar] = useState<boolean>(false);
    const [isInstalledDisplayMode, setIsInstalledDisplayMode] = useState<boolean>(false);
    const [userPoints, setUserPoints] = useState<number>(0);
    const [streakDays, setStreakDays] = useState<number>(0);
    const [showPointBurst, setShowPointBurst] = useState<boolean>(false);
    const [lastEarnedPoints, setLastEarnedPoints] = useState<number>(5);
    const [selectedLotName, setSelectedLotName] = useState<string | null>(null);
    const [distanceUnits, setDistanceUnits] = useState<"metric" | "imperial">(() => {
        if (typeof localStorage === "undefined") return "metric";
        return (localStorage.getItem("units") as "metric" | "imperial" | null) ?? "metric";
    });

    const { isNearCampus, distanceToCampus, locationError, currentLocation } = useCampusProximity();

    const sessionDisplayName = useMemo(() => getSessionDisplayName(session), [session]);

    const gpsLotName = useMemo(() => {
        if (!currentLocation) return null;
        return getLotForLocation(currentLocation.latitude, currentLocation.longitude)?.name ?? null;
    }, [currentLocation]);

    const activeLotName: string | null = selectedLotName ?? gpsLotName;

    const reportsRefreshIntervalMs = useMemo(() => {
        if (!Number.isFinite(distanceToCampus)) {
            return SLOW_REPORTS_REFRESH_INTERVAL_MS;
        }

        return distanceToCampus <= FAST_REFRESH_DISTANCE_METERS
            ? FAST_REPORTS_REFRESH_INTERVAL_MS
            : SLOW_REPORTS_REFRESH_INTERVAL_MS;
    }, [distanceToCampus]);

    const isSelectedActionDisabled = useMemo(() => {
        if (!selectedAction) {
            return false;
        }

        return isActionDisabledForParkState(selectedAction, isUserParkedToday);
    }, [selectedAction, isUserParkedToday]);

    const zoneAvailability = useMemo<ZoneAvailabilityState>(() => {
        const recentReports = reports.filter((report) => !report.id.startsWith("optimistic-")).slice(0, 40);

        if (recentReports.length === 0) {
            return "limited";
        }

        const nowMs = Date.now();
        let weightedFullness = 0;
        let totalWeight = 0;

        for (const report of recentReports) {
            const reportAgeMs = Math.max(0, nowMs - Date.parse(report.createdAt));
            if (reportAgeMs > 4 * 60 * 60 * 1000) {
                continue;
            }

            const recencyWeight = Math.exp(-reportAgeMs / (35 * 60 * 1000));
            const actionAdjustment = report.actionType === "parked" ? 0.45 : report.actionType === "leaving" ? -0.65 : 0;
            const actionReliability = report.actionType === "observing" ? 1 : 0.92;
            const adjustedFullness = clampNumber(deriveFullnessValue(report) + actionAdjustment, 1, 5);
            const combinedWeight = recencyWeight * actionReliability;

            weightedFullness += adjustedFullness * combinedWeight;
            totalWeight += combinedWeight;
        }

        if (totalWeight <= 0) {
            return "limited";
        }

        const averageFullness = weightedFullness / totalWeight;

        if (averageFullness <= 2.25) {
            return "open";
        }

        if (averageFullness <= 3.6) {
            return "limited";
        }

        return "full";
    }, [reports]);

    const premiumExpiryLabel = useMemo(() => {
        if (!premiumExpiresAt) {
            return "";
        }

        const expiryDate = new Date(premiumExpiresAt);

        if (Number.isNaN(expiryDate.getTime())) {
            return "";
        }

        return expiryDate.toLocaleDateString([], {
            month: "short",
            day: "numeric",
        });
    }, [premiumExpiresAt]);

    const heatmapData = useMemo(() => {
        const nowMs = Date.now();

        const eligibleReports: HeatmapReport[] = reports
            .filter(
                (report) =>
                    !report.id.startsWith("optimistic-") &&
                    Number.isFinite(report.reporterLatitude) &&
                    Number.isFinite(report.reporterLongitude) &&
                    Number.isFinite(report.distanceToCampusMeters) &&
                    report.distanceToCampusMeters <= CAMPUS_RADIUS_METERS * 1.2,
            )
            .map((report) => ({
                id: report.id,
                availability: report.availability,
                actionType: report.actionType,
                fullnessLevel: report.fullnessLevel,
                createdAt: report.createdAt,
                reporterLatitude: report.reporterLatitude,
                reporterLongitude: report.reporterLongitude,
            }));

        return buildHeatmapFeatures(eligibleReports, nowMs);
    }, [reports]);

    // Initialize notifications on mount
    useEffect(() => {
        if (!notificationsInitializedRef.current) {
            void checkAndRequestNotificationPermission();
            notificationsInitializedRef.current = true;
        }
    }, []);

    useEffect(() => {
        const hasStandaloneNavigatorFlag =
            typeof navigator !== "undefined" &&
            "standalone" in navigator &&
            Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

        const installedDisplayMode =
            window.matchMedia("(display-mode: standalone)").matches ||
            window.matchMedia("(display-mode: fullscreen)").matches ||
            window.matchMedia("(display-mode: minimal-ui)").matches ||
            hasStandaloneNavigatorFlag;

        setIsInstalledDisplayMode(installedDisplayMode);
    }, []);

    useEffect(() => {
        if (!session?.access_token) {
            return;
        }

        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            void subscribeToPushNotifications(session.access_token);
        }
    }, [session?.access_token]);

    useEffect(() => {
        return () => {
            if (panelCloseTimeoutRef.current !== null) {
                window.clearTimeout(panelCloseTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const handler = (e: StorageEvent) => {
            if (e.key === "units" && (e.newValue === "metric" || e.newValue === "imperial")) {
                setDistanceUnits(e.newValue);
            }
        };
        window.addEventListener("storage", handler);
        return () => window.removeEventListener("storage", handler);
    }, []);

    const canSubmitReport = useMemo(
        () =>
            Boolean(session?.access_token) &&
            Boolean(selectedAction) &&
            fullnessLevel !== null &&
            !isSelectedActionDisabled &&
            (selectedAction === "leaving" || isNearCampus) &&
            (selectedAction === "leaving" || !locationError) &&
            !isSubmittingReport,
        [session, selectedAction, fullnessLevel, isSelectedActionDisabled, isNearCampus, locationError, isSubmittingReport],
    );

    useEffect(() => {
        if (!selectedAction) {
            return;
        }

        if (isActionDisabledForParkState(selectedAction, isUserParkedToday)) {
            setSelectedAction(null);
        }
    }, [selectedAction, isUserParkedToday]);

    const applyPremiumStatus = useCallback((payload: PremiumStatusResponse): void => {
        const premiumExpiresAtValue = typeof payload.premiumExpiresAt === "string" ? payload.premiumExpiresAt : null;
        const premiumActiveValue =
            DEV_REPORTS_RESET_ENABLED && devPremiumOverrideRef.current !== null
                ? devPremiumOverrideRef.current
                : Boolean(payload.isPremium);

        if (Number.isFinite(payload.points)) setUserPoints(Number(payload.points));
        setPremiumExpiresAt(premiumExpiresAtValue);
        setIsPremiumActive(premiumActiveValue);
        setPremiumMonthCostPoints(
            Number.isFinite(payload.premiumMonthCostPoints)
                ? Number(payload.premiumMonthCostPoints)
                : DEFAULT_PREMIUM_MONTH_COST_POINTS,
        );

        if (
            premiumActiveValue &&
            payload.parkedCarLocation &&
            typeof payload.parkedCarLocation.latitude === "number" &&
            typeof payload.parkedCarLocation.longitude === "number" &&
            typeof payload.parkedCarLocation.parkedAt === "string"
        ) {
            setParkedCarLocation(payload.parkedCarLocation);
            return;
        }

        setParkedCarLocation(null);
    }, []);

    useEffect(() => {
        if (!session?.access_token) {
            setIsPremiumActive(false);
            setPremiumExpiresAt(null);
            setParkedCarLocation(null);
            return;
        }

        let isActive = true;

        const loadPremiumStatus = async (): Promise<void> => {
            try {
                const response = await fetch("/api/premium", {
                    method: "GET",
                    cache: "no-store",
                    headers: {
                        authorization: `Bearer ${session.access_token}`,
                    },
                });

                const payload = (await response.json().catch(() => ({}))) as PremiumStatusResponse;

                if (!isActive || !response.ok) {
                    return;
                }

                applyPremiumStatus(payload);
            } catch {
                if (isActive) {
                    setIsPremiumActive(false);
                    setPremiumExpiresAt(null);
                    setParkedCarLocation(null);
                }
            }
        };

        void loadPremiumStatus();

        const refreshPremiumStatus = (): void => {
            if (document.visibilityState !== "visible") {
                return;
            }

            void loadPremiumStatus();
        };

        window.addEventListener("focus", refreshPremiumStatus);

        return () => {
            isActive = false;
            window.removeEventListener("focus", refreshPremiumStatus);
        };
    }, [session?.access_token, applyPremiumStatus]);

    useEffect(() => {
        if (!session?.user?.id) {
            setStreakDays(0);
            return;
        }
        let isActive = true;
        void computeStreak(session.user.id).then((days) => {
            if (isActive) setStreakDays(days);
        });
        return () => { isActive = false; };
    }, [session?.user?.id]);

    // Keep selectedActionRef in sync so Mapbox click handlers can read it without stale closure
    useEffect(() => { selectedActionRef.current = selectedAction; }, [selectedAction]);

    // GPS auto-select: when user is inside a lot and no manual selection, auto-pick that lot
    useEffect(() => {
        if (isManualLotSelectionRef.current) return;
        if (selectedAction) return; // don't change lot mid-form
        setSelectedLotName(gpsLotName);
    }, [gpsLotName, selectedAction]);

    const handleRecenterToUser = useCallback(async (): Promise<void> => {
        if (!mapRef.current || isRecenteringMap) {
            return;
        }

        setIsRecenteringMap(true);

        try {
            const targetLocation = currentLocation ?? (await getCurrentPosition());
            const map = mapRef.current;

            if (!map) {
                return;
            }

            map.flyTo({
                center: [targetLocation.longitude, targetLocation.latitude],
                zoom: Math.max(map.getZoom(), 16.4),
                speed: 0.9,
                curve: 1.2,
                essential: true,
            });
        } catch {
            console.warn("Unable to center map on current location.");
        } finally {
            setIsRecenteringMap(false);
        }
    }, [currentLocation, isRecenteringMap]);

    const handleFindMyCar = useCallback((): void => {
        if (!mapRef.current || !parkedCarLocation || isFindingParkedCar) {
            return;
        }

        setIsFindingParkedCar(true);

        mapRef.current.flyTo({
            center: [parkedCarLocation.longitude, parkedCarLocation.latitude],
            zoom: Math.max(mapRef.current.getZoom(), 17.1),
            speed: 1,
            curve: 1.2,
            essential: true,
        });

        window.setTimeout(() => {
            setIsFindingParkedCar(false);
        }, 700);
    }, [parkedCarLocation, isFindingParkedCar]);

    const handleSignOut = async (): Promise<void> => {
        setAuthFeedback("");
        setIsSigningOut(true);

        try {
            const supabase = getSupabaseBrowserClient();
            const { error } = await supabase.auth.signOut();

            if (error) {
                setAuthFeedback(error.message || "Failed to sign out.");
                return;
            }

            // Redirect to home page after successful sign out
            router.push("/");
        } catch {
            setAuthFeedback("Supabase auth is not configured yet.");
        } finally {
            setIsSigningOut(false);
        }
    };

    useEffect(() => {
        let isActive = true;
        let unsubscribe: (() => void) | null = null;

        try {
            const supabase = getSupabaseBrowserClient();

            void supabase.auth.getSession().then(({ data, error }) => {
                if (!isActive) {
                    return;
                }

                if (error) {
                    setAuthFeedback(error.message || "Unable to initialize authentication.");
                }

                setSession(data.session ?? null);
                setIsAuthReady(true);
            });

            const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
                if (!isActive) {
                    return;
                }

                setSession(nextSession);
                setIsAuthReady(true);
            });

            unsubscribe = () => {
                data.subscription.unsubscribe();
            };
        } catch {
            if (isActive) {
                setAuthFeedback("Supabase auth is not configured yet.");
                setIsAuthReady(true);
            }
        }

        return () => {
            isActive = false;
            unsubscribe?.();
        };
    }, []);

    useEffect(() => {
        if (!DEV_REPORTS_RESET_ENABLED) return;
        const stored = localStorage.getItem(DEV_PREMIUM_STORAGE_KEY);
        if (stored === "true") {
            devPremiumOverrideRef.current = true;
            setIsPremiumActive(true);
        } else if (stored === "false") {
            devPremiumOverrideRef.current = false;
            setIsPremiumActive(false);
        }
    }, []);

    const handleDevPremiumToggle = (): void => {
        setIsPremiumActive((prev) => {
            const next = !prev;
            devPremiumOverrideRef.current = next;
            localStorage.setItem(DEV_PREMIUM_STORAGE_KEY, String(next));
            return next;
        });
    };

    const handleResetReportsForTesting = async (): Promise<void> => {
        if (!DEV_REPORTS_RESET_ENABLED || isResettingReports || isSeedingReports || isAddingDevPoint) {
            return;
        }

        const shouldReset = window.confirm("Delete all parking reports? This is for development testing only.");

        if (!shouldReset) {
            return;
        }

        setIsResettingReports(true);
        setResetReportsFeedback("");

        try {
            const headers: Record<string, string> = {};
            const resetKey = process.env.NEXT_PUBLIC_REPORTS_RESET_KEY?.trim();

            if (resetKey) {
                headers[REPORTS_RESET_KEY_HEADER] = resetKey;
            }

            const response = await fetch("/api/reports", {
                method: "DELETE",
                cache: "no-store",
                headers,
            });

            const payload = (await response.json().catch(() => ({}))) as { deletedCount?: number; error?: string };

            if (!response.ok) {
                setResetReportsFeedback(payload.error ?? "Unable to clear reports.");
                return;
            }

            setReports([]);
            setLatestReport(null);
            setPreviousReport(null);
            setDismissedLatestReportId(null);
            setIsUserParkedToday(false);
            setSelectedAction(null);
            setFullnessLevel(null);
            setReportFeedback("");
            setReportsLoadError("");

            setResetReportsFeedback(`Cleared ${payload.deletedCount ?? 0} reports.`);
        } catch {
            setResetReportsFeedback("Unable to clear reports.");
        } finally {
            setIsResettingReports(false);
        }
    };

    const handleSeedReportsForTesting = async (): Promise<void> => {
        if (!DEV_REPORTS_RESET_ENABLED || isSeedingReports || isResettingReports || isAddingDevPoint) {
            return;
        }

        const requestedCountInput = window.prompt("How many sample reports? (10-320)", "120");

        if (requestedCountInput === null) {
            return;
        }

        const requestedCount = Number.parseInt(requestedCountInput, 10);

        if (Number.isNaN(requestedCount)) {
            setResetReportsFeedback("Enter a valid number of reports.");
            return;
        }

        const count = Math.min(Math.max(requestedCount, 10), 320);
        const clearExisting = window.confirm(
            "Clear existing reports before seeding?\nOK: clear and seed.\nCancel: keep existing and append sample data.",
        );

        setIsSeedingReports(true);
        setResetReportsFeedback("");

        try {
            const headers: Record<string, string> = {
                "content-type": "application/json",
            };
            const resetKey = process.env.NEXT_PUBLIC_REPORTS_RESET_KEY?.trim();

            if (resetKey) {
                headers[REPORTS_RESET_KEY_HEADER] = resetKey;
            }

            const response = await fetch("/api/reports/dev-seed", {
                method: "POST",
                cache: "no-store",
                headers,
                body: JSON.stringify({
                    count,
                    clearExisting,
                }),
            });

            const payload = (await response.json().catch(() => ({}))) as {
                seededCount?: number;
                deletedCount?: number;
                error?: string;
            };

            if (!response.ok) {
                setResetReportsFeedback(payload.error ?? "Unable to seed sample reports.");
                return;
            }

            setDismissedLatestReportId(null);
            window.dispatchEvent(new Event("focus"));

            const deletedSuffix = payload.deletedCount && payload.deletedCount > 0 ? `, cleared ${payload.deletedCount}` : "";
            setResetReportsFeedback(`Seeded ${payload.seededCount ?? count} sample reports${deletedSuffix}.`);
        } catch {
            setResetReportsFeedback("Unable to seed sample reports.");
        } finally {
            setIsSeedingReports(false);
        }
    };

    const handleAddDevPointAt = useCallback(
        async (latitude: number, longitude: number): Promise<void> => {
            if (
                !DEV_REPORTS_RESET_ENABLED ||
                !isPointEditorEnabled ||
                isAddingDevPoint ||
                isSeedingReports ||
                isResettingReports
            ) {
                return;
            }

            setIsAddingDevPoint(true);
            setResetReportsFeedback("");

            try {
                const headers: Record<string, string> = {
                    "content-type": "application/json",
                };
                const resetKey = process.env.NEXT_PUBLIC_REPORTS_RESET_KEY?.trim();

                if (resetKey) {
                    headers[REPORTS_RESET_KEY_HEADER] = resetKey;
                }

                const response = await fetch("/api/reports/dev-seed", {
                    method: "POST",
                    cache: "no-store",
                    headers,
                    body: JSON.stringify({
                        mode: "point",
                        latitude,
                        longitude,
                        actionType: devPointActionType,
                        fullnessLevel: devPointFullnessLevel,
                    }),
                });

                const payload = (await response.json().catch(() => ({}))) as {
                    seededCount?: number;
                    error?: string;
                };

                if (!response.ok) {
                    setResetReportsFeedback(payload.error ?? "Unable to add point sample report.");
                    return;
                }

                window.dispatchEvent(new Event("focus"));

                const latLabel = latitude.toFixed(5);
                const lonLabel = longitude.toFixed(5);
                setResetReportsFeedback(
                    `Added point at ${latLabel}, ${lonLabel} (${REPORT_ACTION_CONFIG[devPointActionType].label.toLowerCase()}).`,
                );
            } catch {
                setResetReportsFeedback("Unable to add point sample report.");
            } finally {
                setIsAddingDevPoint(false);
            }
        },
        [isPointEditorEnabled, isAddingDevPoint, isSeedingReports, isResettingReports, devPointActionType, devPointFullnessLevel],
    );

    const handleReportSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        setReportFeedback("");

        if (!session?.access_token) {
            setReportFeedback("Please sign in with Google before reporting.");
            return;
        }

        if (!selectedAction) {
            setReportFeedback("Choose an update type before submitting.");
            return;
        }

        if (selectedAction === "parked" && isUserParkedToday) {
            setReportFeedback("You are already marked as parked today. Submit a leaving update before parking again.");
            return;
        }

        if (selectedAction === "leaving" && !isUserParkedToday) {
            setReportFeedback("You are not marked as parked right now. Park first or submit an observing update.");
            return;
        }

        if (fullnessLevel === null) {
            setReportFeedback("Choose a fullness level from 1 to 5 before submitting.");
            return;
        }

        if (selectedAction !== "leaving" && locationError) {
            setReportFeedback(locationError);
            return;
        }

        if (selectedAction !== "leaving" && !isNearCampus) {
            setReportFeedback(
                `Reporting is restricted to users within ${CAMPUS_RADIUS_METERS} m of campus. Current distance: ${formatDistance(
                    distanceToCampus,
                    distanceUnits,
                )}.`,
            );
            return;
        }

        if (selectedAction !== "leaving") {
            const detectedLot = currentLocation
                ? getLotForLocation(currentLocation.latitude, currentLocation.longitude)
                : null;
            if (!detectedLot) {
                setReportFeedback("You must be inside a parking lot to submit a report.");
                return;
            }
        }

        const actionToSubmit = selectedAction;
        const fullnessToSubmit = fullnessLevel;

        const previousReportsSnapshot = reports;
        const previousParkState = isUserParkedToday;
        const previousParkedCarLocation = parkedCarLocation;

        setSelectedAction(null);
        setFullnessLevel(null);
        setReportFeedback("Sending update...");

        setIsSubmittingReport(true);

        try {
            const reporterLocation =
                actionToSubmit === "leaving"
                    ? (currentLocation ?? {
                          latitude: JOHN_ABBOTT_CENTER[1],
                          longitude: JOHN_ABBOTT_CENTER[0],
                      })
                    : await resolveReporterLocation(currentLocation);

            const detectedLot =
                actionToSubmit !== "leaving"
                    ? getLotForLocation(reporterLocation.latitude, reporterLocation.longitude)
                    : null;

            const reportLotName =
                detectedLot?.name ??
                (actionToSubmit === "leaving" ? (PARKING_LOTS[0]?.name ?? "Unknown Lot") : "Unknown Lot");

            const optimisticReport = buildOptimisticReport(actionToSubmit, fullnessToSubmit, distanceToCampus, reporterLocation, reportLotName);

            setReports((prevReports) => {
                const nonOptimisticReports = prevReports.filter((report) => !report.id.startsWith("optimistic-"));
                return [optimisticReport, ...nonOptimisticReports].slice(0, HEATMAP_REPORTS_LIMIT);
            });

            if (actionToSubmit === "parked") {
                setIsUserParkedToday(true);
                setParkedCarLocation({
                    latitude: reporterLocation.latitude,
                    longitude: reporterLocation.longitude,
                    parkedAt: new Date().toISOString(),
                });
            } else if (actionToSubmit === "leaving") {
                setIsUserParkedToday(false);
                setParkedCarLocation(null);
            }

            const { response, payload } = await submitReportWithRetry(
                session.access_token,
                actionToSubmit,
                fullnessToSubmit,
                reporterLocation,
                reportLotName,
            );

            if (!response.ok || !payload.report) {
                setReports(previousReportsSnapshot);
                setIsUserParkedToday(previousParkState);
                setParkedCarLocation(previousParkedCarLocation);
                setReportFeedback(payload.error ?? "Unable to sync this update right now. Please try again.");
                return;
            }

            const createdReport = payload.report;
            setReports((prevReports) =>
                [createdReport, ...prevReports.filter((report) => report.id !== optimisticReport.id)].slice(
                    0,
                    HEATMAP_REPORTS_LIMIT,
                ),
            );

            if (actionToSubmit === "parked") {
                setParkedCarLocation({
                    latitude: createdReport.reporterLatitude,
                    longitude: createdReport.reporterLongitude,
                    parkedAt: createdReport.createdAt,
                });
            } else if (actionToSubmit === "leaving") {
                setParkedCarLocation(null);
            }

            if (typeof navigator !== "undefined" && "vibrate" in navigator && localStorage.getItem("haptics") === "true") {
                navigator.vibrate([40, 30, 40]);
            }

            // Show notification for successful parking update
            const actionMessages: Record<ReportActionType, string> = {
                parked: "You've marked your location as parked",
                leaving: "You've marked your location as leaving",
                observing: "You've shared a parking observation",
            };
            void showNotification({
                title: "Update Recorded",
                body: actionMessages[actionToSubmit],
            });
            const earnedPts = actionToSubmit === "observing" ? 1 : 5;
            setLastEarnedPoints(earnedPts);
            setShowPointBurst(true);
            setUserPoints((prev) => prev + earnedPts);
            setReportFeedback("Report saved.");
        } catch {
            setReports(previousReportsSnapshot);
            setIsUserParkedToday(previousParkState);
            setParkedCarLocation(previousParkedCarLocation);
            setReportFeedback("Unable to sync this update right now. Please try again.");
        } finally {
            setIsSubmittingReport(false);
        }
    };

    useEffect(() => {
        let isActive = true;
        let isFetchingReports = false;

        const loadReports = async (silent: boolean): Promise<void> => {
            if (isFetchingReports) {
                return;
            }

            isFetchingReports = true;

            if (!silent) {
                setIsLoadingReports(true);
                setReportsLoadError("");
            }

            try {
                const localDayStart = new Date();
                localDayStart.setHours(0, 0, 0, 0);

                const query = new URLSearchParams({
                    limit: String(HEATMAP_REPORTS_LIMIT),
                    since: localDayStart.toISOString(),
                });

                const response = await fetch(`/api/reports?${query.toString()}`, {
                    method: "GET",
                    cache: "no-store",
                    headers: session?.access_token
                        ? {
                              authorization: `Bearer ${session.access_token}`,
                          }
                        : undefined,
                });

                const payload = (await response.json()) as ReportsResponse;

                if (!response.ok) {
                    if (isActive && !silent) {
                        setReportsLoadError(payload.error ?? "Unable to load reports.");
                    }
                    return;
                }

                if (isActive) {
                    setReportsLoadError("");
                    setReports(Array.isArray(payload.reports) ? payload.reports : []);
                    if (session?.access_token) {
                        setIsUserParkedToday(Boolean(payload.viewerParkingState?.isParkedToday));
                    } else {
                        setIsUserParkedToday(false);
                    }
                }
            } catch {
                if (isActive && !silent) {
                    setReportsLoadError("Unable to load reports.");
                }
            } finally {
                if (isActive && !silent) {
                    setIsLoadingReports(false);
                }

                isFetchingReports = false;
            }
        };

        const refreshIfVisible = (): void => {
            if (document.visibilityState !== "visible") {
                return;
            }

            void loadReports(true);
        };

        void loadReports(false);
        const refreshInterval = window.setInterval(() => {
            void refreshIfVisible();
        }, reportsRefreshIntervalMs);

        document.addEventListener("visibilitychange", refreshIfVisible);
        window.addEventListener("focus", refreshIfVisible);

        return () => {
            isActive = false;
            window.clearInterval(refreshInterval);
            document.removeEventListener("visibilitychange", refreshIfVisible);
            window.removeEventListener("focus", refreshIfVisible);
        };
    }, [session?.access_token, reportsRefreshIntervalMs]);

    useEffect(() => {
        setPanelSwipeOffsetY(0);
        setIsPanelDragging(false);
        setIsPanelClosing(false);
        panelTouchStartYRef.current = null;
    }, [selectedAction]);

    useEffect(() => {
        if (!selectedAction) {
            return;
        }

        const htmlElement = document.documentElement;
        const bodyElement = document.body;
        const previousHtmlOverscroll = htmlElement.style.overscrollBehaviorY;
        const previousBodyOverscroll = bodyElement.style.overscrollBehaviorY;

        htmlElement.style.overscrollBehaviorY = "none";
        bodyElement.style.overscrollBehaviorY = "none";

        return () => {
            htmlElement.style.overscrollBehaviorY = previousHtmlOverscroll;
            bodyElement.style.overscrollBehaviorY = previousBodyOverscroll;
        };
    }, [selectedAction]);

    const handlePanelTouchStart = (event: TouchEvent<HTMLDivElement>): void => {
        if (isPanelClosing) {
            return;
        }

        const touchPoint = event.touches[0];

        if (!touchPoint) {
            return;
        }

        panelTouchStartYRef.current = touchPoint.clientY;
        setIsPanelDragging(true);
    };

    const handlePanelTouchMove = (event: TouchEvent<HTMLDivElement>): void => {
        if (panelTouchStartYRef.current === null || isPanelClosing) {
            return;
        }

        event.preventDefault();

        const touchPoint = event.touches[0];

        if (!touchPoint) {
            return;
        }

        const swipeDistance = Math.max(0, touchPoint.clientY - panelTouchStartYRef.current);
        setPanelSwipeOffsetY(swipeDistance);
    };

    const closeActionPanelWithSwipeOut = useCallback((): void => {
        if (isPanelClosing) {
            return;
        }

        const viewportHeight = Math.max(window.visualViewport?.height ?? 0, window.innerHeight ?? 0, 420);

        setIsPanelClosing(true);
        setPanelSwipeOffsetY(viewportHeight);
        panelTouchStartYRef.current = null;

        if (panelCloseTimeoutRef.current !== null) {
            window.clearTimeout(panelCloseTimeoutRef.current);
        }

        panelCloseTimeoutRef.current = window.setTimeout(() => {
            if (selectedActionRef.current) {
                // Close the form, keep lot selected
                setSelectedAction(null);
                setFullnessLevel(null);
            } else {
                // Close the lot info panel entirely
                isManualLotSelectionRef.current = false;
                setSelectedLotName(null);
            }
            setPanelSwipeOffsetY(0);
            setIsPanelClosing(false);
            panelCloseTimeoutRef.current = null;
        }, 300);
    }, [isPanelClosing]);

    const handlePanelTouchEnd = (): void => {
        setIsPanelDragging(false);

        if (isPanelClosing) {
            return;
        }

        if (panelSwipeOffsetY >= PANEL_SWIPE_CLOSE_THRESHOLD_PX) {
            closeActionPanelWithSwipeOut();
            return;
        }

        setPanelSwipeOffsetY(0);
        panelTouchStartYRef.current = null;
    };

    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) {
            return;
        }

        const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

        if (!accessToken) {
            console.warn("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN is missing. Map initialization skipped.");
            return;
        }

        mapboxgl.accessToken = accessToken;

        (mapboxgl as typeof mapboxgl & { setTelemetryEnabled?: (enabled: boolean) => void }).setTelemetryEnabled?.(false);

        const initialLightPreset = getMapLightPreset();

        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: LIGHT_STYLE_URL,
            config: {
                basemap: {
                    lightPreset: initialLightPreset,
                },
            },
            center: JOHN_ABBOTT_CENTER,
            zoom: JOHN_ABBOTT_ZOOM,
            attributionControl: false,
        });

        mapRef.current = map;
        mapLightPresetRef.current = initialLightPreset;
        setAreBoundaryLayersReady(false);

        let isActive = true;

        const addBoundaryLayers = (): void => {
            try {
                if (!isActive) {
                    return;
                }

                const boundaryData: FeatureCollection<Polygon> = {
                    type: "FeatureCollection",
                    features: PARKING_LOTS.map((lot) => ({
                        type: "Feature",
                        properties: { name: lot.name },
                        geometry: {
                            type: "Polygon",
                            coordinates: [lot.polygon],
                        },
                    })),
                };

                const labelsData: FeatureCollection<GeoJSON.Point> = {
                    type: "FeatureCollection",
                    features: PARKING_LOTS.map((lot) => ({
                        type: "Feature",
                        properties: { name: lot.name },
                        geometry: {
                            type: "Point",
                            coordinates: lot.labelCoord,
                        },
                    })),
                };

                if (!map.getSource(BOUNDARY_SOURCE_ID)) {
                    map.addSource(BOUNDARY_SOURCE_ID, { type: "geojson", data: boundaryData });
                }

                if (!map.getSource(BOUNDARY_SOURCE_ID)) {
                    return;
                }

                if (!map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
                    map.addLayer({
                        id: BOUNDARY_FILL_LAYER_ID,
                        type: "fill",
                        source: BOUNDARY_SOURCE_ID,
                        paint: {
                            "fill-color": "#0ea5e9",
                            "fill-opacity": 0.2,
                        },
                    });
                }

                if (!map.getLayer(BOUNDARY_LINE_LAYER_ID)) {
                    map.addLayer({
                        id: BOUNDARY_LINE_LAYER_ID,
                        type: "line",
                        source: BOUNDARY_SOURCE_ID,
                        paint: {
                            "line-color": "#0369a1",
                            "line-width": 3,
                        },
                    });
                }

                if (!map.getSource(LOT_LABELS_SOURCE_ID)) {
                    map.addSource(LOT_LABELS_SOURCE_ID, { type: "geojson", data: labelsData });
                }

                if (!map.getLayer(LOT_LABELS_LAYER_ID)) {
                    map.addLayer({
                        id: LOT_LABELS_LAYER_ID,
                        type: "symbol",
                        source: LOT_LABELS_SOURCE_ID,
                        layout: {
                            "text-field": ["get", "name"],
                            "text-size": 13,
                            "text-anchor": "center",
                            "text-allow-overlap": false,
                        },
                        paint: {
                            "text-color": "#0369a1",
                            "text-halo-color": "#ffffff",
                            "text-halo-width": 2,
                        },
                    });
                }

                setAreBoundaryLayersReady(true);
                setBoundaryLoadError("");
            } catch {
                if (isActive) {
                    setAreBoundaryLayersReady(false);
                    setBoundaryLoadError("Unable to initialize lot boundary layers.");
                }
            }
        };

        const handleMapLoad = (): void => {
            setIsMapReady(true);
            setAreBoundaryLayersReady(false);
            addBoundaryLayers();
        };

        const handleMapStyleLoad = (): void => {
            setAreBoundaryLayersReady(false);
            addBoundaryLayers();
        };

        map.on("load", handleMapLoad);
        map.on("style.load", handleMapStyleLoad);

        return () => {
            isActive = false;
            userLocationMarkerRef.current?.remove();
            userLocationMarkerRef.current = null;
            parkedCarMarkerRef.current?.remove();
            parkedCarMarkerRef.current = null;
            map.off("load", handleMapLoad);
            map.off("style.load", handleMapStyleLoad);
            map.remove();
            mapRef.current = null;
            setAreBoundaryLayersReady(false);
        };
    }, []);

    // Update map style when theme changes
    useEffect(() => {
        if (!mapRef.current) {
            return;
        }

        const map = mapRef.current;

        const applyThemePreset = (): void => {
            const nextPreset = getMapLightPreset();

            if (mapLightPresetRef.current === nextPreset) {
                return;
            }

            map.setConfigProperty("basemap", "lightPreset", nextPreset);
            mapLightPresetRef.current = nextPreset;
        };

        if (map.isStyleLoaded()) {
            applyThemePreset();
        } else {
            map.once("style.load", applyThemePreset);
        }

        return () => {
            map.off("style.load", applyThemePreset);
        };
    }, [theme]);

    useEffect(() => {
        if (!isMapReady || !mapRef.current) {
            return;
        }

        if (!currentLocation) {
            userLocationMarkerRef.current?.remove();
            userLocationMarkerRef.current = null;
            return;
        }

        const markerPosition: LngLatTuple = [currentLocation.longitude, currentLocation.latitude];

        if (!userLocationMarkerRef.current) {
            const markerElement = document.createElement("div");
            markerElement.className = USER_LOCATION_MARKER_CLASS_NAME;

            userLocationMarkerRef.current = new mapboxgl.Marker({
                element: markerElement,
                anchor: "center",
            })
                .setLngLat(markerPosition)
                .addTo(mapRef.current);

            return;
        }

        userLocationMarkerRef.current.setLngLat(markerPosition);
    }, [currentLocation, isMapReady]);

    useEffect(() => {
        if (!DEV_REPORTS_RESET_ENABLED || !isMapReady || !mapRef.current) {
            return;
        }

        const map = mapRef.current;
        const canvas = map.getCanvas();
        const previousCursor = canvas.style.cursor;

        canvas.style.cursor = isPointEditorEnabled ? "crosshair" : previousCursor;

        const handleMapClick = (event: mapboxgl.MapMouseEvent): void => {
            if (!isPointEditorEnabled || selectedAction || isAddingDevPoint || isSeedingReports || isResettingReports) {
                return;
            }

            void handleAddDevPointAt(event.lngLat.lat, event.lngLat.lng);
        };

        map.on("click", handleMapClick);

        return () => {
            map.off("click", handleMapClick);
            canvas.style.cursor = previousCursor;
        };
    }, [
        isMapReady,
        isPointEditorEnabled,
        selectedAction,
        isAddingDevPoint,
        isSeedingReports,
        isResettingReports,
        handleAddDevPointAt,
    ]);

    // Lot tap: select a lot by clicking its polygon, deselect by clicking outside
    useEffect(() => {
        if (!isMapReady || !areBoundaryLayersReady || !mapRef.current) return;
        const map = mapRef.current;

        const handleLotClick = (e: mapboxgl.MapLayerMouseEvent): void => {
            if (isPointEditorEnabled) return;
            const lotName = e.features?.[0]?.properties?.name as string | undefined;
            if (lotName) {
                isManualLotSelectionRef.current = true;
                setSelectedLotName(lotName);
                setSelectedAction(null);
                setFullnessLevel(null);
            }
        };

        const handleMapClick = (e: mapboxgl.MapMouseEvent): void => {
            if (isPointEditorEnabled) return;
            if (selectedActionRef.current) return; // form is open — keep lot
            const hits = map.queryRenderedFeatures(e.point, { layers: [BOUNDARY_FILL_LAYER_ID] });
            if (hits.length === 0) {
                isManualLotSelectionRef.current = false;
                setSelectedLotName(null);
            }
        };

        const onEnter = (): void => { map.getCanvas().style.cursor = "pointer"; };
        const onLeave = (): void => { map.getCanvas().style.cursor = ""; };

        map.on("click", BOUNDARY_FILL_LAYER_ID, handleLotClick);
        map.on("click", handleMapClick);
        map.on("mouseenter", BOUNDARY_FILL_LAYER_ID, onEnter);
        map.on("mouseleave", BOUNDARY_FILL_LAYER_ID, onLeave);

        return () => {
            map.off("click", BOUNDARY_FILL_LAYER_ID, handleLotClick);
            map.off("click", handleMapClick);
            map.off("mouseenter", BOUNDARY_FILL_LAYER_ID, onEnter);
            map.off("mouseleave", BOUNDARY_FILL_LAYER_ID, onLeave);
        };
    }, [isMapReady, areBoundaryLayersReady, isPointEditorEnabled]);

    // Parked car marker
    useEffect(() => {
        if (!isMapReady || !mapRef.current) return;

        if (!isPremiumActive || !parkedCarLocation || !isUserParkedToday) {
            parkedCarMarkerRef.current?.remove();
            parkedCarMarkerRef.current = null;
            return;
        }

        const pos: LngLatTuple = [parkedCarLocation.longitude, parkedCarLocation.latitude];

        if (parkedCarMarkerRef.current) {
            parkedCarMarkerRef.current.setLngLat(pos);
            return;
        }

        const el = document.createElement("div");
        el.className = "jac-parked-car-pin";
        el.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M6 16h12"/><path d="M7 16l1.5-5h7L17 16"/><circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg>`;

        parkedCarMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "bottom" })
            .setLngLat(pos)
            .addTo(mapRef.current);
    }, [isMapReady, isPremiumActive, parkedCarLocation, isUserParkedToday]);

    // Manage heatmap layer (rendered for free and premium with different paint)
    useEffect(() => {
        if (!isMapReady || !areBoundaryLayersReady || !mapRef.current || !mapRef.current.isStyleLoaded()) {
            return;
        }

        const map = mapRef.current;
        const tier = isPremiumActive ? "premium" : "free";

        const existingSource = map.getSource(REPORTS_HEATMAP_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (!existingSource) {
            map.addSource(REPORTS_HEATMAP_SOURCE_ID, {
                type: "geojson",
                data: heatmapData,
            });
        } else {
            existingSource.setData(heatmapData);
        }

        const boundaryFillLayerExists = Boolean(map.getLayer(BOUNDARY_FILL_LAYER_ID));
        const paint = buildHeatmapPaint(tier);

        if (!map.getLayer(REPORTS_HEATMAP_LAYER_ID)) {
            const heatmapLayer: mapboxgl.HeatmapLayer = {
                id: REPORTS_HEATMAP_LAYER_ID,
                type: "heatmap",
                source: REPORTS_HEATMAP_SOURCE_ID,
                paint,
            };

            if (boundaryFillLayerExists) {
                map.addLayer(heatmapLayer, BOUNDARY_FILL_LAYER_ID);
            } else {
                map.addLayer(heatmapLayer);
            }
        } else {
            type PaintName = Parameters<typeof map.setPaintProperty>[1];
            type PaintValue = Parameters<typeof map.setPaintProperty>[2];
            for (const [property, value] of Object.entries(paint) as Array<[PaintName, PaintValue]>) {
                map.setPaintProperty(REPORTS_HEATMAP_LAYER_ID, property, value);
            }
            if (boundaryFillLayerExists) {
                map.moveLayer(REPORTS_HEATMAP_LAYER_ID, BOUNDARY_FILL_LAYER_ID);
            }
        }
    }, [heatmapData, isMapReady, areBoundaryLayersReady, isPremiumActive]);

    useEffect(() => {
        if (!isMapReady || !mapRef.current || !mapRef.current.isStyleLoaded()) {
            return;
        }

        const map = mapRef.current;

        if (!map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
            return;
        }

        const nextFillColor = isPremiumActive ? "#0ea5e9" : NON_PREMIUM_ZONE_STYLE[zoneAvailability].fillColor;
        const nextFillOpacity = isPremiumActive ? 0.2 : NON_PREMIUM_ZONE_STYLE[zoneAvailability].fillOpacity;
        const nextLineColor = isPremiumActive ? "#0369a1" : NON_PREMIUM_ZONE_STYLE[zoneAvailability].lineColor;

        map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, "fill-color", nextFillColor);
        map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, "fill-opacity", nextFillOpacity);

        if (map.getLayer(BOUNDARY_LINE_LAYER_ID)) {
            map.setPaintProperty(BOUNDARY_LINE_LAYER_ID, "line-color", nextLineColor);
        }
    }, [isMapReady, areBoundaryLayersReady, isPremiumActive, zoneAvailability]);

    return (
        <section className="relative h-[100dvh] w-screen overflow-hidden" style={{ overscrollBehaviorY: "contain" }}>
            {/* Full-screen map */}
            <div ref={mapContainerRef} className="h-full w-full" />

            {/* PointBurst overlay */}
            {showPointBurst && <PointBurst value={lastEarnedPoints} onDone={() => setShowPointBurst(false)} />}

            {/* Desktop notice */}
            <div className="hidden md:flex absolute inset-0 items-center justify-center z-10 pointer-events-none">
                <div
                    className="px-6 py-4 rounded-2xl text-center"
                    style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}
                >
                    <p className="text-base font-bold mb-1" style={{ color: "var(--foreground)" }}>Omnilots is designed for mobile</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>Install the app on your phone to report parking.</p>
                </div>
            </div>

            {/* Top bar — mobile only */}
            <div
                className="absolute top-0 left-0 right-0 z-10 px-3 md:hidden"
                style={{ paddingTop: "calc(0.75rem + max(0px, env(safe-area-inset-top)))" }}
            >
                {/* Main row: lot info + pills */}
                <div className="flex items-center gap-2.5 mb-2">
                    {/* Lot info card */}
                    <div
                        className="flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-2xl min-w-0"
                        style={{
                            backgroundColor: "var(--surface)",
                            border: "1px solid var(--line)",
                            boxShadow: "0 6px 22px rgba(0,0,0,0.1)",
                            backdropFilter: "blur(12px)",
                        }}
                    >
                        <div
                            className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0"
                            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                        >
                            <LocateIcon />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-extrabold uppercase tracking-[0.05em]" style={{ color: "var(--muted)" }}>
                                {isNearCampus ? "You're in the zone" : "Parking zone"}
                            </div>
                            <div className="text-[13px] font-extrabold truncate" style={{ color: "var(--foreground)" }}>
                                {isNearCampus
                                    ? `${activeLotName} · ${zoneAvailability === "open" ? "Open" : zoneAvailability === "limited" ? "Limited" : "Full"}`
                                    : `${formatDistance(distanceToCampus, distanceUnits)} from zone`}
                            </div>
                        </div>
                    </div>

                    {/* Auth: logged in → streak + XP + avatar */}
                    {session && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full"
                                style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)", boxShadow: "0 4px 12px rgba(0,0,0,0.06)", backdropFilter: "blur(8px)", color: "var(--streak)" }}
                            >
                                <FlameIcon />
                                <span className="text-[13px] font-extrabold" style={{ color: "var(--foreground)" }}>{streakDays}</span>
                            </div>
                            <div
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-full"
                                style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)", boxShadow: "0 4px 12px rgba(0,0,0,0.06)", backdropFilter: "blur(8px)", color: "var(--accent)" }}
                            >
                                <BoltIcon />
                                <span className="text-[13px] font-extrabold" style={{ color: "var(--foreground)", fontFamily: "var(--font-geist-mono, monospace)" }}>{userPoints}</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowDashboard(true)}
                                className="w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-sm text-white flex-shrink-0"
                                style={{
                                    background: "linear-gradient(135deg, var(--accent), #5b8df7)",
                                    border: "2px solid rgba(255,255,255,0.75)",
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                                }}
                                aria-label="Open profile"
                            >
                                {sessionDisplayName.charAt(0).toUpperCase() || "U"}
                            </button>
                        </div>
                    )}

                    {/* Auth: logged out */}
                    {!session && isAuthReady && isInstalledDisplayMode && (
                        <button
                            type="button"
                            onClick={() => router.push("/login")}
                            className="rounded-full px-3 py-1.5 text-xs font-semibold flex-shrink-0"
                            style={{ border: "1px solid rgba(255,255,255,0.5)", backgroundColor: "rgba(15,23,42,0.5)", color: "#fff" }}
                        >
                            Sign in
                        </button>
                    )}
                </div>

                {/* Dev controls */}
                {DEV_REPORTS_RESET_ENABLED && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                        <button type="button" onClick={handleDevPremiumToggle}
                            className="rounded-full px-2.5 py-1 text-[10px] font-semibold text-white"
                            style={{ backgroundColor: isPremiumActive ? "rgba(245,158,11,0.75)" : "rgba(245,158,11,0.3)" }}>
                            {isPremiumActive ? "Premium ON" : "Premium OFF"}
                        </button>
                        <button type="button" onClick={() => setIsPointEditorEnabled((c) => !c)}
                            disabled={isSeedingReports || isResettingReports || isAddingDevPoint}
                            className="rounded-full px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-60"
                            style={{ backgroundColor: isPointEditorEnabled ? "rgba(59,130,246,0.7)" : "rgba(59,130,246,0.4)" }}>
                            {isPointEditorEnabled ? "Editor on" : "Point editor"}
                        </button>
                        <button type="button" onClick={() => void handleSeedReportsForTesting()}
                            disabled={isSeedingReports || isResettingReports || isAddingDevPoint}
                            className="rounded-full px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-60"
                            style={{ backgroundColor: "rgba(16,185,129,0.55)" }}>
                            {isSeedingReports ? "Seeding..." : "Seed"}
                        </button>
                        <button type="button" onClick={() => void handleResetReportsForTesting()}
                            disabled={isResettingReports || isSeedingReports || isAddingDevPoint}
                            className="rounded-full px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-60"
                            style={{ backgroundColor: "rgba(244,63,94,0.55)" }}>
                            {isResettingReports ? "Clearing..." : "Clear"}
                        </button>
                        {resetReportsFeedback && <span className="text-[10px] text-white/90 px-1 py-1">{resetReportsFeedback}</span>}
                    </div>
                )}

                {/* Dev point editor panel */}
                {DEV_REPORTS_RESET_ENABLED && isPointEditorEnabled && (
                    <div className="mt-1 rounded-xl border p-2"
                        style={{ borderColor: "rgba(59,130,246,0.55)", backgroundColor: "rgba(12,18,31,0.88)", backdropFilter: "blur(8px)" }}>
                        <p className="text-[11px] font-semibold text-white">Tap map to place a simulated report</p>
                        <div className="mt-2 grid grid-cols-3 gap-1">
                            {(["parked", "leaving", "observing"] as ReportActionType[]).map((at) => (
                                <button key={at} type="button" onClick={() => setDevPointActionType(at)}
                                    className="rounded-md px-2 py-1 text-[10px] font-semibold text-white"
                                    style={{ backgroundColor: devPointActionType === at ? "rgba(59,130,246,0.72)" : "rgba(148,163,184,0.32)" }}>
                                    {at === "observing" ? "observe" : at}
                                </button>
                            ))}
                        </div>
                        <div className="mt-1 grid grid-cols-5 gap-1">
                            {[1,2,3,4,5].map((l) => (
                                <button key={l} type="button" onClick={() => setDevPointFullnessLevel(l)}
                                    className="rounded-md py-1 text-[10px] font-semibold text-white"
                                    style={{ backgroundColor: devPointFullnessLevel === l ? "rgba(16,185,129,0.7)" : "rgba(148,163,184,0.3)" }}>
                                    {l}
                                </button>
                            ))}
                        </div>
                        <p className="mt-1 text-[10px] text-white/80">
                            {isAddingDevPoint ? "Adding..." : `${REPORT_ACTION_CONFIG[devPointActionType].label} · fullness ${devPointFullnessLevel}`}
                        </p>
                    </div>
                )}

            </div>

            {/* Recenter FAB — only when no lot sheet is visible */}
            {isAuthReady && session && !activeLotName && !selectedAction && (
                <div className="absolute right-4 bottom-6 z-10 md:hidden">
                    <button
                        type="button"
                        onClick={() => void handleRecenterToUser()}
                        disabled={isRecenteringMap}
                        className="w-11 h-11 rounded-[14px] flex items-center justify-center disabled:opacity-60"
                        style={{
                            backgroundColor: "var(--surface)",
                            border: "1px solid var(--line)",
                            boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
                            backdropFilter: "blur(8px)",
                            color: "var(--foreground)",
                        }}
                        aria-label="Center map on my location"
                    >
                        <RecenterIcon />
                    </button>
                </div>
            )}

            {/* Persistent bottom sheet — shown when logged in and a lot is selected */}
            {isAuthReady && session && activeLotName && (
                <div
                    className="fixed bottom-0 left-0 right-0 z-10 md:hidden"
                    style={{
                        transform: `translateY(${panelSwipeOffsetY}px)`,
                        transition: isPanelDragging ? "none" : isPanelClosing ? "transform 0.32s cubic-bezier(0.2,0.8,0.2,1)" : "transform 0.18s ease-out",
                        touchAction: "none",
                        overscrollBehaviorY: "contain",
                    }}
                    onTouchStart={handlePanelTouchStart}
                    onTouchMove={handlePanelTouchMove}
                    onTouchEnd={handlePanelTouchEnd}
                    onTouchCancel={handlePanelTouchEnd}
                >
                    <div
                        className="rounded-t-[20px]"
                        style={{
                            backgroundColor: "var(--surface)",
                            borderTop: "1px solid var(--line)",
                            borderLeft: "1px solid var(--line)",
                            borderRight: "1px solid var(--line)",
                            boxShadow: "0 -10px 40px rgba(0,0,0,0.14)",
                            backdropFilter: "blur(16px)",
                        }}
                    >
                        {/* Drag handle */}
                        <div className="flex justify-center pt-3 pb-1">
                            <div className="w-9 h-1 rounded-full" style={{ backgroundColor: "var(--line)" }} />
                        </div>

                        {!selectedAction ? (
                            /* Lot info + quick actions */
                            <div className="px-4 pt-2" style={{ paddingBottom: "calc(1.75rem + max(0px, env(safe-area-inset-bottom)))" }}>
                                <div className="flex items-center gap-3 mb-3">
                                    <div
                                        className="w-12 h-12 rounded-[14px] flex items-center justify-center font-extrabold text-sm text-white flex-shrink-0"
                                        style={{
                                            background: zoneAvailability === "open" ? "#10b981" : zoneAvailability === "limited" ? "#f59e0b" : "#dc2626",
                                        }}
                                    >
                                        {zoneAvailability === "open" ? "84" : zoneAvailability === "limited" ? "52" : "12"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[18px] font-extrabold leading-tight" style={{ color: "var(--foreground)" }}>
                                            {activeLotName}
                                        </div>
                                        <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                                            {zoneAvailability === "open" ? "Open" : zoneAvailability === "limited" ? "Limited" : "Full"}
                                            {" · "}
                                            {isLoadingReports ? "Loading..." : `${reports.filter((r) => !r.id.startsWith("optimistic-")).length} reports today`}
                                        </div>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => !isActionDisabledForParkState("parked", isUserParkedToday) && setSelectedAction("parked")}
                                    disabled={isActionDisabledForParkState("parked", isUserParkedToday)}
                                    className="w-full py-[14px] rounded-[14px] flex items-center justify-center gap-2 text-[15px] font-extrabold mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    style={{ background: "var(--accent)", color: "#fff", boxShadow: "0 4px 14px rgba(34,211,194,0.25)" }}
                                >
                                    <ActionIcon actionType="parked" />
                                    I parked here
                                    <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] font-extrabold" style={{ background: "rgba(0,0,0,0.18)" }}>+5</span>
                                </button>

                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => !isActionDisabledForParkState("leaving", isUserParkedToday) && setSelectedAction("leaving")}
                                        disabled={isActionDisabledForParkState("leaving", isUserParkedToday)}
                                        className="py-3 rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                        style={{ background: "transparent", border: "1.5px solid var(--line)", color: "var(--foreground)" }}
                                    >
                                        <ActionIcon actionType="leaving" />
                                        I&apos;m leaving
                                        <span className="text-[10px]" style={{ color: "var(--muted)" }}>+5</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedAction("observing")}
                                        className="py-3 rounded-xl flex items-center justify-center gap-1.5 text-[13px] font-bold"
                                        style={{ background: "transparent", border: "1.5px solid var(--line)", color: "var(--foreground)" }}
                                    >
                                        <ActionIcon actionType="observing" />
                                        Just checking
                                        <span className="text-[10px]" style={{ color: "var(--muted)" }}>+1</span>
                                    </button>
                                </div>

                                {reportFeedback && (
                                    <p className="mt-2 text-xs font-medium text-center" style={{ color: reportFeedback.includes("saved") ? "var(--accent)" : "#ef4444" }}>
                                        {reportFeedback}
                                    </p>
                                )}
                            </div>
                        ) : (
                            /* Fullness form */
                            <div className="px-4 pt-2" style={{ paddingBottom: "calc(2rem + max(0px, env(safe-area-inset-bottom)))" }}>
                                <div className="flex items-center gap-2.5 mb-4">
                                    <div
                                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white"
                                        style={{ background: "var(--accent)" }}
                                    >
                                        <ActionIcon actionType={selectedAction} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                                            {selectedAction === "parked" ? "I just parked at" : selectedAction === "leaving" ? "I'm leaving" : "Checking"}
                                        </div>
                                        <div className="text-[18px] font-extrabold leading-tight" style={{ color: "var(--foreground)" }}>
                                            {activeLotName}
                                        </div>
                                    </div>
                                    <div className="px-2.5 py-1 rounded-full text-xs font-extrabold flex-shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                                        {selectedAction === "observing" ? "+1" : "+5"}
                                    </div>
                                </div>

                                <form onSubmit={handleReportSubmit}>
                                    <div className="text-[13px] font-semibold mb-2" style={{ color: "var(--muted)" }}>How full is it now?</div>

                                    <div className="grid grid-cols-5 gap-2 mb-3">
                                        {[1,2,3,4,5].map((level) => {
                                            const isSel = fullnessLevel === level;
                                            const barColor = level <= 2 ? "#10b981" : level <= 3 ? "#f59e0b" : "#dc2626";
                                            return (
                                                <button
                                                    key={level}
                                                    type="button"
                                                    onClick={() => setFullnessLevel(level)}
                                                    className="py-3.5 rounded-[14px] flex flex-col items-center gap-1.5 transition-all"
                                                    style={{
                                                        background: isSel ? barColor : "transparent",
                                                        border: `2px solid ${isSel ? barColor : "var(--line)"}`,
                                                        transform: isSel ? "translateY(-2px)" : "none",
                                                    }}
                                                    aria-label={`Fullness level ${level}`}
                                                >
                                                    <FullnessIcon level={level} selected={isSel} />
                                                    <span className="text-[11px] font-extrabold" style={{ color: isSel ? "#fff" : "var(--foreground)" }}>
                                                        {level}/5
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {fullnessLevel && (
                                        <div
                                            className="flex items-center justify-between px-3 py-2.5 rounded-xl mb-3"
                                            style={{ background: "var(--surface-strong)", border: "1px solid var(--line)" }}
                                        >
                                            <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
                                                {FULLNESS_DESCRIPTIONS[fullnessLevel]}
                                            </span>
                                            <span className="text-xs font-extrabold ml-2 flex-shrink-0" style={{ color: fullnessLevel <= 2 ? "#10b981" : fullnessLevel <= 3 ? "#f59e0b" : "#dc2626" }}>
                                                {Math.max(0, 100 - fullnessLevel * 18)}% open
                                            </span>
                                        </div>
                                    )}

                                    {reportFeedback && (
                                        <p className="text-xs font-medium mb-3" style={{ color: reportFeedback.includes("saved") ? "var(--accent)" : "#ef4444" }}>
                                            {reportFeedback}
                                        </p>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={!canSubmitReport}
                                        className="w-full py-4 rounded-2xl text-[16px] font-extrabold flex items-center justify-center gap-2 transition disabled:cursor-not-allowed"
                                        style={{
                                            background: canSubmitReport ? "var(--accent)" : "var(--line)",
                                            color: canSubmitReport ? "#fff" : "var(--muted)",
                                            boxShadow: canSubmitReport ? "0 6px 18px rgba(34,211,194,0.22)" : "none",
                                        }}
                                    >
                                        <CheckIcon />
                                        {isSubmittingReport ? "Submitting..." : "Submit report"}
                                    </button>
                                    <p className="text-center text-[11px] mt-2.5 font-semibold" style={{ color: "var(--muted)" }}>
                                        Anonymous · helps everyone find a spot
                                    </p>
                                </form>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modals */}
            {showDashboard && (
                <UserDashboard
                    session={session}
                    onSignOut={handleSignOut}
                    isSigningOut={isSigningOut}
                    onSettingsClick={() => setShowSettings(true)}
                    onLeaderboardClick={() => setShowLeaderboard(true)}
                    onClose={() => setShowDashboard(false)}
                    onPremiumStatusChange={(status) => { applyPremiumStatus(status); }}
                    onFindMyCar={() => { setShowDashboard(false); handleFindMyCar(); }}
                    streakDays={streakDays}
                />
            )}

            {showSettings && <SettingsModal session={session} onClose={() => setShowSettings(false)} />}
            {showLeaderboard && <LeaderboardModal session={session} onClose={() => setShowLeaderboard(false)} />}

            <style jsx>{`
                @keyframes slideUp {
                    from { transform: translateY(100%); }
                    to { transform: translateY(0); }
                }
                @keyframes jac-user-location-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.5); }
                    70% { box-shadow: 0 0 0 14px rgba(37,99,235,0); }
                    100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); }
                }
                :global(.jac-user-location-marker) {
                    width: 18px;
                    height: 18px;
                    border-radius: 999px;
                    border: 2px solid #ffffff;
                    background: #2563eb;
                    animation: jac-user-location-pulse 1.6s ease-out infinite;
                }
                :global(.jac-parked-car-pin) {
                    width: 34px;
                    height: 34px;
                    border-radius: 50% 50% 50% 0;
                    background: #22d3c2;
                    border: 2px solid white;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.35);
                    transform: rotate(-45deg);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                :global(.jac-parked-car-pin svg) {
                    transform: rotate(45deg);
                }
            `}</style>
        </section>
    );
}
