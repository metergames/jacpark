"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import mapboxgl from "mapbox-gl";
import useCampusProximity from "../hooks/useCampusProximity";
import { CAMPUS_RADIUS_METERS } from "../lib/geo";
import "mapbox-gl/dist/mapbox-gl.css";

type LngLatTuple = [number, number];

type ParkingAvailability = "open" | "limited" | "full";

type ParkingReport = {
    id: string;
    lotName: string;
    availability: ParkingAvailability;
    note: string;
    distanceToCampusMeters: number;
    createdAt: string;
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
const BOUNDARY_SOURCE_ID = "parking-boundary-source";
const BOUNDARY_FILL_LAYER_ID = "parking-boundary-fill";
const BOUNDARY_LINE_LAYER_ID = "parking-boundary-line";
const BOUNDARY_GEOJSON_PATH = "/boundaries/jac-parking-boundaries.geojson";

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

export default function ParkingMap() {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);

    const [lotName, setLotName] = useState<string>("");
    const [availability, setAvailability] = useState<ParkingAvailability>("limited");
    const [note, setNote] = useState<string>("");
    const [reports, setReports] = useState<ParkingReport[]>([]);
    const [isLoadingReports, setIsLoadingReports] = useState<boolean>(true);
    const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);
    const [boundaryLoadError, setBoundaryLoadError] = useState<string>("");
    const [reportsLoadError, setReportsLoadError] = useState<string>("");
    const [reportFeedback, setReportFeedback] = useState<string>("");

    const { isNearCampus, distanceToCampus, locationError } = useCampusProximity();

    const canSubmitReport = useMemo(
        () => isNearCampus && !locationError && !isSubmittingReport,
        [isNearCampus, locationError, isSubmittingReport],
    );

    const handleReportSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        setReportFeedback("");

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

        const normalizedLotName = lotName.trim();
        if (!normalizedLotName) {
            setReportFeedback("Please enter a lot name.");
            return;
        }

        setIsSubmittingReport(true);

        try {
            const position = await getCurrentPosition();

            const response = await fetch("/api/reports", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    lotName: normalizedLotName,
                    availability,
                    note: note.trim(),
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
            setLotName("");
            setAvailability("limited");
            setNote("");
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

        const handleMapLoad = (): void => {
            const loadHardcodedBoundary = async (): Promise<void> => {
                try {
                    const boundaryResponse = await fetch(BOUNDARY_GEOJSON_PATH, {
                        method: "GET",
                        cache: "no-store",
                    });

                    if (!boundaryResponse.ok) {
                        throw new Error("Boundary file missing.");
                    }

                    const boundaryData = (await boundaryResponse.json()) as BoundaryFeatureCollection;

                    if (!isActive) {
                        return;
                    }

                    if (!map.getSource(BOUNDARY_SOURCE_ID)) {
                        map.addSource(BOUNDARY_SOURCE_ID, {
                            type: "geojson",
                            data: boundaryData,
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

                    setBoundaryLoadError("");
                } catch {
                    if (isActive) {
                        setBoundaryLoadError("Unable to load hardcoded boundary file.");
                    }
                }
            };

            void loadHardcodedBoundary();
        };

        map.on("load", handleMapLoad);

        return () => {
            isActive = false;
            map.off("load", handleMapLoad);
            map.remove();
            mapRef.current = null;
        };
    }, []);

    return (
        <section className="relative h-[100dvh] w-screen overflow-hidden">
            <div ref={mapContainerRef} className="h-full w-full" />

            <aside className="absolute left-3 top-3 z-10 max-h-[calc(100dvh-1.5rem)] w-[min(380px,calc(100vw-1.5rem))] overflow-auto rounded-2xl border border-slate-300/80 bg-white/92 p-4 shadow-xl backdrop-blur-sm">
                <h2 className="text-lg font-semibold text-slate-900">JACPark Reporting</h2>
                <p className="mt-1 text-xs text-slate-600">
                    Distance to campus center: <span className="font-semibold">{formatDistance(distanceToCampus)}</span>
                </p>
                <p className={`mt-1 text-xs font-medium ${isNearCampus ? "text-emerald-700" : "text-amber-700"}`}>
                    {isNearCampus
                        ? "You are within campus proximity and can report."
                        : `Move within ${CAMPUS_RADIUS_METERS} m to report.`}
                </p>
                {locationError ? <p className="mt-1 text-xs font-medium text-red-700">{locationError}</p> : null}
                {boundaryLoadError ? <p className="mt-1 text-xs font-medium text-red-700">{boundaryLoadError}</p> : null}

                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                    Boundary is hardcoded from <span className="font-semibold">{BOUNDARY_GEOJSON_PATH}</span>. End users cannot
                    edit boundaries in-app.
                </p>

                <form className="mt-4 space-y-3" onSubmit={handleReportSubmit}>
                    <div>
                        <label htmlFor="lotName" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Lot name
                        </label>
                        <input
                            id="lotName"
                            value={lotName}
                            onChange={(event) => setLotName(event.target.value)}
                            placeholder="Example: Arena Lot C"
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500 focus:ring-2"
                        />
                    </div>

                    <div>
                        <label htmlFor="availability" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Availability
                        </label>
                        <select
                            id="availability"
                            value={availability}
                            onChange={(event) => setAvailability(event.target.value as ParkingAvailability)}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500 focus:ring-2"
                        >
                            <option value="open">Open</option>
                            <option value="limited">Limited</option>
                            <option value="full">Full</option>
                        </select>
                    </div>

                    <div>
                        <label htmlFor="note" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Optional note
                        </label>
                        <textarea
                            id="note"
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            placeholder="Short detail about traffic or queue..."
                            rows={2}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500 focus:ring-2"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={!canSubmitReport}
                        className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                        {isSubmittingReport ? "Submitting..." : "Submit report"}
                    </button>
                </form>

                {reportFeedback ? <p className="mt-2 text-xs font-medium text-slate-700">{reportFeedback}</p> : null}

                <div className="mt-5 border-t border-slate-300 pt-4">
                    <h3 className="text-sm font-semibold text-slate-900">Latest reports</h3>
                    {reportsLoadError ? <p className="mt-1 text-xs font-medium text-red-700">{reportsLoadError}</p> : null}
                    {isLoadingReports ? (
                        <p className="mt-1 text-xs text-slate-600">Loading reports...</p>
                    ) : reports.length === 0 ? (
                        <p className="mt-1 text-xs text-slate-600">No reports have been submitted yet.</p>
                    ) : (
                        <ul className="mt-2 space-y-2">
                            {reports.map((report) => (
                                <li key={report.id} className="rounded-lg border border-slate-300 bg-white p-2">
                                    <p className="text-xs font-semibold text-slate-800">{report.lotName}</p>
                                    <p className="text-xs text-slate-600">
                                        {formatAvailabilityLabel(report.availability)} •{" "}
                                        {new Date(report.createdAt).toLocaleTimeString()} •{" "}
                                        {formatDistance(report.distanceToCampusMeters)}
                                    </p>
                                    {report.note ? <p className="mt-1 text-xs text-slate-700">{report.note}</p> : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </aside>
        </section>
    );
}
