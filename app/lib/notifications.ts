/**
 * Notification utility for requesting permissions and showing notifications
 * Works with Service Worker for PWA notifications on Android and iOS
 */

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

const getVapidPublicKey = (): string | null => {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return key?.trim() ? key.trim() : null;
};

const base64UrlToUint8Array = (base64UrlString: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
};

/**
 * Register and initialize the service worker
 */
export const initializeServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
    if (!("serviceWorker" in navigator)) {
        console.log("[Notifications] Service Worker not supported");
        return null;
    }

    try {
        const registration = await navigator.serviceWorker.register("/service-worker.js", {
            scope: "/",
            updateViaCache: "none",
        });
        console.log("[Notifications] Service Worker registered:", registration);
        return registration;
    } catch (error) {
        console.error("[Notifications] Service Worker registration failed:", error);
        return null;
    }
};

/**
 * Request notification permission from user
 * Returns the current permission state
 */
export const requestNotificationPermission = async (): Promise<NotificationPermission> => {
  if (!("Notification" in window)) {
    console.log("[Notifications] Notification API not supported");
    return "denied";
  }

  if (Notification.permission !== "default") {
    return Notification.permission;
  }

  try {
    const permission = await Notification.requestPermission();
    console.log("[Notifications] Permission requested, result:", permission);
    return permission;
  } catch (error) {
    console.error("[Notifications] Failed to request permission:", error);
    return "denied";
  }
};

export const subscribeToPushNotifications = async (accessToken: string): Promise<boolean> => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  const vapidPublicKey = getVapidPublicKey();

  if (!vapidPublicKey) {
    console.warn("[Notifications] Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    return false;
  }

  const registration = (await initializeServiceWorker()) ?? (await navigator.serviceWorker.ready);

  if (!registration) {
    return false;
  }

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidPublicKey) as unknown as BufferSource,
    });
  }

  const response = await fetch("/api/notifications/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(subscription),
  });

  return response.ok;
};

/**
 * Show a notification to the user
 * Uses Service Worker if available, falls back to Notification API
 */
export const showNotification = async (options: NotificationOptions): Promise<void> => {
    if (!("Notification" in window)) {
        console.log("[Notifications] Notification API not supported");
        return;
    }

    if (Notification.permission !== "granted") {
        console.log("[Notifications] Notification permission not granted");
        return;
    }

    try {
        if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification(options.title, {
                body: options.body,
                icon: options.icon || "/icons/icon-192x192.png",
                badge: options.badge || "/icons/icon-192x192.png",
                tag: options.tag || "omnilots-notification",
                requireInteraction: false,
                data: options.data,
            });
        } else {
            new Notification(options.title, {
                body: options.body,
                icon: options.icon || "/icons/icon-192x192.png",
                badge: options.badge || "/icons/icon-192x192.png",
            });
        }
        console.log("[Notifications] Notification shown:", options.title);
    } catch (error) {
        console.error("[Notifications] Failed to show notification:", error);
    }
};

/**
 * Check and request notification permission on app load
 */
export const checkAndRequestNotificationPermission = async (): Promise<void> => {
    await initializeServiceWorker();

    if ("Notification" in window && Notification.permission === "default") {
        console.log("[Notifications] Ready to request permission on user interaction");
    } else if ("Notification" in window && Notification.permission === "granted") {
        console.log("[Notifications] Permission already granted");
    }
};

/**
 * Get current notification permission state
 */
export const getNotificationPermission = (): NotificationPermission => {
    if (!("Notification" in window)) {
        return "denied";
    }
    return Notification.permission;
};
