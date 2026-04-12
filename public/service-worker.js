// Service Worker for PWA notifications and offline support
const CACHE_NAME = "omnilots-v1";

// Install event - create cache
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log("[Service Worker] Cache opened");
            self.skipWaiting();
        }),
    );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log("[Service Worker] Deleting old cache:", cacheName);
                        return caches.delete(cacheName);
                    }
                }),
            );
        }),
    );
    self.clients.claim();
});

// Handle notifications sent to users
self.addEventListener("push", (event) => {
    if (!event.data) {
        console.log("[Service Worker] Push event without data");
        return;
    }

    let notificationData = {};
    try {
        notificationData = event.data.json();
    } catch {
        notificationData = {
            title: "Omnilots",
            body: event.data.text(),
        };
    }

    const options = {
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-192x192.png",
        tag: "omnilots-notification",
        requireInteraction: false,
        ...notificationData,
    };

    event.waitUntil(self.registration.showNotification(options.title, options));
});

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            // Focus existing window if available
            for (const client of clientList) {
                if ((client.url.endsWith("/map") || client.url === "/") && "focus" in client) {
                    return client.focus();
                }
            }
            // Open new window if not found
            if (clients.openWindow) {
                return clients.openWindow("/map");
            }
        }),
    );
});

// Fetch event - use cache for offline support
self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            if (response) {
                return response;
            }

            return fetch(event.request).then((response) => {
                // Don't cache POST requests or API calls
                if (event.request.method === "GET" && !event.request.url.includes("/api/") && response.status === 200) {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }

                return response;
            });
        }),
    );
});
