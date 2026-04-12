import webpush from "web-push";
import { getSupabaseServerClient } from "./supabaseServer";

type StoredPushSubscription = {
    endpoint: string;
    p256dh_key: string;
    auth_key: string;
};

let isWebPushConfigured = false;

const ensureWebPushConfigured = (): boolean => {
    if (isWebPushConfigured) {
        return true;
    }

    const contactEmail = process.env.WEB_PUSH_CONTACT_EMAIL;
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

    if (!contactEmail || !vapidPublicKey || !vapidPrivateKey) {
        return false;
    }

    webpush.setVapidDetails(`mailto:${contactEmail}`, vapidPublicKey, vapidPrivateKey);
    isWebPushConfigured = true;
    return true;
};

const toWebPushSubscription = (subscription: StoredPushSubscription) => ({
    endpoint: subscription.endpoint,
    keys: {
        p256dh: subscription.p256dh_key,
        auth: subscription.auth_key,
    },
});

export const sendPushNotificationToAll = async (payload: { title: string; body: string; tag?: string }): Promise<void> => {
    if (!ensureWebPushConfigured()) {
        return;
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh_key, auth_key")
        .eq("is_active", true)
        .returns<StoredPushSubscription[]>();

    if (error || !data?.length) {
        return;
    }

    const message = JSON.stringify({
        title: payload.title,
        body: payload.body,
        tag: payload.tag ?? "omnilots-report",
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-192x192.png",
    });

    const staleEndpoints: string[] = [];

    await Promise.all(
        data.map(async (subscription) => {
            try {
                await webpush.sendNotification(toWebPushSubscription(subscription), message);
            } catch (error: unknown) {
                const statusCode =
                    typeof error === "object" && error !== null && "statusCode" in error
                        ? Number((error as { statusCode?: number }).statusCode)
                        : NaN;

                if (statusCode === 404 || statusCode === 410) {
                    staleEndpoints.push(subscription.endpoint);
                }
            }
        }),
    );

    if (staleEndpoints.length > 0) {
        await supabase.from("push_subscriptions").update({ is_active: false }).in("endpoint", staleEndpoints);
    }
};
