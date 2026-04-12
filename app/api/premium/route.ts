import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PREMIUM_MONTH_COST_POINTS = 120;

type ProfileRow = {
    points: number;
    premium_expires_at: string | null;
};

type ParkingStateRow = {
    parked_car_latitude: number;
    parked_car_longitude: number;
    parked_at: string;
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
        return "User";
    }

    const prefix = email.split("@")[0]?.trim();
    return prefix || "User";
};

const getPremiumMonthCostPoints = (): number => {
    const parsed = Number.parseInt(process.env.PREMIUM_MONTH_COST_POINTS ?? "", 10);

    if (Number.isNaN(parsed) || parsed < 1) {
        return DEFAULT_PREMIUM_MONTH_COST_POINTS;
    }

    return parsed;
};

const isPremiumActive = (premiumExpiresAt: string | null): boolean => {
    if (!premiumExpiresAt) {
        return false;
    }

    const expiresMs = Date.parse(premiumExpiresAt);

    if (Number.isNaN(expiresMs)) {
        return false;
    }

    return expiresMs > Date.now();
};

const ensureProfile = async (
    supabase: ReturnType<typeof getSupabaseServerClient>,
    userId: string,
    displayName: string,
): Promise<void> => {
    await supabase.from("profiles").upsert(
        {
            id: userId,
            display_name: displayName,
        },
        {
            onConflict: "id",
            ignoreDuplicates: true,
        },
    );
};

const loadProfile = async (supabase: ReturnType<typeof getSupabaseServerClient>, userId: string): Promise<ProfileRow | null> => {
    const { data, error } = await supabase
        .from("profiles")
        .select("points, premium_expires_at")
        .eq("id", userId)
        .maybeSingle<ProfileRow>();

    if (error) {
        throw error;
    }

    return data;
};

const loadParkingState = async (
    supabase: ReturnType<typeof getSupabaseServerClient>,
    userId: string,
): Promise<ParkingStateRow | null> => {
    const { data, error } = await supabase
        .from("user_parking_state")
        .select("parked_car_latitude, parked_car_longitude, parked_at")
        .eq("user_id", userId)
        .maybeSingle<ParkingStateRow>();

    if (error) {
        throw error;
    }

    return data;
};

const buildPremiumResponse = async (
    supabase: ReturnType<typeof getSupabaseServerClient>,
    userId: string,
    premiumMonthCostPoints: number,
) => {
    const profile = await loadProfile(supabase, userId);

    if (!profile) {
        return {
            points: 0,
            premiumExpiresAt: null,
            isPremium: false,
            premiumMonthCostPoints,
            parkedCarLocation: null,
        };
    }

    const premiumExpiresAt = profile.premium_expires_at;
    const premiumActive = isPremiumActive(premiumExpiresAt);

    let parkedCarLocation: { latitude: number; longitude: number; parkedAt: string } | null = null;

    if (premiumActive) {
        const parkingState = await loadParkingState(supabase, userId);

        if (parkingState) {
            parkedCarLocation = {
                latitude: parkingState.parked_car_latitude,
                longitude: parkingState.parked_car_longitude,
                parkedAt: parkingState.parked_at,
            };
        }
    }

    return {
        points: profile.points ?? 0,
        premiumExpiresAt,
        isPremium: premiumActive,
        premiumMonthCostPoints,
        parkedCarLocation,
    };
};

export async function GET(request: Request) {
    const authToken = parseBearerToken(request);

    if (!authToken) {
        return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
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

        await ensureProfile(supabase, user.id, displayName || getFallbackDisplayName(user.email ?? null));

        const responsePayload = await buildPremiumResponse(supabase, user.id, getPremiumMonthCostPoints());

        return NextResponse.json(responsePayload);
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authToken = parseBearerToken(request);

    if (!authToken) {
        return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    let payload: unknown;

    try {
        payload = await request.json();
    } catch {
        payload = {};
    }

    const requestBody = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
    const requestedMonths = Number.isInteger(requestBody.months) ? Number(requestBody.months) : 1;

    if (requestedMonths < 1 || requestedMonths > 12) {
        return NextResponse.json({ error: "Months must be between 1 and 12." }, { status: 400 });
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

        await ensureProfile(supabase, user.id, displayName || getFallbackDisplayName(user.email ?? null));

        const premiumMonthCostPoints = getPremiumMonthCostPoints();

        const { error: purchaseError } = await supabase.rpc("purchase_premium_months", {
            p_user_id: user.id,
            p_months: requestedMonths,
            p_month_cost_points: premiumMonthCostPoints,
        } satisfies {
            p_user_id: string;
            p_months: number;
            p_month_cost_points: number;
        });

        if (purchaseError) {
            const message = purchaseError.message.toLowerCase();

            if (message.includes("insufficient_points")) {
                return NextResponse.json(
                    {
                        error: "Not enough points to buy premium.",
                    },
                    { status: 409 },
                );
            }

            return NextResponse.json(
                {
                    error: "Unable to purchase premium right now.",
                },
                { status: 500 },
            );
        }

        const responsePayload = await buildPremiumResponse(supabase, user.id, premiumMonthCostPoints);

        return NextResponse.json(responsePayload, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}
