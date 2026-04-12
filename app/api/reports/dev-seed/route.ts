import { NextResponse } from "next/server";
import { CAMPUS_RADIUS_METERS, haversineDistanceMeters, JOHN_ABBOTT_CENTER, type LatLng } from "../../../lib/geo";
import { getSupabaseServerClient } from "../../../lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParkingAvailability = "open" | "limited" | "full";
type ReportActionType = "parked" | "leaving" | "observing";

type SeedRequestBody = {
    mode?: unknown;
    count?: unknown;
    clearExisting?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    actionType?: unknown;
    fullnessLevel?: unknown;
    createdAt?: unknown;
};

type SeedInsertRow = {
    lot_name: string;
    availability: ParkingAvailability;
    action_type: ReportActionType;
    fullness_level: number;
    note: string;
    reporter_latitude: number;
    reporter_longitude: number;
    distance_to_campus_meters: number;
    created_at: string;
    user_id: null;
};

const REPORTS_RESET_KEY_HEADER = "x-jacpark-reset-key";
const DEFAULT_SEED_COUNT = 120;
const MIN_SEED_COUNT = 10;
const MAX_SEED_COUNT = 320;
const LOT_NAME = "John Abbott Parking";
const MAX_SAMPLE_AGE_MS = 3 * 60 * 60 * 1000;
const MAX_SAMPLE_RADIUS_METERS = Math.round(CAMPUS_RADIUS_METERS * 0.92);
const allowedActionTypes: ReadonlySet<ReportActionType> = new Set(["parked", "leaving", "observing"]);

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const canSeedReports = (request: Request): boolean => {
    const configuredResetKey = process.env.REPORTS_RESET_KEY?.trim();

    if (configuredResetKey) {
        const providedResetKey = request.headers.get(REPORTS_RESET_KEY_HEADER)?.trim();
        return providedResetKey === configuredResetKey;
    }

    return process.env.NODE_ENV !== "production";
};

const toAvailability = (fullnessLevel: number): ParkingAvailability => {
    if (fullnessLevel <= 2) {
        return "open";
    }

    if (fullnessLevel === 3) {
        return "limited";
    }

    return "full";
};

const offsetFromCenter = (center: LatLng, northMeters: number, eastMeters: number): LatLng => {
    const latitude = center.latitude + northMeters / 111320;
    const cosLat = Math.max(0.35, Math.cos((center.latitude * Math.PI) / 180));
    const longitude = center.longitude + eastMeters / (111320 * cosLat);

    return {
        latitude,
        longitude,
    };
};

const randomPointAround = (center: LatLng, maxRadiusMeters: number): LatLng => {
    const distance = Math.sqrt(Math.random()) * maxRadiusMeters;
    const bearing = Math.random() * Math.PI * 2;

    const northMeters = Math.cos(bearing) * distance;
    const eastMeters = Math.sin(bearing) * distance;

    return offsetFromCenter(center, northMeters, eastMeters);
};

const pickActionType = (fullnessLevel: number): ReportActionType => {
    const randomValue = Math.random();

    if (fullnessLevel >= 4) {
        if (randomValue < 0.56) {
            return "parked";
        }

        if (randomValue < 0.72) {
            return "leaving";
        }

        return "observing";
    }

    if (fullnessLevel <= 2) {
        if (randomValue < 0.22) {
            return "parked";
        }

        if (randomValue < 0.52) {
            return "leaving";
        }

        return "observing";
    }

    if (randomValue < 0.34) {
        return "parked";
    }

    if (randomValue < 0.54) {
        return "leaving";
    }

    return "observing";
};

const parseSeedCount = (value: unknown): number => {
    const asNumber = typeof value === "number" ? value : Number.NaN;
    const count = Number.isFinite(asNumber) ? Math.floor(asNumber) : DEFAULT_SEED_COUNT;

    return clampNumber(count, MIN_SEED_COUNT, MAX_SEED_COUNT);
};

const parseActionType = (value: unknown): ReportActionType => {
    if (typeof value === "string" && allowedActionTypes.has(value as ReportActionType)) {
        return value as ReportActionType;
    }

    return "observing";
};

const parseFullnessLevel = (value: unknown): number => {
    const asNumber = typeof value === "number" ? value : Number.NaN;
    const normalized = Number.isFinite(asNumber) ? Math.floor(asNumber) : 3;
    return clampNumber(normalized, 1, 5);
};

const parseCreatedAtIso = (value: unknown): string => {
    if (typeof value === "string") {
        const parsedMs = Date.parse(value);

        if (!Number.isNaN(parsedMs)) {
            return new Date(parsedMs).toISOString();
        }
    }

    return new Date().toISOString();
};

export async function POST(request: Request) {
    if (!canSeedReports(request)) {
        return NextResponse.json(
            {
                error: "Seeding is disabled. Use a non-production environment or configure REPORTS_RESET_KEY.",
            },
            { status: 403 },
        );
    }

    let requestBody: SeedRequestBody = {};

    try {
        requestBody = (await request.json()) as SeedRequestBody;
    } catch {
        requestBody = {};
    }

    const isPointMode = requestBody.mode === "point";

    if (isPointMode) {
        if (!isFiniteNumber(requestBody.latitude) || !isFiniteNumber(requestBody.longitude)) {
            return NextResponse.json({ error: "Invalid point coordinates." }, { status: 400 });
        }

        if (
            requestBody.latitude < -90 ||
            requestBody.latitude > 90 ||
            requestBody.longitude < -180 ||
            requestBody.longitude > 180
        ) {
            return NextResponse.json({ error: "Point coordinates are out of range." }, { status: 400 });
        }

        const sampleLocation: LatLng = {
            latitude: requestBody.latitude,
            longitude: requestBody.longitude,
        };

        const fullnessLevel = parseFullnessLevel(requestBody.fullnessLevel);
        const actionType = parseActionType(requestBody.actionType);
        const createdAt = parseCreatedAtIso(requestBody.createdAt);
        const distanceToCampusMeters = haversineDistanceMeters(sampleLocation, JOHN_ABBOTT_CENTER);

        const row: SeedInsertRow = {
            lot_name: LOT_NAME,
            availability: toAvailability(fullnessLevel),
            action_type: actionType,
            fullness_level: fullnessLevel,
            note: "",
            reporter_latitude: sampleLocation.latitude,
            reporter_longitude: sampleLocation.longitude,
            distance_to_campus_meters: distanceToCampusMeters,
            created_at: createdAt,
            user_id: null,
        };

        try {
            const supabase = getSupabaseServerClient();
            const { data: insertedRows, error: insertError } = await supabase.from("parking_reports").insert([row]).select("id");

            if (insertError) {
                return NextResponse.json({ error: "Failed to insert point sample report." }, { status: 500 });
            }

            return NextResponse.json({
                seededCount: insertedRows?.length ?? 1,
                deletedCount: 0,
            });
        } catch {
            return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
        }
    }

    const seedCount = parseSeedCount(requestBody.count);
    const clearExisting = requestBody.clearExisting === true;

    const clusterTemplates = [
        { center: offsetFromCenter(JOHN_ABBOTT_CENTER, 0, 0), radiusMeters: 55, baseFullness: 4 },
        { center: offsetFromCenter(JOHN_ABBOTT_CENTER, 90, 65), radiusMeters: 38, baseFullness: 3 },
        { center: offsetFromCenter(JOHN_ABBOTT_CENTER, -95, 40), radiusMeters: 42, baseFullness: 2 },
        { center: offsetFromCenter(JOHN_ABBOTT_CENTER, 60, -70), radiusMeters: 36, baseFullness: 4 },
        { center: offsetFromCenter(JOHN_ABBOTT_CENTER, -45, -85), radiusMeters: 34, baseFullness: 2 },
    ];

    const rows: SeedInsertRow[] = [];

    for (let index = 0; index < seedCount; index += 1) {
        const cluster = clusterTemplates[index % clusterTemplates.length];
        const samplePoint = randomPointAround(cluster.center, cluster.radiusMeters);
        const distanceToCampusMeters = haversineDistanceMeters(samplePoint, JOHN_ABBOTT_CENTER);

        if (distanceToCampusMeters > MAX_SAMPLE_RADIUS_METERS) {
            continue;
        }

        const jitter = Math.round((Math.random() - 0.5) * 2);
        const fullnessLevel = clampNumber(cluster.baseFullness + jitter, 1, 5);

        const ageMs = Math.floor(Math.pow(Math.random(), 1.35) * MAX_SAMPLE_AGE_MS);
        const createdAt = new Date(Date.now() - ageMs).toISOString();

        rows.push({
            lot_name: LOT_NAME,
            availability: toAvailability(fullnessLevel),
            action_type: pickActionType(fullnessLevel),
            fullness_level: fullnessLevel,
            note: "",
            reporter_latitude: samplePoint.latitude,
            reporter_longitude: samplePoint.longitude,
            distance_to_campus_meters: distanceToCampusMeters,
            created_at: createdAt,
            user_id: null,
        });
    }

    if (rows.length === 0) {
        return NextResponse.json({ error: "No valid sample reports were generated." }, { status: 500 });
    }

    try {
        const supabase = getSupabaseServerClient();

        let deletedCount = 0;

        if (clearExisting) {
            const { data: deletedRows, error: clearError } = await supabase
                .from("parking_reports")
                .delete()
                .gte("created_at", "1970-01-01T00:00:00.000Z")
                .select("id");

            if (clearError) {
                return NextResponse.json({ error: "Failed to clear existing reports before seeding." }, { status: 500 });
            }

            deletedCount = deletedRows?.length ?? 0;
        }

        const { data: insertedRows, error: insertError } = await supabase.from("parking_reports").insert(rows).select("id");

        if (insertError) {
            return NextResponse.json({ error: "Failed to insert sample reports." }, { status: 500 });
        }

        return NextResponse.json({
            seededCount: insertedRows?.length ?? rows.length,
            deletedCount,
        });
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}
