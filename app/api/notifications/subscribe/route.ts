import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../../lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PushSubscriptionPayload = {
    endpoint?: string;
    expirationTime?: number | null;
    keys?: {
        p256dh?: string;
        auth?: string;
    };
};

const parseBearerToken = (request: Request): string | null => {
    const authorizationHeader = request.headers.get("authorization");

    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
        return null;
    }

    const token = authorizationHeader.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
};

export async function POST(request: Request) {
    const authToken = parseBearerToken(request);

    if (!authToken) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    let payload: PushSubscriptionPayload;

    try {
        payload = (await request.json()) as PushSubscriptionPayload;
    } catch {
        return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const endpoint = payload.endpoint;
    const p256dh = payload.keys?.p256dh;
    const auth = payload.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
        return NextResponse.json({ error: "Invalid subscription payload." }, { status: 400 });
    }

    try {
        const supabase = getSupabaseServerClient();
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser(authToken);

        if (authError || !user) {
            return NextResponse.json({ error: "Invalid session." }, { status: 401 });
        }

        const { error } = await supabase.from("push_subscriptions").upsert(
            {
                user_id: user.id,
                endpoint,
                p256dh_key: p256dh,
                auth_key: auth,
                is_active: true,
                expiration_time: payload.expirationTime ?? null,
                updated_at: new Date().toISOString(),
            },
            {
                onConflict: "endpoint",
            },
        );

        if (error) {
            return NextResponse.json({ error: "Failed to save subscription." }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const authToken = parseBearerToken(request);

    if (!authToken) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    let payload: PushSubscriptionPayload;

    try {
        payload = (await request.json()) as PushSubscriptionPayload;
    } catch {
        return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    if (!payload.endpoint) {
        return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
    }

    try {
        const supabase = getSupabaseServerClient();
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser(authToken);

        if (authError || !user) {
            return NextResponse.json({ error: "Invalid session." }, { status: 401 });
        }

        const { error } = await supabase
            .from("push_subscriptions")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("endpoint", payload.endpoint)
            .eq("user_id", user.id);

        if (error) {
            return NextResponse.json({ error: "Failed to deactivate subscription." }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }
}
