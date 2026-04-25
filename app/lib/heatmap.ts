import type { Feature, FeatureCollection, Point } from "geojson";
import type mapboxgl from "mapbox-gl";

export type HeatmapTier = "free" | "premium";

export type HeatmapReport = {
    id: string;
    availability: "open" | "limited" | "full";
    actionType: "parked" | "leaving" | "observing";
    fullnessLevel: number | null;
    createdAt: string;
    reporterLatitude: number;
    reporterLongitude: number;
};

export const HEATMAP_HALFLIFE_MS = 45 * 60 * 1000;
export const HEATMAP_MAX_AGE_MS = 3 * 60 * 60 * 1000;
export const HEATMAP_FANOUT_RADIUS_METERS = 25;
export const HEATMAP_FANOUT_POINT_COUNT = 6;
export const HEATMAP_WEIGHT_FLOOR = 0.05;

const METERS_PER_DEGREE_LAT = 111320;

const FULLNESS_TO_SEVERITY: Record<number, number> = {
    1: 0.0,
    2: 0.15,
    3: 0.45,
    4: 0.75,
    5: 1.0,
};

const AVAILABILITY_TO_SEVERITY: Record<HeatmapReport["availability"], number> = {
    open: 0.0,
    limited: 0.5,
    full: 1.0,
};

const ACTION_MULTIPLIER: Record<HeatmapReport["actionType"], number> = {
    parked: 1.0,
    observing: 0.85,
    leaving: 0.7,
};

export const severityFromReport = (report: HeatmapReport): number => {
    if (
        report.fullnessLevel !== null &&
        Number.isInteger(report.fullnessLevel) &&
        report.fullnessLevel in FULLNESS_TO_SEVERITY
    ) {
        return FULLNESS_TO_SEVERITY[report.fullnessLevel];
    }
    return AVAILABILITY_TO_SEVERITY[report.availability] ?? 0;
};

export const decayWeight = (
    severity: number,
    actionType: HeatmapReport["actionType"],
    ageMs: number,
): number => {
    if (ageMs > HEATMAP_MAX_AGE_MS) return 0;
    const actionMul = ACTION_MULTIPLIER[actionType] ?? 0;
    if (actionMul <= 0 || severity <= 0) return 0;
    const freshness = Math.exp(-Math.max(0, ageMs) / HEATMAP_HALFLIFE_MS);
    return severity * actionMul * freshness;
};

export const fanOutPoints = (
    lon: number,
    lat: number,
    radiusMeters: number,
    pointCount: number,
): Array<[number, number]> => {
    const points: Array<[number, number]> = [[lon, lat]];
    if (pointCount <= 0 || radiusMeters <= 0) return points;
    const cosLat = Math.max(0.35, Math.cos((lat * Math.PI) / 180));
    const dLat = radiusMeters / METERS_PER_DEGREE_LAT;
    const dLon = radiusMeters / (METERS_PER_DEGREE_LAT * cosLat);
    for (let i = 0; i < pointCount; i += 1) {
        const angle = (i / pointCount) * Math.PI * 2;
        points.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)]);
    }
    return points;
};

export type HeatmapFeatureProps = { weight: number };

export const buildHeatmapFeatures = (
    reports: HeatmapReport[],
    nowMs: number,
): FeatureCollection<Point, HeatmapFeatureProps> => {
    const features: Feature<Point, HeatmapFeatureProps>[] = [];

    for (const report of reports) {
        if (
            !Number.isFinite(report.reporterLatitude) ||
            !Number.isFinite(report.reporterLongitude)
        ) {
            continue;
        }

        const ts = Date.parse(report.createdAt);
        if (Number.isNaN(ts)) continue;

        const ageMs = Math.max(0, nowMs - ts);
        const severity = severityFromReport(report);
        const weight = decayWeight(severity, report.actionType, ageMs);

        if (weight < HEATMAP_WEIGHT_FLOOR) continue;

        const fan = fanOutPoints(
            report.reporterLongitude,
            report.reporterLatitude,
            HEATMAP_FANOUT_RADIUS_METERS,
            HEATMAP_FANOUT_POINT_COUNT,
        );

        for (const [lon, lat] of fan) {
            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [lon, lat] },
                properties: { weight },
            });
        }
    }

    return { type: "FeatureCollection", features };
};

type HeatmapPaint = NonNullable<mapboxgl.HeatmapLayer["paint"]>;

// Free tier: only red/orange "danger zones" visible. Anything below 0.4 density is transparent.
const FREE_HEATMAP_COLOR: HeatmapPaint["heatmap-color"] = [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    "rgba(0, 0, 0, 0)",
    0.4,
    "rgba(0, 0, 0, 0)",
    0.6,
    "rgba(245, 140, 60, 0.55)",
    1.0,
    "rgba(220, 60, 50, 0.85)",
];

// Premium tier: full amber → orange → red → dark-red gradient.
const PREMIUM_HEATMAP_COLOR: HeatmapPaint["heatmap-color"] = [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    "rgba(0, 0, 0, 0)",
    0.15,
    "rgba(255, 220, 120, 0.55)",
    0.45,
    "rgba(245, 140, 60, 0.85)",
    0.80,
    "rgba(220, 60, 50, 0.95)",
    1.0,
    "rgba(150, 20, 35, 1.0)",
];

export const buildHeatmapPaint = (tier: HeatmapTier): HeatmapPaint => ({
    "heatmap-weight": ["coalesce", ["get", "weight"], 0],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 12, 1.0, 16, 1.4, 19, 1.8],
    "heatmap-radius": ["interpolate", ["exponential", 1.5], ["zoom"], 12, 24, 16, 55, 19, 110],
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.65, 16, 0.85, 19, 0.85],
    "heatmap-color": tier === "premium" ? PREMIUM_HEATMAP_COLOR : FREE_HEATMAP_COLOR,
});
