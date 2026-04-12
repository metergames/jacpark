"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type TouchEvent } from "react";
import { useRouter } from "next/navigation";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Session } from "@supabase/supabase-js";
import mapboxgl from "mapbox-gl";
import useCampusProximity from "../hooks/useCampusProximity";
import { CAMPUS_RADIUS_METERS, type LatLng } from "../lib/geo";
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
const JOHN_ABBOTT_ZOOM = 18;
const LIGHT_STYLE_URL = "mapbox://styles/mapbox/standard";
const BOUNDARY_SOURCE_ID = "parking-boundary-source";
const BOUNDARY_FILL_LAYER_ID = "parking-boundary-fill";
const BOUNDARY_LINE_LAYER_ID = "parking-boundary-line";
const BOUNDARY_GEOJSON_PATH = "/boundaries/jac-parking-boundaries.geojson";
const REPORTS_HEATMAP_SOURCE_ID = "parking-reports-heatmap";
const REPORTS_HEATMAP_LAYER_ID = "parking-reports-heatmap-layer";
const REPORTS_HEATMAP_POINTS_LAYER_ID = "parking-reports-points-layer";
const LATEST_UPDATE_LIMIT = 1;
const FAST_REPORTS_REFRESH_INTERVAL_MS = 10000;
const SLOW_REPORTS_REFRESH_INTERVAL_MS = 90000;
const FAST_REFRESH_DISTANCE_METERS = 2000;
const SWIPE_DISMISS_THRESHOLD_PX = 90;
const USER_LOCATION_MARKER_CLASS_NAME = "jac-user-location-marker";
const SUBMIT_RETRY_BASE_DELAY_MS = 400;
const SUBMIT_RETRY_MAX_ATTEMPTS = 3;

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
        selected: "border-emerald-500 bg-emerald-50 text-emerald-900",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-emerald-400",
    },
    2: {
        selected: "border-lime-500 bg-lime-50 text-lime-900",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-lime-400",
    },
    3: {
        selected: "border-amber-500 bg-amber-50 text-amber-900",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-amber-400",
    },
    4: {
        selected: "border-orange-500 bg-orange-50 text-orange-900",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-orange-400",
    },
    5: {
        selected: "border-rose-500 bg-rose-50 text-rose-900",
        idle: "border-[var(--line)] bg-[var(--surface)] text-[var(--foreground)] hover:border-rose-400",
    },
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
                    fill={filled ? (selected ? "currentColor" : "#334155") : "#cbd5e1"}
                    opacity={filled ? 1 : 0.75}
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
    const latestCardTouchStartXRef = useRef<number | null>(null);
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
    const [latestCardSwipeOffset, setLatestCardSwipeOffset] = useState<number>(0);
    const [isLatestCardDragging, setIsLatestCardDragging] = useState<boolean>(false);
    const [isMapReady, setIsMapReady] = useState<boolean>(false);

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

    // Memoized heatmap data: Filter reports, compute weights, and create GeoJSON
    const heatmapData = useMemo(() => {
        const now = new Date().getTime();
        const DECAY_HOURS = 2; // Data older than 2 hours loses weight
        const DECAY_MS = DECAY_HOURS * 60 * 60 * 1000;
        const AGGREGATION_RADIUS_METERS = 35;

        // Filter reports: must have coordinates and not be optimistic
        const validReports = reports.filter(
            (r) => !r.id.startsWith("optimistic-") && Number.isFinite(r.reporterLatitude) && Number.isFinite(r.reporterLongitude),
        );

        if (validReports.length === 0) {
            return { type: "FeatureCollection" as const, features: [] };
        }

        // Convert to weighted points
        const points: Array<{
            longitude: number;
            latitude: number;
            weight: number;
            timestamp: string;
        }> = validReports.map((report) => {
            const timeSinceReportMs = now - new Date(report.createdAt).getTime();
            const decayFactor = Math.max(0.1, 1 - timeSinceReportMs / DECAY_MS);

            const intensityWeight = report.availability === "full" ? 1.0 : report.availability === "limited" ? 0.6 : 0.3;

            return {
                longitude: report.reporterLongitude,
                latitude: report.reporterLatitude,
                weight: intensityWeight * decayFactor,
                timestamp: report.createdAt,
            };
        });

        // Aggregation: cluster nearby points within radius
        const aggregated: typeof points = [];
        const processed = new Set<number>();

        for (let i = 0; i < points.length; i++) {
            if (processed.has(i)) continue;

            const point = points[i];
            let totalWeight = point.weight;
            let count = 1;

            for (let j = i + 1; j < points.length; j++) {
                if (processed.has(j)) continue;

                const otherPoint = points[j];
                const latDiff = otherPoint.latitude - point.latitude;
                const lngDiff = otherPoint.longitude - point.longitude;
                const distMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000; // rough conversion

                if (distMeters <= AGGREGATION_RADIUS_METERS) {
                    processed.add(j);
                    totalWeight += otherPoint.weight;
                    count++;
                }
            }

            processed.add(i);
            aggregated.push({
                ...point,
                weight: Math.min(1, totalWeight / count),
            });
        }

        // Convert to GeoJSON
        return {
            type: "FeatureCollection" as const,
            features: aggregated.map((pt) => ({
                type: "Feature" as const,
                geometry: {
                    type: "Point" as const,
                    coordinates: [pt.longitude, pt.latitude] as [number, number],
                },
                properties: {
                    weight: pt.weight,
                    timestamp: pt.timestamp,
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
            isNearCampus &&
            !locationError &&
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

        if (locationError) {
            setReportFeedback(locationError);
            return;
        }

        if (!isNearCampus) {
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
            const reporterLocation = await resolveReporterLocation(currentLocation);

            const optimisticReport = buildOptimisticReport(actionToSubmit, fullnessToSubmit, distanceToCampus, reporterLocation);

            setReports((prevReports) => {
                const nonOptimisticReports = prevReports.filter((report) => !report.id.startsWith("optimistic-"));
                return [optimisticReport, ...nonOptimisticReports].slice(0, LATEST_UPDATE_LIMIT);
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
                    LATEST_UPDATE_LIMIT,
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
                    limit: String(LATEST_UPDATE_LIMIT),
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
        setLatestCardSwipeOffset(0);
        setIsLatestCardDragging(false);
        latestCardTouchStartXRef.current = null;

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

        latestCardTouchStartXRef.current = event.touches[0]?.clientX ?? null;
        setIsLatestCardDragging(true);
    };

    const handleLatestReportTouchMove = (event: TouchEvent<HTMLDivElement>): void => {
        if (latestCardTouchStartXRef.current === null) {
            return;
        }

        const currentX = event.touches[0]?.clientX;

        if (typeof currentX !== "number") {
            return;
        }

        const swipeDistance = currentX - latestCardTouchStartXRef.current;
        setLatestCardSwipeOffset(Math.max(0, swipeDistance));
    };

    const handleLatestReportTouchEnd = (): void => {
        setIsLatestCardDragging(false);

        if (latestCardSwipeOffset >= SWIPE_DISMISS_THRESHOLD_PX && visibleLatestReport) {
            setDismissedLatestReportId(visibleLatestReport.id);
        }

        setLatestCardSwipeOffset(0);
        latestCardTouchStartXRef.current = null;
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

        // Add heatmap layer if it doesn't exist
        if (!map.getLayer(REPORTS_HEATMAP_LAYER_ID)) {
            map.addLayer(
                {
                    id: REPORTS_HEATMAP_LAYER_ID,
                    type: "heatmap",
                    source: REPORTS_HEATMAP_SOURCE_ID,
                    paint: {
                        "heatmap-weight": ["coalesce", ["get", "weight"], 0.4],
                        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 16, 2, 20, 2.6],
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
                        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 24, 16, 44, 20, 64],
                        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.65, 16, 0.95, 20, 0.75],
                    },
                },
                BOUNDARY_FILL_LAYER_ID, // Insert before boundary layer
            );
        }

        // Add points layer for sparse data visibility
        if (!map.getLayer(REPORTS_HEATMAP_POINTS_LAYER_ID)) {
            map.addLayer(
                {
                    id: REPORTS_HEATMAP_POINTS_LAYER_ID,
                    type: "circle",
                    source: REPORTS_HEATMAP_SOURCE_ID,
                    paint: {
                        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 6, 20, 8],
                        "circle-color": "#ff6600",
                        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 16, 0.5, 20, 0.6],
                    },
                },
                REPORTS_HEATMAP_LAYER_ID,
            );
        }
    }, [heatmapData, isMapReady]);

    return (
        <section className="relative h-[100dvh] w-screen overflow-hidden">
            {/* Full-screen map */}
            <div ref={mapContainerRef} className="h-full w-full" />

            {/* Top bar: minimal info */}
            <div
                className="absolute top-0 left-0 right-0 z-10 px-4 py-3 sm:py-4 flex items-center justify-between"
                style={{ backgroundColor: "rgba(0,0,0,0.3)", backdropFilter: "blur(8px)" }}
            >
                <div className="flex items-center gap-2">
                    <div className="text-sm sm:text-base font-semibold text-white">{formatDistance(distanceToCampus)}</div>
                    <div className={`text-xs sm:text-sm font-medium ${isNearCampus ? "text-green-400" : "text-amber-400"}`}>
                        {isNearCampus ? "✓ Ready" : "Move closer"}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {session ? (
                        <>
                            <button
                                onClick={() => setShowDashboard(true)}
                                className="px-3 py-1.5 rounded-full text-xs font-semibold text-white transition"
                                style={{ backgroundColor: "rgba(59, 130, 246, 0.4)" }}
                            >
                                👤
                            </button>
                        </>
                    ) : (
                        <div className="text-xs text-gray-300">Sign in to report</div>
                    )}
                </div>
            </div>

            {/* Bottom sheet: report form (only show when action selected) */}
            {selectedAction && (
                <div className="fixed bottom-0 left-0 right-0 z-20 pt-3" style={{ animation: "slideUp 0.3s ease-out" }}>
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
                            <button
                                onClick={() => setSelectedAction(null)}
                                className="text-2xl"
                                style={{ color: "var(--muted)" }}
                            >
                                ✕
                            </button>
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

            {/* Latest update card - top, swipe right to dismiss */}
            {isAuthReady && visibleLatestReport ? (
                <div className="absolute left-0 right-0 top-16 z-20 px-3 sm:top-20 sm:px-4">
                    <div
                        className="mx-auto w-full max-w-sm rounded-2xl border p-3 shadow-lg sm:p-4"
                        style={{
                            backgroundColor: "var(--surface)",
                            borderColor: "var(--line)",
                            transform: `translateX(${latestCardSwipeOffset}px)`,
                            opacity: Math.max(0.32, 1 - latestCardSwipeOffset / 180),
                            transition: isLatestCardDragging ? "none" : "transform 0.16s ease, opacity 0.16s ease",
                            touchAction: "pan-y",
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

                            <button
                                type="button"
                                onClick={() => setDismissedLatestReportId(visibleLatestReport.id)}
                                className="rounded-full px-2 py-1 text-xs font-semibold"
                                style={{ color: "var(--muted)", backgroundColor: "var(--surface-strong)" }}
                                aria-label="Dismiss latest update"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: "var(--muted)" }}>
                            <span>Swipe right to dismiss</span>
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
