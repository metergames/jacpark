import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PREMIUM_MONTH_COST_POINTS = 60;

type ProfileRow = {
    points: number;
    premium_expires_at: string | null;
};

type ParkingStateRow = {
    parked_car_latitude: number;
    parked_car_longitude: number;
    parked_at: string;
};

type PurchaseFallbackResult = {
    ok: boolean;
    insufficientPoints?: boolean;
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

const isInsufficientPointsError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return normalized.includes("insufficient_points") || normalized.includes("not enough points");
};

const computeExtendedPremiumExpiryIso = (currentExpiry: string | null, months: number): string => {
    const now = new Date();
    const parsedCurrentMs = currentExpiry ? Date.parse(currentExpiry) : Number.NaN;
    const baseDate = !Number.isNaN(parsedCurrentMs) && parsedCurrentMs > now.getTime() ? new Date(parsedCurrentMs) : now;
    const nextDate = new Date(baseDate);

    nextDate.setMonth(nextDate.getMonth() + months);
    return nextDate.toISOString();
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

const purchasePremiumWithFallback = async (
    supabase: ReturnType<typeof getSupabaseServerClient>,
    userId: string,
    requestedMonths: number,
    premiumMonthCostPoints: number,
): Promise<PurchaseFallbackResult> => {
    const totalCost = requestedMonths * premiumMonthCostPoints;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const profile = await loadProfile(supabase, userId);

        if (!profile) {
            return { ok: false };
        }

        const currentPoints = Number.isFinite(profile.points) ? Number(profile.points) : 0;

        if (currentPoints < totalCost) {
            return { ok: false, insufficientPoints: true };
        }

        const nextPremiumExpiryIso = computeExtendedPremiumExpiryIso(profile.premium_expires_at, requestedMonths);

        const { data, error } = await supabase
            .from("profiles")
            .update({
                points: currentPoints - totalCost,
                premium_expires_at: nextPremiumExpiryIso,
            })
            .eq("id", userId)
            .eq("points", currentPoints)
            .select("id")
            .maybeSingle<{ id: string }>();

        if (error) {
            throw error;
        }

        if (data?.id) {
            return { ok: true };
        }
    }

    return { ok: false };
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

        let purchaseCompleted = false;

        const { error: purchaseError } = await supabase.rpc("purchase_premium_months", {
            p_user_id: user.id,
            p_months: requestedMonths,
            p_month_cost_points: premiumMonthCostPoints,
        } satisfies {
            p_user_id: string;
            p_months: number;
            p_month_cost_points: number;
        });

        if (!purchaseError) {
            purchaseCompleted = true;
        } else {
            const message = purchaseError.message.toLowerCase();

            if (isInsufficientPointsError(message)) {
                return NextResponse.json(
                    {
                        error: "Not enough points to buy premium.",
                    },
                    { status: 409 },
                );
            }

            try {
                const fallbackResult = await purchasePremiumWithFallback(
                    supabase,
                    user.id,
                    requestedMonths,
                    premiumMonthCostPoints,
                );

                if (fallbackResult.insufficientPoints) {
                    return NextResponse.json(
                        {
                            error: "Not enough points to buy premium.",
                        },
                        { status: 409 },
                    );
                }

                purchaseCompleted = fallbackResult.ok;
            } catch {
                purchaseCompleted = false;
            }

            if (!purchaseCompleted) {
                return NextResponse.json(
                    {
                        error: "Unable to purchase premium right now. Run the Supabase repair SQL and retry.",
                    },
                    { status: 500 },
                );
            }
        }

        const responsePayload = await buildPremiumResponse(supabase, user.id, premiumMonthCostPoints);

        return NextResponse.json(responsePayload, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}
