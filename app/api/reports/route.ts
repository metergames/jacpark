import { NextResponse } from "next/server";
import { CAMPUS_RADIUS_METERS, haversineDistanceMeters, JOHN_ABBOTT_CENTER, type LatLng } from "../../lib/geo";
import { getSupabaseServerClient } from "../../lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParkingAvailability = "open" | "limited" | "full";
type ReportActionType = "parked" | "leaving" | "observing";

type ParkingReportRow = {
    id: string;
    lot_name: string;
    availability: ParkingAvailability;
    action_type: ReportActionType;
    fullness_level: number | null;
    note: string | null;
    distance_to_campus_meters: number;
    created_at: string;
    user_id: string | null;
    profiles:
        | {
              display_name: string | null;
              points: number | null;
          }
        | Array<{
              display_name: string | null;
              points: number | null;
          }>
        | null;
};

type ApiReport = {
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

const REPORT_COLUMNS =
    "id, lot_name, availability, action_type, fullness_level, note, distance_to_campus_meters, created_at, user_id, profiles(display_name, points)";

const allowedActionTypes: ReadonlySet<ReportActionType> = new Set(["parked", "leaving", "observing"]);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const parseLimit = (value: string | null): number => {
    const parsed = value ? Number.parseInt(value, 10) : 12;

    if (Number.isNaN(parsed)) {
        return 12;
    }

    return Math.min(Math.max(parsed, 1), 50);
};

const deriveAvailabilityFromFullness = (fullnessLevel: number | null): ParkingAvailability => {
    if (fullnessLevel === null) {
        return "limited";
    }

    if (fullnessLevel <= 2) {
        return "open";
    }

    if (fullnessLevel === 3) {
        return "limited";
    }

    return "full";
};

const parseBearerToken = (request: Request): string | null => {
    const authorizationHeader = request.headers.get("authorization");

    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
        return null;
    }

    const token = authorizationHeader.slice("Bearer ".length).trim();

    return token.length > 0 ? token : null;
};

const getFallbackDisplayName = (email: string | null): string => {
    if (!email) {
        return "Unknown user";
    }

    const prefix = email.split("@")[0]?.trim();
    return prefix || "Unknown user";
};

const getProfileFromJoin = (
    profiles:
        | {
              display_name: string | null;
              points: number | null;
          }
        | Array<{
              display_name: string | null;
              points: number | null;
          }>
        | null,
): { display_name: string | null; points: number | null } | null => {
    if (!profiles) {
        return null;
    }

    if (Array.isArray(profiles)) {
        return profiles[0] ?? null;
    }

    return profiles;
};

const toApiReport = (row: ParkingReportRow): ApiReport => {
    const profile = getProfileFromJoin(row.profiles);

    return {
        id: row.id,
        lotName: row.lot_name,
        availability: row.availability,
        actionType: row.action_type,
        fullnessLevel: row.fullness_level,
        note: row.note ?? "",
        distanceToCampusMeters: row.distance_to_campus_meters,
        createdAt: row.created_at,
        userId: row.user_id,
        reporterName: profile?.display_name?.trim() || "Unknown user",
        reporterPoints: profile?.points ?? 0,
    };
};

export async function GET(request: Request) {
    const limit = parseLimit(new URL(request.url).searchParams.get("limit"));

    try {
        const supabase = getSupabaseServerClient();

        const { data, error } = await supabase
            .from("parking_reports")
            .select(REPORT_COLUMNS)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) {
            return NextResponse.json({ error: "Failed to load reports." }, { status: 500 });
        }

        const reports = (data as ParkingReportRow[] | null)?.map(toApiReport) ?? [];

        return NextResponse.json({ reports });
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}

export async function POST(request: Request) {
    let payload: unknown;

    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    if (typeof payload !== "object" || payload === null) {
        return NextResponse.json({ error: "Invalid report payload." }, { status: 400 });
    }

    const reportData = payload as Record<string, unknown>;

    const authToken = parseBearerToken(request);

    if (!authToken) {
        return NextResponse.json({ error: "You must be signed in to submit reports." }, { status: 401 });
    }

    const actionType = reportData.actionType;
    const fullnessLevelValue = reportData.fullnessLevel;
    const reporterLatitude = reportData.reporterLatitude;
    const reporterLongitude = reportData.reporterLongitude;

    if (typeof actionType !== "string" || !allowedActionTypes.has(actionType as ReportActionType)) {
        return NextResponse.json({ error: "Invalid action type." }, { status: 400 });
    }

    const fullnessLevel =
        fullnessLevelValue === null || typeof fullnessLevelValue === "undefined"
            ? null
            : Number.isInteger(fullnessLevelValue)
              ? Number(fullnessLevelValue)
              : NaN;

    if (fullnessLevel !== null && (Number.isNaN(fullnessLevel) || fullnessLevel < 1 || fullnessLevel > 5)) {
        return NextResponse.json({ error: "Fullness level must be an integer from 1 to 5." }, { status: 400 });
    }

    if (!isFiniteNumber(reporterLatitude) || !isFiniteNumber(reporterLongitude)) {
        return NextResponse.json({ error: "Invalid reporter coordinates." }, { status: 400 });
    }

    if (reporterLatitude < -90 || reporterLatitude > 90 || reporterLongitude < -180 || reporterLongitude > 180) {
        return NextResponse.json({ error: "Coordinates are out of range." }, { status: 400 });
    }

    const reporterLocation: LatLng = {
        latitude: reporterLatitude,
        longitude: reporterLongitude,
    };

    const distanceToCampus = haversineDistanceMeters(reporterLocation, JOHN_ABBOTT_CENTER);

    if (distanceToCampus > CAMPUS_RADIUS_METERS) {
        return NextResponse.json(
            {
                error: `Reporting is restricted to users within ${CAMPUS_RADIUS_METERS} meters of campus.`,
            },
            { status: 403 },
        );
    }

    try {
        const supabase = getSupabaseServerClient();

        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser(authToken);

        if (authError || !user) {
            return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
        }

        const displayName =
            typeof user.user_metadata?.full_name === "string"
                ? user.user_metadata.full_name.trim()
                : typeof user.user_metadata?.name === "string"
                  ? user.user_metadata.name.trim()
                  : getFallbackDisplayName(user.email ?? null);

        await supabase.from("profiles").upsert(
            {
                id: user.id,
                display_name: displayName || getFallbackDisplayName(user.email ?? null),
            },
            {
                onConflict: "id",
                ignoreDuplicates: true,
            },
        );

        const { data, error } = await supabase
            .from("parking_reports")
            .insert({
                lot_name: "John Abbott Parking",
                availability: deriveAvailabilityFromFullness(fullnessLevel),
                action_type: actionType,
                fullness_level: fullnessLevel,
                note: "",
                user_id: user.id,
                reporter_latitude: reporterLatitude,
                reporter_longitude: reporterLongitude,
                distance_to_campus_meters: distanceToCampus,
            })
            .select(REPORT_COLUMNS)
            .single();

        if (error || !data) {
            return NextResponse.json({ error: "Failed to save report." }, { status: 500 });
        }

        const report = toApiReport(data as ParkingReportRow);

        return NextResponse.json({ report }, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}
