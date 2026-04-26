"use client";

import { useEffect } from "react";

const VERSION_KEY = "omnilots_build";

async function forceReload(): Promise<void> {
    try {
        if ("serviceWorker" in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((r) => r.unregister()));
        }
    } catch {
        // ignore
    }
    window.location.reload();
}

function skipWaiting(reg: ServiceWorkerRegistration): void {
    reg.waiting?.postMessage({ type: "SKIP_WAITING" });
}

async function applyPendingUpdate(reg: ServiceWorkerRegistration): Promise<void> {
    if (reg.waiting) {
        skipWaiting(reg);
        return;
    }

    try {
        await reg.update();
    } catch {
        // network error — ignore
    }

    reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) {
                skipWaiting(reg);
            }
        });
    });
}

async function checkVersion(): Promise<void> {
    try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;

        const { version } = (await res.json()) as { version?: string };
        if (!version || version === "unknown" || version === "dev") return;

        const stored = localStorage.getItem(VERSION_KEY);

        if (!stored) {
            localStorage.setItem(VERSION_KEY, version);
            return;
        }

        if (stored !== version) {
            localStorage.setItem(VERSION_KEY, version);
            await forceReload();
        }
    } catch {
        // network error — ignore
    }
}

export default function PwaUpdateHandler() {
    useEffect(() => {
        if (typeof window === "undefined") return;

        let refreshing = false;

        const onControllerChange = () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        };

        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

            void navigator.serviceWorker.getRegistration().then((reg) => {
                if (reg) void applyPendingUpdate(reg);
            });
        }

        void checkVersion();

        const onVisible = () => {
            if (document.visibilityState !== "visible") return;

            if ("serviceWorker" in navigator) {
                void navigator.serviceWorker.getRegistration().then((reg) => {
                    if (reg) void applyPendingUpdate(reg);
                });
            }

            void checkVersion();
        };

        document.addEventListener("visibilitychange", onVisible);

        return () => {
            if ("serviceWorker" in navigator) {
                navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
            }
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    return null;
}
