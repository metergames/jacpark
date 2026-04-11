import { NextResponse } from "next/server";
import { CAMPUS_RADIUS_METERS, haversineDistanceMeters, JOHN_ABBOTT_CENTER, type LatLng } from "../../lib/geo";
import { getSupabaseServerClient } from "../../lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParkingAvailability = "open" | "limited" | "full";

type ParkingReportRow = {
    id: string;
    lot_name: string;
    availability: ParkingAvailability;
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
    note: string;
    distanceToCampusMeters: number;
    createdAt: string;
    userId: string | null;
    reporterName: string;
    reporterPoints: number;
};

const REPORT_COLUMNS =
    "id, lot_name, availability, note, distance_to_campus_meters, created_at, user_id, profiles(display_name, points)";

const allowedAvailability: ReadonlySet<ParkingAvailability> = new Set(["open", "limited", "full"]);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const parseLimit = (value: string | null): number => {
    const parsed = value ? Number.parseInt(value, 10) : 12;

    if (Number.isNaN(parsed)) {
        return 12;
    }

    return Math.min(Math.max(parsed, 1), 50);
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

    const lotName = typeof reportData.lotName === "string" ? reportData.lotName.trim() : "";
    const availability = reportData.availability;
    const note = typeof reportData.note === "string" ? reportData.note.trim().slice(0, 500) : "";
    const reporterLatitude = reportData.reporterLatitude;
    const reporterLongitude = reportData.reporterLongitude;

    if (lotName.length < 2 || lotName.length > 120) {
        return NextResponse.json({ error: "Lot name must be between 2 and 120 characters." }, { status: 400 });
    }

    if (typeof availability !== "string" || !allowedAvailability.has(availability as ParkingAvailability)) {
        return NextResponse.json({ error: "Invalid availability value." }, { status: 400 });
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
                lot_name: lotName,
                availability,
                note,
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
