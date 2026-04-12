import { NextResponse } from "next/server";
import { CAMPUS_RADIUS_METERS, haversineDistanceMeters, JOHN_ABBOTT_CENTER, type LatLng } from "../../lib/geo";
import { getSupabaseServerClient } from "../../lib/supabaseServer";
import { sendPushNotificationToAll } from "../../lib/webPushServer";

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
    reporter_latitude: number;
    reporter_longitude: number;
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
    reporterLatitude: number;
    reporterLongitude: number;
};

type ViewerParkingState = {
    latestActionType: "parked" | "leaving" | null;
    latestActionAt: string | null;
    isParkedToday: boolean;
};

const REPORT_COLUMNS =
    "id, lot_name, availability, action_type, fullness_level, note, distance_to_campus_meters, created_at, user_id, reporter_latitude, reporter_longitude";
const REPORTS_RESET_KEY_HEADER = "x-jacpark-reset-key";

const allowedActionTypes: ReadonlySet<ReportActionType> = new Set(["parked", "leaving", "observing"]);
const OBSERVING_COOLDOWN_MS = 60 * 60 * 1000;

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const parseLimit = (value: string | null): number => {
    const parsed = value ? Number.parseInt(value, 10) : 12;

    if (Number.isNaN(parsed)) {
        return 12;
    }

    return Math.min(Math.max(parsed, 1), 150);
};

const parseSince = (value: string | null): Date => {
    if (!value) {
        const fallback = new Date();
        fallback.setHours(0, 0, 0, 0);
        return fallback;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        const fallback = new Date();
        fallback.setHours(0, 0, 0, 0);
        return fallback;
    }

    return parsed;
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

const toApiReport = (row: ParkingReportRow): ApiReport => {
    return {
        id: row.id,
        lotName: row.lot_name,
        availability: row.availability,
        actionType: row.action_type,
        fullnessLevel: row.fullness_level,
        note: row.note ?? "",
        distanceToCampusMeters: row.distance_to_campus_meters,
        createdAt: row.created_at,
        reporterLatitude: row.reporter_latitude,
        reporterLongitude: row.reporter_longitude,
    };
};

const canResetReports = (request: Request): boolean => {
    const configuredResetKey = process.env.REPORTS_RESET_KEY?.trim();

    if (configuredResetKey) {
        const providedResetKey = request.headers.get(REPORTS_RESET_KEY_HEADER)?.trim();
        return providedResetKey === configuredResetKey;
    }

    return process.env.NODE_ENV !== "production";
};

export async function GET(request: Request) {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const since = parseSince(url.searchParams.get("since"));
    const sinceIso = since.toISOString();
    const authToken = parseBearerToken(request);

    try {
        const supabase = getSupabaseServerClient();

        const { data, error } = await supabase
            .from("parking_reports")
            .select(REPORT_COLUMNS)
            .gte("created_at", sinceIso)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) {
            return NextResponse.json({ error: "Failed to load reports." }, { status: 500 });
        }

        const reports = (data as ParkingReportRow[] | null)?.map(toApiReport) ?? [];

        let viewerParkingState: ViewerParkingState | null = null;

        if (authToken) {
            const {
                data: { user },
                error: authError,
            } = await supabase.auth.getUser(authToken);

            if (!authError && user) {
                const { data: latestStateData, error: latestStateError } = await supabase
                    .from("parking_reports")
                    .select("action_type, created_at")
                    .eq("user_id", user.id)
                    .in("action_type", ["parked", "leaving"])
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle<{ action_type: "parked" | "leaving"; created_at: string }>();

                if (!latestStateError) {
                    const latestActionType = latestStateData?.action_type ?? null;
                    const latestActionAt = latestStateData?.created_at ?? null;
                    const latestActionMs = latestActionAt ? Date.parse(latestActionAt) : NaN;

                    viewerParkingState = {
                        latestActionType,
                        latestActionAt,
                        isParkedToday:
                            latestActionType === "parked" && !Number.isNaN(latestActionMs) && latestActionMs >= since.getTime(),
                    };
                }
            }
        }

        return NextResponse.json({ reports, viewerParkingState });
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

    const actionTypeValue = reportData.actionType;
    const fullnessLevelValue = reportData.fullnessLevel;
    const reporterLatitudeValue = reportData.reporterLatitude;
    const reporterLongitudeValue = reportData.reporterLongitude;

    if (typeof actionTypeValue !== "string" || !allowedActionTypes.has(actionTypeValue as ReportActionType)) {
        return NextResponse.json({ error: "Invalid action type." }, { status: 400 });
    }

    const actionType = actionTypeValue as ReportActionType;

    const fullnessLevel = Number.isInteger(fullnessLevelValue) ? Number(fullnessLevelValue) : NaN;

    if (Number.isNaN(fullnessLevel) || fullnessLevel < 1 || fullnessLevel > 5) {
        return NextResponse.json({ error: "Fullness level must be an integer from 1 to 5." }, { status: 400 });
    }

    const hasSuppliedCoordinates =
        isFiniteNumber(reporterLatitudeValue) &&
        isFiniteNumber(reporterLongitudeValue) &&
        reporterLatitudeValue >= -90 &&
        reporterLatitudeValue <= 90 &&
        reporterLongitudeValue >= -180 &&
        reporterLongitudeValue <= 180;

    if (actionType !== "leaving" && !hasSuppliedCoordinates) {
        return NextResponse.json({ error: "Invalid reporter coordinates." }, { status: 400 });
    }

    const suppliedReporterLocation: LatLng | null = hasSuppliedCoordinates
        ? {
              latitude: reporterLatitudeValue,
              longitude: reporterLongitudeValue,
          }
        : null;

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

        const { data: latestStateData, error: latestStateError } = await supabase
            .from("parking_reports")
            .select("action_type")
            .eq("user_id", user.id)
            .in("action_type", ["parked", "leaving"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle<{ action_type: "parked" | "leaving" }>();

        if (latestStateError) {
            return NextResponse.json({ error: "Failed to validate report state." }, { status: 500 });
        }

        const latestStateAction = latestStateData?.action_type ?? null;

        if (actionType === "parked" && latestStateAction === "parked") {
            return NextResponse.json(
                {
                    error: "You are already marked as parked. Submit a leaving update before parking again.",
                },
                { status: 409 },
            );
        }

        if (actionType === "leaving" && latestStateAction !== "parked") {
            return NextResponse.json(
                {
                    error: "You can only submit leaving after you have submitted a parked update.",
                },
                { status: 409 },
            );
        }

        let reporterLocation: LatLng;

        if (actionType === "leaving") {
            const { data: latestParkedData, error: latestParkedError } = await supabase
                .from("parking_reports")
                .select("reporter_latitude, reporter_longitude")
                .eq("user_id", user.id)
                .eq("action_type", "parked")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle<{ reporter_latitude: number; reporter_longitude: number }>();

            if (latestParkedError) {
                return NextResponse.json({ error: "Failed to load parked location." }, { status: 500 });
            }

            if (!latestParkedData) {
                return NextResponse.json(
                    {
                        error: "No parked location found to close out. Submit a parked update first.",
                    },
                    { status: 409 },
                );
            }

            reporterLocation = {
                latitude: latestParkedData.reporter_latitude,
                longitude: latestParkedData.reporter_longitude,
            };
        } else {
            reporterLocation = suppliedReporterLocation as LatLng;
        }

        const distanceToCampus = haversineDistanceMeters(reporterLocation, JOHN_ABBOTT_CENTER);

        if (actionType !== "leaving" && distanceToCampus > CAMPUS_RADIUS_METERS) {
            return NextResponse.json(
                {
                    error: `Reporting is restricted to users within ${CAMPUS_RADIUS_METERS} meters of campus.`,
                },
                { status: 403 },
            );
        }

        if (actionType === "observing") {
            const { data: latestObservingData, error: latestObservingError } = await supabase
                .from("parking_reports")
                .select("created_at")
                .eq("user_id", user.id)
                .eq("action_type", "observing")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle<{ created_at: string }>();

            if (latestObservingError) {
                return NextResponse.json({ error: "Failed to validate observing cooldown." }, { status: 500 });
            }

            const latestObservingCreatedAt = latestObservingData?.created_at;

            if (latestObservingCreatedAt) {
                const latestObservingMs = Date.parse(latestObservingCreatedAt);

                if (!Number.isNaN(latestObservingMs)) {
                    const elapsedMs = Date.now() - latestObservingMs;

                    if (elapsedMs < OBSERVING_COOLDOWN_MS) {
                        const remainingMinutes = Math.max(1, Math.ceil((OBSERVING_COOLDOWN_MS - elapsedMs) / 60000));
                        return NextResponse.json(
                            {
                                error: `Observing updates are limited to once per hour. Try again in about ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`,
                            },
                            { status: 429 },
                        );
                    }
                }
            }
        }

        const { data, error } = await supabase
            .from("parking_reports")
            .insert({
                lot_name: "John Abbott Parking",
                availability: deriveAvailabilityFromFullness(fullnessLevel),
                action_type: actionType,
                fullness_level: fullnessLevel,
                note: "",
                user_id: user.id,
                reporter_latitude: reporterLocation.latitude,
                reporter_longitude: reporterLocation.longitude,
                distance_to_campus_meters: distanceToCampus,
            })
            .select(REPORT_COLUMNS)
            .single();

        if (error || !data) {
            const message = error?.message?.toLowerCase() ?? "";

            if (message.includes("already marked as parked")) {
                return NextResponse.json(
                    {
                        error: "You are already marked as parked. Submit a leaving update before parking again.",
                    },
                    { status: 409 },
                );
            }

            if (message.includes("leaving requires a prior parked")) {
                return NextResponse.json(
                    {
                        error: "You can only submit leaving after you have submitted a parked update.",
                    },
                    { status: 409 },
                );
            }

            if (message.includes("once per hour")) {
                return NextResponse.json(
                    {
                        error: "Observing updates are limited to once per hour.",
                    },
                    { status: 429 },
                );
            }

            return NextResponse.json({ error: "Failed to save report." }, { status: 500 });
        }

        const report = toApiReport(data as ParkingReportRow);

        if (actionType === "parked") {
            const { error: parkingStateError } = await supabase.from("user_parking_state").upsert(
                {
                    user_id: user.id,
                    parked_car_latitude: report.reporterLatitude,
                    parked_car_longitude: report.reporterLongitude,
                    parked_at: report.createdAt,
                },
                {
                    onConflict: "user_id",
                },
            );

            if (parkingStateError) {
                console.warn("Unable to persist parked car location:", parkingStateError.message);
            }
        }

        if (actionType === "leaving") {
            const { error: parkingStateError } = await supabase.from("user_parking_state").delete().eq("user_id", user.id);

            if (parkingStateError) {
                console.warn("Unable to clear parked car location:", parkingStateError.message);
            }
        }

        void sendPushNotificationToAll({
            title: "Omnilots",
            body: `New ${actionType} update was posted for parking conditions.`,
            tag: "omnilots-report-update",
        });

        return NextResponse.json({ report }, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    if (!canResetReports(request)) {
        return NextResponse.json(
            {
                error: "Report reset is disabled. Use a non-production environment or configure REPORTS_RESET_KEY.",
            },
            { status: 403 },
        );
    }

    try {
        const supabase = getSupabaseServerClient();

        const { data, error } = await supabase
            .from("parking_reports")
            .delete()
            .gte("created_at", "1970-01-01T00:00:00.000Z")
            .select("id");

        if (error) {
            return NextResponse.json({ error: "Failed to clear reports." }, { status: 500 });
        }

        return NextResponse.json({ deletedCount: data?.length ?? 0 });
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}
