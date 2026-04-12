"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type TouchEvent } from "react";
import { useRouter } from "next/navigation";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Session } from "@supabase/supabase-js";
import mapboxgl from "mapbox-gl";
import useCampusProximity from "../hooks/useCampusProximity";
import { CAMPUS_RADIUS_METERS, haversineDistanceMeters, type LatLng } from "../lib/geo";
import { getSupabaseBrowserClient } from "../lib/supabaseBrowser";
import { useTheme } from "../lib/ThemeContext";
import UserDashboard from "./UserDashboard";
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

type ReportResponse = {
    report?: ParkingReport;
    error?: string;
};

type BoundaryFeatureCollection = FeatureCollection<Polygon | MultiPolygon>;

const JOHN_ABBOTT_CENTER: LngLatTuple = [-73.94212693281301, 45.408822013619336];
const JOHN_ABBOTT_ZOOM = 15;
const LIGHT_STYLE_URL = "mapbox://styles/mapbox/standard";
const BOUNDARY_SOURCE_ID = "parking-boundary-source";
const BOUNDARY_FILL_LAYER_ID = "parking-boundary-fill";
const BOUNDARY_LINE_LAYER_ID = "parking-boundary-line";
const BOUNDARY_GEOJSON_PATH = "/boundaries/jac-parking-boundaries.geojson";
const REPORTS_HEATMAP_SOURCE_ID = "parking-reports-heatmap";
const REPORTS_HEATMAP_LAYER_ID = "parking-reports-heatmap-layer";
const REPORTS_HEATMAP_POINTS_LAYER_ID = "parking-reports-points-layer";
const HEATMAP_REPORTS_LIMIT = 120;
const HEATMAP_PRIVACY_CELL_METERS = 44;
const HEATMAP_CELL_CENTER_BLEND = 0.22;
const HEATMAP_MERGE_DISTANCE_MULTIPLIER = 1.35;
const HEATMAP_MAX_REPORT_AGE_MS = 3 * 60 * 60 * 1000;
const HEATMAP_BASE_HALFLIFE_MS = 50 * 60 * 1000;
const HEATMAP_RECENT_WINDOW_MS = 12 * 60 * 1000;
const HEATMAP_HIGH_ACTIVITY_WINDOW_MS = 20 * 60 * 1000;
const HEATMAP_HIGH_ACTIVITY_THRESHOLD = 18;
const HEATMAP_IMPORTANCE_FLOOR = 0.06;
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
const REPORTS_RESET_KEY_HEADER = "x-jacpark-reset-key";

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
        selected: "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/45 dark:text-emerald-100",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-emerald-400",
    },
    2: {
        selected: "border-lime-500 bg-lime-50 text-lime-900 dark:bg-lime-950/45 dark:text-lime-100",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-lime-400",
    },
    3: {
        selected: "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/45 dark:text-amber-100",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-amber-400",
    },
    4: {
        selected: "border-orange-500 bg-orange-50 text-orange-900 dark:bg-orange-950/45 dark:text-orange-100",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-orange-400",
    },
    5: {
        selected: "border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-950/45 dark:text-rose-100",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-rose-400",
    },
};

const FULLNESS_ICON_SELECTED_COLORS: Record<number, string> = {
    1: "#10b981",
    2: "#84cc16",
    3: "#f59e0b",
    4: "#f97316",
    5: "#f43f5e",
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

const buildOptimisticReport = (
    actionType: ReportActionType,
    fullnessLevel: number,
    distanceToCampusMeters: number,
    reporterLocation: LatLng,
): ParkingReport => ({
    id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lotName: "John Abbott Parking",
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

const formatDistance = (meters: number): string => {
    if (!Number.isFinite(meters)) {
        return "unknown";
    }

    return `${Math.round(meters)} m`;
};

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getNormalizedFullness = (report: ParkingReport): number => {
    if (Number.isInteger(report.fullnessLevel) && report.fullnessLevel !== null) {
        return clampNumber((report.fullnessLevel - 1) / 4, 0, 1);
    }

    if (report.availability === "open") {
        return 0.2;
    }

    if (report.availability === "limited") {
        return 0.58;
    }

    return 0.9;
};

const getActionSignal = (report: ParkingReport): number => {
    const fullnessSignal = getNormalizedFullness(report) * 2 - 1;

    if (report.actionType === "parked") {
        return clampNumber(fullnessSignal + 0.35, -1, 1);
    }

    if (report.actionType === "leaving") {
        return clampNumber(fullnessSignal - 0.55, -1, 1);
    }

    return clampNumber(fullnessSignal, -1, 1);
};

const getPrivacyCellMeters = (): number => HEATMAP_PRIVACY_CELL_METERS;

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
    const mapLightPresetRef = useRef<"day" | "night">("day");
    const latestCardTouchStartRef = useRef<{ x: number; y: number } | null>(null);
    const panelTouchStartYRef = useRef<number | null>(null);
    const boundaryDataRef = useRef<BoundaryFeatureCollection | null>(null);
    const latestTransitionFrameRef = useRef<number | null>(null);
    const previousUpdateClearTimeoutRef = useRef<number | null>(null);

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
    const [isMapReady, setIsMapReady] = useState<boolean>(false);
    const [isPointEditorEnabled, setIsPointEditorEnabled] = useState<boolean>(false);
    const [devPointActionType, setDevPointActionType] = useState<ReportActionType>("observing");
    const [devPointFullnessLevel, setDevPointFullnessLevel] = useState<number>(3);
    const [isAddingDevPoint, setIsAddingDevPoint] = useState<boolean>(false);
    const [isSeedingReports, setIsSeedingReports] = useState<boolean>(false);
    const [isResettingReports, setIsResettingReports] = useState<boolean>(false);
    const [resetReportsFeedback, setResetReportsFeedback] = useState<string>("");

    const { isNearCampus, distanceToCampus, locationError, currentLocation } = useCampusProximity();

    const sessionDisplayName = useMemo(() => getSessionDisplayName(session), [session]);

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

    // Complex hotspot model: privacy-safe gridding, time decay, conflict scoring, and spatial merge.
    const heatmapData = useMemo(() => {
        const nowMs = Date.now();
        const privacyCellMeters = getPrivacyCellMeters();
        const mergeDistanceMeters = privacyCellMeters * HEATMAP_MERGE_DISTANCE_MULTIPLIER;

        const preparedReports = reports
            .filter(
                (report) =>
                    !report.id.startsWith("optimistic-") &&
                    Number.isFinite(report.reporterLatitude) &&
                    Number.isFinite(report.reporterLongitude) &&
                    Number.isFinite(report.distanceToCampusMeters) &&
                    report.distanceToCampusMeters <= CAMPUS_RADIUS_METERS * 1.2,
            )
            .map((report) => {
                const timestampMs = Date.parse(report.createdAt);

                if (Number.isNaN(timestampMs)) {
                    return null;
                }

                const ageMs = Math.max(0, nowMs - timestampMs);

                if (ageMs > HEATMAP_MAX_REPORT_AGE_MS) {
                    return null;
                }

                return {
                    report,
                    timestampMs,
                    ageMs,
                };
            })
            .filter(
                (
                    entry,
                ): entry is {
                    report: ParkingReport;
                    timestampMs: number;
                    ageMs: number;
                } => entry !== null,
            );

        if (preparedReports.length === 0) {
            return { type: "FeatureCollection" as const, features: [] };
        }

        const highActivityCount = preparedReports.reduce(
            (count, entry) => count + (entry.ageMs <= HEATMAP_HIGH_ACTIVITY_WINDOW_MS ? 1 : 0),
            0,
        );
        const activityFactor = clampNumber(highActivityCount / HEATMAP_HIGH_ACTIVITY_THRESHOLD, 0, 1);
        const dynamicHalfLifeMs = HEATMAP_BASE_HALFLIFE_MS * (1 - activityFactor * 0.45);

        type CellBucket = {
            weightedLatitude: number;
            weightedLongitude: number;
            cellCenterLatitude: number;
            cellCenterLongitude: number;
            totalImportance: number;
            weightedSignal: number;
            weightedSignalSquared: number;
            parkedInfluence: number;
            leavingInfluence: number;
            reportCount: number;
            recentCount: number;
            latestTimestampMs: number;
        };

        const buckets = new Map<string, CellBucket>();

        for (const entry of preparedReports) {
            const report = entry.report;
            const signal = getActionSignal(report);

            const recencyWeight = Math.exp(-entry.ageMs / Math.max(1, dynamicHalfLifeMs));
            const freshnessBoost = entry.ageMs <= HEATMAP_RECENT_WINDOW_MS ? 1.25 : 1;
            const actionReliability = report.actionType === "observing" ? 1 : 0.9;
            const importance = recencyWeight * freshnessBoost * actionReliability;

            const cosLat = Math.max(0.35, Math.cos((report.reporterLatitude * Math.PI) / 180));
            const xMeters = report.reporterLongitude * 111320 * cosLat;
            const yMeters = report.reporterLatitude * 111320;

            const cellX = Math.round(xMeters / privacyCellMeters);
            const cellY = Math.round(yMeters / privacyCellMeters);
            const bucketKey = `${cellX}:${cellY}`;

            const centerLatitude = (cellY * privacyCellMeters) / 111320;
            const centerCosLat = Math.max(0.35, Math.cos((centerLatitude * Math.PI) / 180));
            const centerLongitude = (cellX * privacyCellMeters) / (111320 * centerCosLat);

            const bucket = buckets.get(bucketKey);

            if (!bucket) {
                buckets.set(bucketKey, {
                    weightedLatitude: report.reporterLatitude * importance,
                    weightedLongitude: report.reporterLongitude * importance,
                    cellCenterLatitude: centerLatitude,
                    cellCenterLongitude: centerLongitude,
                    totalImportance: importance,
                    weightedSignal: signal * importance,
                    weightedSignalSquared: signal * signal * importance,
                    parkedInfluence: report.actionType === "parked" ? importance * (0.6 + 0.4 * Math.max(0, signal)) : 0,
                    leavingInfluence: report.actionType === "leaving" ? importance * (0.6 + 0.4 * Math.max(0, -signal)) : 0,
                    reportCount: 1,
                    recentCount: entry.ageMs <= HEATMAP_RECENT_WINDOW_MS ? 1 : 0,
                    latestTimestampMs: entry.timestampMs,
                });

                continue;
            }

            bucket.weightedLatitude += report.reporterLatitude * importance;
            bucket.weightedLongitude += report.reporterLongitude * importance;
            bucket.totalImportance += importance;
            bucket.weightedSignal += signal * importance;
            bucket.weightedSignalSquared += signal * signal * importance;
            bucket.reportCount += 1;
            if (entry.ageMs <= HEATMAP_RECENT_WINDOW_MS) {
                bucket.recentCount += 1;
            }

            if (report.actionType === "parked") {
                bucket.parkedInfluence += importance * (0.6 + 0.4 * Math.max(0, signal));
            } else if (report.actionType === "leaving") {
                bucket.leavingInfluence += importance * (0.6 + 0.4 * Math.max(0, -signal));
            }

            bucket.latestTimestampMs = Math.max(bucket.latestTimestampMs, entry.timestampMs);
        }

        type ProtoHotspot = {
            latitude: number;
            longitude: number;
            importance: number;
            confidence: number;
            pressure: number;
            reportCount: number;
            recentCount: number;
            latestTimestampMs: number;
        };

        const protoHotspots: ProtoHotspot[] = Array.from(buckets.values())
            .map((bucket) => {
                if (bucket.totalImportance <= 0) {
                    return null;
                }

                const meanSignal = bucket.weightedSignal / bucket.totalImportance;
                const meanSignalSquared = bucket.weightedSignalSquared / bucket.totalImportance;
                const variance = Math.max(0, meanSignalSquared - meanSignal * meanSignal);

                const conflictRatio = clampNumber(
                    Math.min(bucket.parkedInfluence, bucket.leavingInfluence) / (bucket.totalImportance + 1e-6),
                    0,
                    1,
                );

                const disagreementPenalty = clampNumber(Math.sqrt(variance) * 0.65 + conflictRatio * 0.75, 0, 0.92);
                const confidence = clampNumber(1 - disagreementPenalty, 0.08, 1);

                const parkMomentum = clampNumber(
                    (bucket.parkedInfluence - bucket.leavingInfluence) / (bucket.totalImportance + 1e-6),
                    -0.55,
                    0.55,
                );

                const supportBoost = clampNumber(bucket.recentCount / 3, 0, 1) * 0.18;
                const stalePenalty =
                    nowMs - bucket.latestTimestampMs > 2 * 60 * 60 * 1000 ? (bucket.recentCount > 0 ? 0.6 : 0.28) : 1;

                const pressure = clampNumber(meanSignal + parkMomentum * 0.35 + supportBoost, -1, 1);
                const reportDensityBoost = clampNumber(Math.log2(bucket.reportCount + 1) / 2.3, 0.4, 1.3);
                const importance = clampNumber(((pressure + 1) / 2) * confidence * reportDensityBoost * stalePenalty, 0, 2.6);

                if (importance < HEATMAP_IMPORTANCE_FLOOR) {
                    return null;
                }

                const centroidLatitude = bucket.weightedLatitude / bucket.totalImportance;
                const centroidLongitude = bucket.weightedLongitude / bucket.totalImportance;
                const blendedLatitude =
                    centroidLatitude * (1 - HEATMAP_CELL_CENTER_BLEND) + bucket.cellCenterLatitude * HEATMAP_CELL_CENTER_BLEND;
                const blendedLongitude =
                    centroidLongitude * (1 - HEATMAP_CELL_CENTER_BLEND) + bucket.cellCenterLongitude * HEATMAP_CELL_CENTER_BLEND;

                return {
                    latitude: blendedLatitude,
                    longitude: blendedLongitude,
                    importance,
                    confidence,
                    pressure,
                    reportCount: bucket.reportCount,
                    recentCount: bucket.recentCount,
                    latestTimestampMs: bucket.latestTimestampMs,
                };
            })
            .filter((bucket): bucket is ProtoHotspot => bucket !== null);

        if (protoHotspots.length === 0) {
            return { type: "FeatureCollection" as const, features: [] };
        }

        const mergedHotspots: Array<ProtoHotspot & { mergedCells: number }> = [];
        const visited = new Set<number>();

        for (let i = 0; i < protoHotspots.length; i += 1) {
            if (visited.has(i)) {
                continue;
            }

            const stack = [i];
            visited.add(i);

            let weightedLatitude = 0;
            let weightedLongitude = 0;
            let weightedConfidence = 0;
            let weightedPressure = 0;
            let totalImportance = 0;
            let totalReports = 0;
            let totalRecent = 0;
            let latestTimestampMs = 0;
            let mergedCells = 0;

            while (stack.length > 0) {
                const index = stack.pop() as number;
                const current = protoHotspots[index];

                weightedLatitude += current.latitude * current.importance;
                weightedLongitude += current.longitude * current.importance;
                weightedConfidence += current.confidence * current.importance;
                weightedPressure += current.pressure * current.importance;
                totalImportance += current.importance;
                totalReports += current.reportCount;
                totalRecent += current.recentCount;
                latestTimestampMs = Math.max(latestTimestampMs, current.latestTimestampMs);
                mergedCells += 1;

                for (let j = 0; j < protoHotspots.length; j += 1) {
                    if (visited.has(j)) {
                        continue;
                    }

                    const candidate = protoHotspots[j];
                    const distanceMeters = haversineDistanceMeters(
                        {
                            latitude: current.latitude,
                            longitude: current.longitude,
                        },
                        {
                            latitude: candidate.latitude,
                            longitude: candidate.longitude,
                        },
                    );

                    if (distanceMeters <= mergeDistanceMeters) {
                        visited.add(j);
                        stack.push(j);
                    }
                }
            }

            const safeImportance = Math.max(totalImportance, 1e-6);

            mergedHotspots.push({
                latitude: weightedLatitude / safeImportance,
                longitude: weightedLongitude / safeImportance,
                confidence: clampNumber(weightedConfidence / safeImportance, 0.08, 1),
                pressure: clampNumber(weightedPressure / safeImportance, -1, 1),
                importance: clampNumber(totalImportance, 0, 3.4),
                reportCount: totalReports,
                recentCount: totalRecent,
                latestTimestampMs,
                mergedCells,
            });
        }

        return {
            type: "FeatureCollection" as const,
            features: mergedHotspots.map((hotspot) => ({
                type: "Feature" as const,
                geometry: {
                    type: "Point" as const,
                    coordinates: [hotspot.longitude, hotspot.latitude] as [number, number],
                },
                properties: {
                    weight: hotspot.importance,
                    pressure: hotspot.pressure,
                    confidence: hotspot.confidence,
                    reportCount: hotspot.reportCount,
                    recentCount: hotspot.recentCount,
                    mergedCells: hotspot.mergedCells,
                    timestamp: new Date(hotspot.latestTimestampMs).toISOString(),
                },
            })),
        };
    }, [reports]);

    useEffect(() => {
        return () => {
            if (latestTransitionFrameRef.current !== null) {
                window.cancelAnimationFrame(latestTransitionFrameRef.current);
            }

            if (previousUpdateClearTimeoutRef.current !== null) {
                window.clearTimeout(previousUpdateClearTimeoutRef.current);
            }
        };
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

                setDismissedLatestReportId(null);
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
                )}.`,
            );
            return;
        }

        const actionToSubmit = selectedAction;
        const fullnessToSubmit = fullnessLevel;

        const previousReportsSnapshot = reports;
        const previousParkState = isUserParkedToday;

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

            const optimisticReport = buildOptimisticReport(actionToSubmit, fullnessToSubmit, distanceToCampus, reporterLocation);

            setReports((prevReports) => {
                const nonOptimisticReports = prevReports.filter((report) => !report.id.startsWith("optimistic-"));
                return [optimisticReport, ...nonOptimisticReports].slice(0, HEATMAP_REPORTS_LIMIT);
            });

            if (actionToSubmit === "parked") {
                setIsUserParkedToday(true);
            } else if (actionToSubmit === "leaving") {
                setIsUserParkedToday(false);
            }

            const { response, payload } = await submitReportWithRetry(
                session.access_token,
                actionToSubmit,
                fullnessToSubmit,
                reporterLocation,
            );

            if (!response.ok || !payload.report) {
                setReports(previousReportsSnapshot);
                setIsUserParkedToday(previousParkState);
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

            setReportFeedback("Report saved.");
        } catch {
            setReports(previousReportsSnapshot);
            setIsUserParkedToday(previousParkState);
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
        const newestReport = reports[0] ?? null;

        if (!newestReport) {
            setLatestReport(null);
            setPreviousReport(null);
            setIsPreviousReportFading(false);
            setIsLatestReportEntering(false);
            return;
        }

        if (!latestReport) {
            setLatestReport(newestReport);
            return;
        }

        if (newestReport.id === latestReport.id) {
            return;
        }

        if (latestTransitionFrameRef.current !== null) {
            window.cancelAnimationFrame(latestTransitionFrameRef.current);
            latestTransitionFrameRef.current = null;
        }

        if (previousUpdateClearTimeoutRef.current !== null) {
            window.clearTimeout(previousUpdateClearTimeoutRef.current);
            previousUpdateClearTimeoutRef.current = null;
        }

        setPreviousReport(latestReport);
        setIsPreviousReportFading(false);
        setLatestReport(newestReport);
        setIsLatestReportEntering(true);

        latestTransitionFrameRef.current = window.requestAnimationFrame(() => {
            setIsPreviousReportFading(true);
            setIsLatestReportEntering(false);
            latestTransitionFrameRef.current = null;
        });

        previousUpdateClearTimeoutRef.current = window.setTimeout(() => {
            setPreviousReport(null);
            previousUpdateClearTimeoutRef.current = null;
        }, 450);
    }, [reports, latestReport]);

    useEffect(() => {
        setLatestCardSwipeOffsetX(0);
        setLatestCardSwipeOffsetY(0);
        setIsLatestCardDragging(false);
        latestCardTouchStartRef.current = null;

        if (!latestReport) {
            return;
        }

        setDismissedLatestReportId((currentDismissedId) => (currentDismissedId === latestReport.id ? currentDismissedId : null));
    }, [latestReport]);

    const visibleLatestReport = useMemo(() => {
        if (!latestReport || latestReport.id === dismissedLatestReportId) {
            return null;
        }

        return latestReport;
    }, [latestReport, dismissedLatestReportId]);

    const handleLatestReportTouchStart = (event: TouchEvent<HTMLDivElement>): void => {
        if (!visibleLatestReport) {
            return;
        }

        const touchPoint = event.touches[0];

        if (!touchPoint) {
            return;
        }

        latestCardTouchStartRef.current = {
            x: touchPoint.clientX,
            y: touchPoint.clientY,
        };

        setIsLatestCardDragging(true);
    };

    const handleLatestReportTouchMove = (event: TouchEvent<HTMLDivElement>): void => {
        if (!latestCardTouchStartRef.current) {
            return;
        }

        const touchPoint = event.touches[0];

        if (!touchPoint) {
            return;
        }

        const swipeDeltaX = touchPoint.clientX - latestCardTouchStartRef.current.x;
        const swipeDeltaY = touchPoint.clientY - latestCardTouchStartRef.current.y;

        setLatestCardSwipeOffsetX(swipeDeltaX);
        setLatestCardSwipeOffsetY(Math.min(0, swipeDeltaY));
    };

    const handleLatestReportTouchEnd = (): void => {
        setIsLatestCardDragging(false);

        const shouldDismissByHorizontalSwipe = Math.abs(latestCardSwipeOffsetX) >= SWIPE_DISMISS_THRESHOLD_PX;
        const shouldDismissByUpSwipe = latestCardSwipeOffsetY <= -SWIPE_UP_DISMISS_THRESHOLD_PX;

        if ((shouldDismissByHorizontalSwipe || shouldDismissByUpSwipe) && visibleLatestReport) {
            setDismissedLatestReportId(visibleLatestReport.id);
        }

        setLatestCardSwipeOffsetX(0);
        setLatestCardSwipeOffsetY(0);
        latestCardTouchStartRef.current = null;
    };

    useEffect(() => {
        setPanelSwipeOffsetY(0);
        setIsPanelDragging(false);
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
        const touchPoint = event.touches[0];

        if (!touchPoint) {
            return;
        }

        panelTouchStartYRef.current = touchPoint.clientY;
        setIsPanelDragging(true);
    };

    const handlePanelTouchMove = (event: TouchEvent<HTMLDivElement>): void => {
        if (panelTouchStartYRef.current === null) {
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

    const handlePanelTouchEnd = (): void => {
        setIsPanelDragging(false);

        if (panelSwipeOffsetY >= PANEL_SWIPE_CLOSE_THRESHOLD_PX) {
            setSelectedAction(null);
            setFullnessLevel(null);
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

        let isActive = true;

        const addBoundaryLayers = async (): Promise<void> => {
            try {
                // Load boundary data if not already cached
                if (!boundaryDataRef.current) {
                    const boundaryResponse = await fetch(BOUNDARY_GEOJSON_PATH, {
                        method: "GET",
                        cache: "no-store",
                    });

                    if (!boundaryResponse.ok) {
                        throw new Error("Boundary file missing.");
                    }

                    boundaryDataRef.current = (await boundaryResponse.json()) as BoundaryFeatureCollection;
                }

                const boundaryData = boundaryDataRef.current;

                if (!boundaryData) {
                    throw new Error("Boundary data unavailable.");
                }

                if (!isActive) {
                    return;
                }

                // Add source if it doesn't exist
                if (!map.getSource(BOUNDARY_SOURCE_ID)) {
                    map.addSource(BOUNDARY_SOURCE_ID, {
                        type: "geojson",
                        data: boundaryData,
                    });
                }

                // Guard against style/source race conditions.
                if (!map.getSource(BOUNDARY_SOURCE_ID)) {
                    return;
                }

                // Add fill layer if it doesn't exist
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

                // Add line layer if it doesn't exist
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

                setBoundaryLoadError("");
            } catch {
                if (isActive) {
                    setBoundaryLoadError("Unable to load hardcoded boundary file.");
                }
            }
        };

        const handleMapLoad = (): void => {
            setIsMapReady(true);
            void addBoundaryLayers();
        };

        map.on("load", handleMapLoad);

        return () => {
            isActive = false;
            userLocationMarkerRef.current?.remove();
            userLocationMarkerRef.current = null;
            map.off("load", handleMapLoad);
            map.remove();
            mapRef.current = null;
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

    // Manage heatmap layer
    useEffect(() => {
        if (!isMapReady || !mapRef.current || !mapRef.current.isStyleLoaded()) {
            return;
        }

        const map = mapRef.current;
        const data = heatmapData;

        // Ensure source exists
        const existingSource = map.getSource(REPORTS_HEATMAP_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (!existingSource) {
            map.addSource(REPORTS_HEATMAP_SOURCE_ID, {
                type: "geojson",
                data,
            });
        } else {
            existingSource.setData(data);
        }

        const boundaryFillLayerExists = Boolean(map.getLayer(BOUNDARY_FILL_LAYER_ID));

        // Add heatmap layer if it doesn't exist
        if (!map.getLayer(REPORTS_HEATMAP_LAYER_ID)) {
            const heatmapLayer: mapboxgl.HeatmapLayer = {
                id: REPORTS_HEATMAP_LAYER_ID,
                type: "heatmap",
                source: REPORTS_HEATMAP_SOURCE_ID,
                paint: {
                    "heatmap-weight": [
                        "*",
                        ["coalesce", ["get", "weight"], 0],
                        ["interpolate", ["linear"], ["coalesce", ["get", "confidence"], 0.4], 0, 0.25, 1, 1],
                    ],
                    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.9, 12, 1.2, 15, 1.45, 18, 1.75],
                    "heatmap-color": [
                        "interpolate",
                        ["linear"],
                        ["heatmap-density"],
                        0,
                        "rgba(81, 187, 214, 0)",
                        0.15,
                        "#51bbd6",
                        0.35,
                        "#f1f075",
                        0.6,
                        "#f28b36",
                        1,
                        "#b41135",
                    ],
                    "heatmap-radius": ["interpolate", ["exponential", 1.35], ["zoom"], 9, 10, 12, 20, 15, 38, 18, 70, 20, 100],
                    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.72, 13, 0.84, 17, 0.9, 20, 0.8],
                },
            };

            if (boundaryFillLayerExists) {
                map.addLayer(heatmapLayer, BOUNDARY_FILL_LAYER_ID);
            } else {
                map.addLayer(heatmapLayer);
            }
        } else if (boundaryFillLayerExists) {
            map.moveLayer(REPORTS_HEATMAP_LAYER_ID, BOUNDARY_FILL_LAYER_ID);
        }

        // Remove explicit point rendering to avoid exposing precise reported positions.
        if (map.getLayer(REPORTS_HEATMAP_POINTS_LAYER_ID)) {
            map.removeLayer(REPORTS_HEATMAP_POINTS_LAYER_ID);
        }
    }, [heatmapData, isMapReady]);

    return (
        <section className="relative h-[100dvh] w-screen overflow-hidden" style={{ overscrollBehaviorY: "contain" }}>
            {/* Full-screen map */}
            <div ref={mapContainerRef} className="h-full w-full" />

            {/* Top bar: minimal info */}
            <div
                className="absolute top-0 left-0 right-0 z-10 px-4 py-3 sm:py-4 flex items-center justify-between"
                style={{ backgroundColor: "rgba(0,0,0,0.3)", backdropFilter: "blur(8px)" }}
            >
                <div className="flex items-center gap-2">
                    {isNearCampus ? (
                        <div className="text-sm sm:text-base font-semibold text-green-400">✓ In reporting zone</div>
                    ) : (
                        <>
                            <div className="text-sm sm:text-base font-semibold text-white">
                                {formatDistance(distanceToCampus)} away
                            </div>
                            <div className="text-xs sm:text-sm font-medium text-amber-400">from zone</div>
                        </>
                    )}
                </div>
                <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                        {DEV_REPORTS_RESET_ENABLED ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsPointEditorEnabled((current) => !current);
                                    }}
                                    disabled={isSeedingReports || isResettingReports || isAddingDevPoint}
                                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:opacity-60"
                                    style={{
                                        backgroundColor: isPointEditorEnabled
                                            ? "rgba(59, 130, 246, 0.7)"
                                            : "rgba(59, 130, 246, 0.4)",
                                    }}
                                >
                                    {isPointEditorEnabled ? "Editor on" : "Point editor"}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        void handleSeedReportsForTesting();
                                    }}
                                    disabled={isSeedingReports || isResettingReports || isAddingDevPoint}
                                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:opacity-60"
                                    style={{ backgroundColor: "rgba(16, 185, 129, 0.55)" }}
                                >
                                    {isSeedingReports ? "Seeding..." : "Seed sample"}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        void handleResetReportsForTesting();
                                    }}
                                    disabled={isResettingReports || isSeedingReports || isAddingDevPoint}
                                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:opacity-60"
                                    style={{ backgroundColor: "rgba(244, 63, 94, 0.55)" }}
                                >
                                    {isResettingReports ? "Clearing..." : "Clear reports"}
                                </button>
                            </>
                        ) : null}

                        {session ? (
                            <button
                                onClick={() => setShowDashboard(true)}
                                className="px-3 py-1.5 rounded-full text-xs font-semibold text-white transition"
                                style={{ backgroundColor: "rgba(59, 130, 246, 0.4)" }}
                            >
                                👤
                            </button>
                        ) : (
                            <div className="text-xs text-gray-300">Sign in to report</div>
                        )}
                    </div>

                    {resetReportsFeedback ? (
                        <p className="max-w-[180px] text-right text-[11px] font-medium text-white/90">{resetReportsFeedback}</p>
                    ) : null}

                    {DEV_REPORTS_RESET_ENABLED && isPointEditorEnabled ? (
                        <div
                            className="w-[240px] rounded-xl border p-2"
                            style={{
                                borderColor: "rgba(59,130,246,0.55)",
                                backgroundColor: "rgba(12, 18, 31, 0.78)",
                                backdropFilter: "blur(8px)",
                            }}
                        >
                            <p className="text-[11px] font-semibold text-white">Tap map to place a simulated report</p>
                            <p className="mt-1 text-[10px] text-white/75">Pick action + fullness, then tap any location.</p>

                            <div className="mt-2 grid grid-cols-3 gap-1">
                                {(["parked", "leaving", "observing"] as ReportActionType[]).map((actionType) => {
                                    const isSelected = devPointActionType === actionType;

                                    return (
                                        <button
                                            key={actionType}
                                            type="button"
                                            onClick={() => {
                                                setDevPointActionType(actionType);
                                            }}
                                            className="rounded-md px-2 py-1 text-[10px] font-semibold text-white transition"
                                            style={{
                                                backgroundColor: isSelected ? "rgba(59,130,246,0.72)" : "rgba(148,163,184,0.32)",
                                            }}
                                        >
                                            {actionType === "observing" ? "observe" : actionType}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="mt-2 grid grid-cols-5 gap-1">
                                {[1, 2, 3, 4, 5].map((level) => {
                                    const isSelected = devPointFullnessLevel === level;

                                    return (
                                        <button
                                            key={level}
                                            type="button"
                                            onClick={() => {
                                                setDevPointFullnessLevel(level);
                                            }}
                                            className="rounded-md px-0 py-1 text-[10px] font-semibold text-white transition"
                                            style={{
                                                backgroundColor: isSelected ? "rgba(16,185,129,0.7)" : "rgba(148,163,184,0.3)",
                                            }}
                                        >
                                            {level}
                                        </button>
                                    );
                                })}
                            </div>

                            <p className="mt-2 text-[10px] text-white/80">
                                {isAddingDevPoint
                                    ? "Adding point..."
                                    : `${REPORT_ACTION_CONFIG[devPointActionType].label} · fullness ${devPointFullnessLevel}`}
                            </p>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* Bottom sheet: report form (only show when action selected) */}
            {selectedAction && (
                <div
                    className="fixed bottom-0 left-0 right-0 z-20 pt-3"
                    style={{
                        animation: "slideUp 0.3s ease-out",
                        transform: `translateY(${panelSwipeOffsetY}px)`,
                        transition: isPanelDragging ? "none" : "transform 0.18s ease",
                        touchAction: "none",
                        overscrollBehaviorY: "contain",
                    }}
                    onTouchStart={handlePanelTouchStart}
                    onTouchMove={handlePanelTouchMove}
                    onTouchEnd={handlePanelTouchEnd}
                    onTouchCancel={handlePanelTouchEnd}
                >
                    <div
                        className="rounded-t-3xl shadow-2xl p-4 sm:p-6 max-h-[80dvh] overflow-auto"
                        style={{
                            backgroundColor: "var(--surface)",
                            borderColor: "var(--line)",
                            borderWidth: "1px",
                            borderBottomWidth: "0px",
                        }}
                    >
                        {/* Handle bar */}
                        <div className="flex justify-center mb-2">
                            <div className="w-12 h-1 rounded-full" style={{ backgroundColor: "var(--line)" }}></div>
                        </div>

                        {/* Form header */}
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold">{REPORT_ACTION_CONFIG[selectedAction].label}</h3>
                            <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                                Swipe down to close
                            </span>
                        </div>

                        {/* Description */}
                        <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
                            {REPORT_ACTION_CONFIG[selectedAction].description}
                        </p>

                        {/* Fullness selector */}
                        <form onSubmit={handleReportSubmit} className="space-y-4">
                            <div>
                                <label
                                    className="text-xs font-semibold uppercase tracking-[0.14em]"
                                    style={{ color: "var(--muted)" }}
                                >
                                    Fullness Level
                                </label>
                                <div className="mt-3 grid grid-cols-5 gap-2">
                                    {[1, 2, 3, 4, 5].map((level) => {
                                        const isSelected = fullnessLevel === level;
                                        const styleSet = FULLNESS_BUTTON_STYLES[level];

                                        return (
                                            <button
                                                key={level}
                                                type="button"
                                                onClick={() => setFullnessLevel(level)}
                                                className={`rounded-lg border px-2 py-3 text-center transition ${
                                                    isSelected ? styleSet.selected : styleSet.idle
                                                }`}
                                                aria-label={`Select fullness level ${level}`}
                                            >
                                                <span className="flex justify-center text-lg mb-1">
                                                    <FullnessIcon level={level} selected={isSelected} />
                                                </span>
                                                <span className="text-xs font-semibold">{level}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                {fullnessLevel && (
                                    <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                                        {FULLNESS_DESCRIPTIONS[fullnessLevel]}
                                    </p>
                                )}
                            </div>

                            {reportFeedback && (
                                <p
                                    className="text-xs font-medium"
                                    style={{ color: reportFeedback.includes("saved") ? "var(--foreground)" : "#ef4444" }}
                                >
                                    {reportFeedback}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={!canSubmitReport}
                                className="w-full rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:from-sky-500 hover:to-cyan-500 disabled:cursor-not-allowed disabled:from-slate-400 disabled:to-slate-400 disabled:shadow-none"
                            >
                                {isSubmittingReport ? "Submitting..." : "Submit"}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Floating action buttons (bottom right) - always visible */}
            {isAuthReady && session ? (
                <div className="fixed bottom-6 sm:bottom-6 right-4 sm:right-6 z-10 flex flex-col gap-3 sm:gap-3">
                    {!selectedAction && (
                        <>
                            {(Object.keys(REPORT_ACTION_CONFIG) as ReportActionType[]).map((actionType) => {
                                const isDisabled = isActionDisabledForParkState(actionType, isUserParkedToday);

                                let bgColor = "#22c55e"; // default green
                                if (actionType === "parked")
                                    bgColor = "#22c55e"; // green for parked
                                else if (actionType === "leaving")
                                    bgColor = "#f97316"; // orange for leaving
                                else if (actionType === "observing") bgColor = "#0ea5e9"; // blue for observing

                                return (
                                    <button
                                        key={actionType}
                                        onClick={() => !isDisabled && setSelectedAction(actionType)}
                                        disabled={isDisabled}
                                        className="flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1.5 sm:gap-2.5 px-4 sm:px-5 py-3.5 sm:py-3 rounded-2xl sm:rounded-full font-semibold text-xs sm:text-sm shadow-xl hover:shadow-2xl transition"
                                        style={{
                                            backgroundColor: isDisabled ? "#666" : bgColor,
                                            color: "white",
                                            opacity: isDisabled ? 0.4 : 1,
                                            cursor: isDisabled ? "not-allowed" : "pointer",
                                            border: "2px solid white",
                                            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                                        }}
                                        title={REPORT_ACTION_CONFIG[actionType].label}
                                    >
                                        <span className="text-2xl sm:text-2xl flex-shrink-0">
                                            <ActionIcon actionType={actionType} />
                                        </span>
                                        <span className="text-xs sm:text-sm font-bold leading-tight">
                                            {REPORT_ACTION_CONFIG[actionType].label}
                                        </span>
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>
            ) : null}

            {/* Latest update card - top, swipe left/right/up to dismiss */}
            {isAuthReady && visibleLatestReport ? (
                <div className="absolute left-0 right-0 top-16 z-20 px-3 sm:top-20 sm:px-4">
                    <div
                        className="mx-auto w-full max-w-sm rounded-2xl border p-3 shadow-lg sm:p-4"
                        style={{
                            backgroundColor: "var(--surface)",
                            borderColor: "var(--line)",
                            transform: `translate3d(${latestCardSwipeOffsetX}px, ${latestCardSwipeOffsetY}px, 0)`,
                            opacity: Math.max(
                                0.28,
                                1 -
                                    Math.max(Math.abs(latestCardSwipeOffsetX), Math.abs(Math.min(0, latestCardSwipeOffsetY))) /
                                        180,
                            ),
                            transition: isLatestCardDragging ? "none" : "transform 0.16s ease, opacity 0.16s ease",
                            touchAction: "none",
                        }}
                        onTouchStart={handleLatestReportTouchStart}
                        onTouchMove={handleLatestReportTouchMove}
                        onTouchEnd={handleLatestReportTouchEnd}
                        onTouchCancel={handleLatestReportTouchEnd}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-xs font-semibold sm:text-sm" style={{ color: "var(--foreground)" }}>
                                    {formatPublicUpdateText(visibleLatestReport.actionType)}
                                </p>
                                <div className="mt-1 flex items-center gap-2">
                                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                                        {formatUpdateTime(visibleLatestReport.createdAt)}
                                    </span>
                                    <span className="text-xs font-semibold">
                                        {FULLNESS_DESCRIPTIONS[visibleLatestReport.fullnessLevel ?? 3]}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: "var(--muted)" }}>
                            <span>Swipe left, right, or up to dismiss</span>
                            <span>🔥 {heatmapData.features.length} hotspots</span>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* Modals */}
            {showDashboard && (
                <UserDashboard
                    session={session}
                    onSignOut={handleSignOut}
                    isSigningOut={isSigningOut}
                    onSettingsClick={() => setShowSettings(true)}
                    onLeaderboardClick={() => setShowLeaderboard(true)}
                    onClose={() => setShowDashboard(false)}
                />
            )}

            {showSettings && <SettingsModal session={session} onClose={() => setShowSettings(false)} />}

            {showLeaderboard && <LeaderboardModal session={session} onClose={() => setShowLeaderboard(false)} />}

            <style jsx>{`
                @keyframes slideUp {
                    from {
                        transform: translateY(100%);
                    }
                    to {
                        transform: translateY(0);
                    }
                }

                @keyframes jac-user-location-pulse {
                    0% {
                        box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.5);
                    }
                    70% {
                        box-shadow: 0 0 0 14px rgba(37, 99, 235, 0);
                    }
                    100% {
                        box-shadow: 0 0 0 0 rgba(37, 99, 235, 0);
                    }
                }

                :global(.jac-user-location-marker) {
                    width: 18px;
                    height: 18px;
                    border-radius: 999px;
                    border: 2px solid #ffffff;
                    background: #2563eb;
                    animation: jac-user-location-pulse 1.6s ease-out infinite;
                }
            `}</style>
        </section>
    );
}
