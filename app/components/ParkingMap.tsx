"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Session } from "@supabase/supabase-js";
import mapboxgl from "mapbox-gl";
import useCampusProximity from "../hooks/useCampusProximity";
import { CAMPUS_RADIUS_METERS } from "../lib/geo";
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
    userId: string | null;
    reporterName: string;
    reporterPoints: number;
};

type ReportsResponse = {
    reports?: ParkingReport[];
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
const DARK_STYLE_URL = "mapbox://styles/mapbox/dark-v11";
const BOUNDARY_SOURCE_ID = "parking-boundary-source";
const BOUNDARY_FILL_LAYER_ID = "parking-boundary-fill";
const BOUNDARY_LINE_LAYER_ID = "parking-boundary-line";
const BOUNDARY_GEOJSON_PATH = "/boundaries/jac-parking-boundaries.geojson";

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

const getCurrentPosition = (): Promise<{ latitude: number; longitude: number }> =>
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
                timeout: 10000,
                maximumAge: 5000,
            },
        );
    });

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

const formatActionLabel = (actionType: ReportActionType): string => REPORT_ACTION_CONFIG[actionType].label;

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
    const boundaryDataRef = useRef<BoundaryFeatureCollection | null>(null);

    const [session, setSession] = useState<Session | null>(null);
    const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
    const [authFeedback, setAuthFeedback] = useState<string>("");
    const [isStartingGoogleSignIn, setIsStartingGoogleSignIn] = useState<boolean>(false);
    const [isSigningOut, setIsSigningOut] = useState<boolean>(false);
    const [showDashboard, setShowDashboard] = useState<boolean>(false);
    const [showSettings, setShowSettings] = useState<boolean>(false);
    const [showLeaderboard, setShowLeaderboard] = useState<boolean>(false);

    const [selectedAction, setSelectedAction] = useState<ReportActionType | null>(null);
    const [includeFullnessEstimate, setIncludeFullnessEstimate] = useState<boolean>(false);
    const [fullnessLevel, setFullnessLevel] = useState<number>(3);

    const [reports, setReports] = useState<ParkingReport[]>([]);
    const [isLoadingReports, setIsLoadingReports] = useState<boolean>(true);
    const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);
    const [boundaryLoadError, setBoundaryLoadError] = useState<string>("");
    const [reportsLoadError, setReportsLoadError] = useState<string>("");
    const [reportFeedback, setReportFeedback] = useState<string>("");

    const { isNearCampus, distanceToCampus, locationError } = useCampusProximity();

    const sessionDisplayName = useMemo(() => getSessionDisplayName(session), [session]);

    const canSubmitReport = useMemo(
        () => Boolean(session?.access_token) && Boolean(selectedAction) && isNearCampus && !locationError && !isSubmittingReport,
        [session, selectedAction, isNearCampus, locationError, isSubmittingReport],
    );

    const handleGoogleSignIn = async (): Promise<void> => {
        setAuthFeedback("");
        setIsStartingGoogleSignIn(true);

        try {
            const supabase = getSupabaseBrowserClient();
            const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: window.location.origin,
                },
            });

            if (error) {
                setAuthFeedback(error.message || "Google sign-in failed.");
                setIsStartingGoogleSignIn(false);
            }
        } catch {
            setAuthFeedback("Supabase auth is not configured yet.");
            setIsStartingGoogleSignIn(false);
        }
    };

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

        setIsSubmittingReport(true);

        try {
            const position = await getCurrentPosition();

            const response = await fetch("/api/reports", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    actionType: selectedAction,
                    fullnessLevel: includeFullnessEstimate ? fullnessLevel : null,
                    reporterLatitude: position.latitude,
                    reporterLongitude: position.longitude,
                }),
            });

            const payload = (await response.json()) as ReportResponse;

            if (!response.ok || !payload.report) {
                setReportFeedback(payload.error ?? "Unable to submit report right now.");
                return;
            }

            const createdReport = payload.report;
            setReports((prevReports) => [createdReport, ...prevReports].slice(0, 12));
            setReportFeedback("Report submitted and saved.");
        } catch {
            setReportFeedback("Unable to submit report right now.");
        } finally {
            setIsSubmittingReport(false);
        }
    };

    useEffect(() => {
        let isActive = true;

        const loadReports = async (): Promise<void> => {
            setIsLoadingReports(true);
            setReportsLoadError("");

            try {
                const response = await fetch("/api/reports?limit=12", {
                    method: "GET",
                    cache: "no-store",
                });

                const payload = (await response.json()) as ReportsResponse;

                if (!response.ok) {
                    if (isActive) {
                        setReportsLoadError(payload.error ?? "Unable to load reports.");
                    }
                    return;
                }

                if (isActive) {
                    setReports(Array.isArray(payload.reports) ? payload.reports : []);
                }
            } catch {
                if (isActive) {
                    setReportsLoadError("Unable to load reports.");
                }
            } finally {
                if (isActive) {
                    setIsLoadingReports(false);
                }
            }
        };

        void loadReports();

        return () => {
            isActive = false;
        };
    }, []);

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

        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: LIGHT_STYLE_URL,
            center: JOHN_ABBOTT_CENTER,
            zoom: JOHN_ABBOTT_ZOOM,
            attributionControl: false,
        });

        mapRef.current = map;

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

                if (!isActive) {
                    return;
                }

                // Add source if it doesn't exist
                if (!map.getSource(BOUNDARY_SOURCE_ID)) {
                    map.addSource(BOUNDARY_SOURCE_ID, {
                        type: "geojson",
                        data: boundaryDataRef.current,
                    });
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
            void addBoundaryLayers();
        };

        map.on("load", handleMapLoad);

        return () => {
            isActive = false;
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

        // Determine effective theme based on current HTML class
        const isDarkTheme = document.documentElement.classList.contains("dark");
        const newStyle = isDarkTheme ? DARK_STYLE_URL : LIGHT_STYLE_URL;

        const map = mapRef.current;

        // Listener for when the new style is loaded
        const handleStyleLoad = async (): Promise<void> => {
            // Re-add boundary layers after style change
            try {
                if (!map.getSource(BOUNDARY_SOURCE_ID) && boundaryDataRef.current) {
                    map.addSource(BOUNDARY_SOURCE_ID, {
                        type: "geojson",
                        data: boundaryDataRef.current,
                    });
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
            } catch {
                // Silently fail if layers can't be re-added
            }
        };

        map.once("style.load", handleStyleLoad);
        map.setStyle(newStyle);

        return () => {
            map.off("style.load", handleStyleLoad);
        };
    }, [theme]);

    return (
        <section className="relative h-[100dvh] w-screen overflow-hidden">
            <div ref={mapContainerRef} className="h-full w-full" />

            <aside className="absolute left-3 top-3 z-10 max-h-[calc(100dvh-1.5rem)] w-[min(380px,calc(100vw-1.5rem))] overflow-auto rounded-2xl shadow-xl p-4 backdrop-blur-sm" style={{
                backgroundColor: "var(--surface)",
                borderColor: "var(--line)",
                borderWidth: "1px",
                color: "var(--foreground)",
            }}>
                <h2 className="text-lg font-semibold">JACPark Reporting</h2>

                <div className="mt-3 rounded-lg p-3" style={{
                    backgroundColor: "var(--surface-strong)",
                    borderColor: "var(--line)",
                    borderWidth: "1px",
                }}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Account</h3>
                    {isAuthReady ? (
                        session ? (
                            <div className="mt-3 space-y-2">
                                <p className="text-xs">
                                    Signed in as <span className="font-semibold">{sessionDisplayName}</span>
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setShowDashboard(!showDashboard)}
                                    className="w-full rounded-lg px-3 py-2 text-xs font-semibold transition"
                                    style={{
                                        backgroundColor: "rgba(59, 130, 246, 0.15)",
                                        borderColor: "rgba(59, 130, 246, 0.3)",
                                        borderWidth: "1px",
                                        color: "#3b82f6",
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.opacity = "0.8"}
                                    onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
                                >
                                    👤 View Profile
                                </button>
                            </div>
                        ) : (
                            <p className="mt-1 text-xs">Sign in with Google to submit reports.</p>
                        )
                    ) : (
                        <p className="mt-1 text-xs">Checking session...</p>
                    )}

                    {authFeedback ? <p className="mt-2 text-xs font-medium text-red-500">{authFeedback}</p> : null}
                </div>

                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    Distance to campus center: <span className="font-semibold" style={{ color: "var(--foreground)" }}>{formatDistance(distanceToCampus)}</span>
                </p>
                <p className={`mt-1 text-xs font-medium ${isNearCampus ? "text-emerald-500" : "text-amber-500"}`}>
                    {isNearCampus
                        ? "You are within campus proximity and can report."
                        : `Move within ${CAMPUS_RADIUS_METERS} m to report.`}
                </p>
                {locationError ? <p className="mt-1 text-xs font-medium text-red-500">{locationError}</p> : null}
                {boundaryLoadError ? <p className="mt-1 text-xs font-medium text-red-500">{boundaryLoadError}</p> : null}

                <form className="mt-4 space-y-3" onSubmit={handleReportSubmit}>
                    <div>
                        <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                            What are you doing?
                        </label>
                        <div className="mt-2 grid grid-cols-1 gap-2">
                            {(Object.keys(REPORT_ACTION_CONFIG) as ReportActionType[]).map((actionType) => {
                                const isSelected = selectedAction === actionType;

                                return (
                                    <button
                                        key={actionType}
                                        type="button"
                                        onClick={() => setSelectedAction(actionType)}
                                        className="rounded-lg px-3 py-2 text-left text-sm font-semibold transition"
                                        style={{
                                            backgroundColor: isSelected ? "rgba(34, 197, 94, 0.15)" : "var(--surface-strong)",
                                            borderColor: isSelected ? "rgba(34, 197, 94, 0.3)" : "var(--line)",
                                            borderWidth: "1px",
                                            color: isSelected ? "#22c55e" : "var(--foreground)",
                                        }}
                                    >
                                        {REPORT_ACTION_CONFIG[actionType].label}
                                    </button>
                                );
                            })}
                        </div>
                        {selectedAction ? (
                            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>{REPORT_ACTION_CONFIG[selectedAction].description}</p>
                        ) : null}
                    </div>

                    <div>
                        <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                            <input
                                type="checkbox"
                                checked={includeFullnessEstimate}
                                onChange={(event) => setIncludeFullnessEstimate(event.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                            />
                            Add fullness estimate (optional)
                        </label>

                        {includeFullnessEstimate ? (
                            <div className="mt-2 rounded-lg p-3" style={{
                                backgroundColor: "var(--surface-strong)",
                                borderColor: "var(--line)",
                                borderWidth: "1px",
                            }}>
                                <input
                                    type="range"
                                    min={1}
                                    max={5}
                                    step={1}
                                    value={fullnessLevel}
                                    onChange={(event) => setFullnessLevel(Number(event.target.value))}
                                    className="w-full accent-sky-600"
                                />

                                <div className="mt-1 flex justify-between text-[10px] font-semibold" style={{ color: "var(--muted)" }}>
                                    <span>1</span>
                                    <span>2</span>
                                    <span>3</span>
                                    <span>4</span>
                                    <span>5</span>
                                </div>

                                <p className="mt-2 text-xs">
                                    <span className="font-semibold">{fullnessLevel}/5:</span>{" "}
                                    {FULLNESS_DESCRIPTIONS[fullnessLevel]}
                                </p>
                            </div>
                        ) : (
                            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>No fullness estimate will be attached to this update.</p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={!canSubmitReport}
                        className="w-full rounded-lg px-3 py-2 text-sm font-semibold text-white transition"
                        style={{
                            backgroundColor: canSubmitReport ? "#0ea5e9" : "var(--surface-strong)",
                            opacity: !canSubmitReport ? 0.5 : 1,
                            cursor: !canSubmitReport ? "not-allowed" : "pointer",
                        }}
                    >
                        {isSubmittingReport ? "Submitting..." : "Submit update"}
                    </button>
                </form>

                {reportFeedback ? <p className="mt-2 text-xs font-medium" style={{ color: "var(--muted)" }}>{reportFeedback}</p> : null}

                <div className="mt-5 pt-4" style={{ borderTopColor: "var(--line)", borderTopWidth: "1px" }}>
                    <h3 className="text-sm font-semibold">Latest updates</h3>
                    {reportsLoadError ? <p className="mt-1 text-xs font-medium text-red-500">{reportsLoadError}</p> : null}
                    {isLoadingReports ? (
                        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>Loading reports...</p>
                    ) : reports.length === 0 ? (
                        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>No reports have been submitted yet.</p>
                    ) : (
                        <ul className="mt-2 space-y-2">
                            {reports.map((report) => (
                                <li key={report.id} className="rounded-lg p-2" style={{
                                    backgroundColor: "var(--surface-strong)",
                                    borderColor: "var(--line)",
                                    borderWidth: "1px",
                                }}>
                                    <p className="text-xs font-semibold">{formatActionLabel(report.actionType)}</p>
                                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                                        {new Date(report.createdAt).toLocaleTimeString()} •{" "}
                                        {formatDistance(report.distanceToCampusMeters)}
                                    </p>
                                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                                        by <span className="font-semibold">{report.reporterName}</span> • {report.reporterPoints}{" "}
                                        pts
                                    </p>
                                    {report.fullnessLevel ? (
                                        <p className="mt-1 text-xs">
                                            Fullness {report.fullnessLevel}/5: {FULLNESS_DESCRIPTIONS[report.fullnessLevel]}
                                        </p>
                                    ) : (
                                        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>No fullness estimate provided.</p>
                                    )}
                                    <p className="mt-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                                        Signal: {formatAvailabilityLabel(report.availability)}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </aside>

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

            {showSettings && (
                <SettingsModal
                    session={session}
                    onClose={() => setShowSettings(false)}
                />
            )}

            {showLeaderboard && (
                <LeaderboardModal
                    session={session}
                    onClose={() => setShowLeaderboard(false)}
                />
            )}
        </section>
    );
}
