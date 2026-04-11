/**
 * Heatmap utilities for parking intensity visualization
 * 
 * This module provides helper functions for managing parking heatmap data.
 * When users "park" their car, their location will be added to the heatmap
 * to show parking intensity in different areas.
 */

export interface ParkingEvent {
    id: string;
    latitude: number;
    longitude: number;
    timestamp: string;
    intensity: "high" | "medium" | "low"; // Based on lot availability
}

export interface HeatmapDataPoint {
    coordinates: [number, number]; // [longitude, latitude]
    weight: number; // 0-1, representing parking intensity
    timestamp: string;
}

/**
 * Converts parking events into heatmap-friendly data points
 * Weight increases with more recent and more intense reports
 */
export const convertParkingEventsToHeatmapPoints = (events: ParkingEvent[]): HeatmapDataPoint[] => {
    const now = new Date().getTime();
    const DECAY_HOURS = 2; // Data older than 2 hours gradually loses weight
    const DECAY_MS = DECAY_HOURS * 60 * 60 * 1000;

    return events.map((event) => {
        const timeSinceReportMs = now - new Date(event.timestamp).getTime();
        const decayFactor = Math.max(0.1, 1 - timeSinceReportMs / DECAY_MS);

        const intensityWeight = {
            high: 1.0,
            medium: 0.6,
            low: 0.3,
        }[event.intensity];

        return {
            coordinates: [event.longitude, event.latitude],
            weight: intensityWeight * decayFactor,
            timestamp: event.timestamp,
        };
    });
};

/**
 * Aggregates multiple parking events in the same area
 * Useful for clustering nearby parking activity
 */
export const aggregateHeatmapData = (
    points: HeatmapDataPoint[],
    radiusMeters: number = 50,
): HeatmapDataPoint[] => {
    if (points.length === 0) return [];

    const aggregated: HeatmapDataPoint[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < points.length; i++) {
        if (processed.has(i)) continue;

        const point = points[i];
        let totalWeight = point.weight;
        let count = 1;
        const clusterCoords = [point.coordinates[0], point.coordinates[1]];

        // Find nearby points
        for (let j = i + 1; j < points.length; j++) {
            if (processed.has(j)) continue;

            const otherPoint = points[j];
            const distance = haversineDistance(
                point.coordinates[1],
                point.coordinates[0],
                otherPoint.coordinates[1],
                otherPoint.coordinates[0],
            );

            if (distance <= radiusMeters) {
                processed.add(j);
                totalWeight += otherPoint.weight;
                count++;
            }
        }

        processed.add(i);

        // Average the coordinates and weight
        aggregated.push({
            coordinates: clusterCoords as [number, number],
            weight: Math.min(1, totalWeight / count),
            timestamp: point.timestamp,
        });
    }

    return aggregated;
};

/**
 * Haversine formula to calculate distance between two lat/lng points
 * Returns distance in meters
 */
const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
