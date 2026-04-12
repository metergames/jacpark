"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { useTheme } from "../lib/ThemeContext";
import type { Session } from "@supabase/supabase-js";
import {
    getNotificationPermission,
    initializeServiceWorker,
    requestNotificationPermission,
    subscribeToPushNotifications,
    showNotification,
} from "../lib/notifications";
//YES
export default function SettingsPage() {
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
    const [notificationFeedback, setNotificationFeedback] = useState<string>("");
    const [isIosDevice, setIsIosDevice] = useState(false);
    const [showIosNotificationPopup, setShowIosNotificationPopup] = useState(false);

    useEffect(() => {
        const checkSession = async () => {
            try {
                const supabase = getSupabaseBrowserClient();
                const { data } = await supabase.auth.getSession();
                if (data.session) {
                    setSession(data.session);
                } else {
                    router.push("/");
                }
            } catch (error) {
                console.error("Error checking session:", error);
                router.push("/");
            } finally {
                setIsLoading(false);
            }
        };

        checkSession();
    }, [router]);

    useEffect(() => {
        setNotificationPermission(getNotificationPermission());
        void initializeServiceWorker();

        const userAgent = window.navigator.userAgent || "";
        const platform = window.navigator.platform || "";
        const isTouchMac = platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
        const iosDetected = /iPad|iPhone|iPod/.test(userAgent) || isTouchMac;

        setIsIosDevice(iosDetected);

        const dismissedPopup = window.localStorage.getItem("omnilots-ios-notification-popup-dismissed") === "1";
        if (iosDetected && getNotificationPermission() === "default" && !dismissedPopup) {
            setShowIosNotificationPopup(true);
        }
    }, []);

    useEffect(() => {
        if (!session?.access_token) {
            return;
        }

        if (notificationPermission === "granted") {
            void subscribeToPushNotifications(session.access_token);
        }
    }, [notificationPermission, session?.access_token]);

    const handleEnableNotifications = async (): Promise<void> => {
        const permission = await requestNotificationPermission();
        setNotificationPermission(permission);
        setShowIosNotificationPopup(false);

        if (permission === "granted") {
            if (session?.access_token) {
                await subscribeToPushNotifications(session.access_token);
            }
            setNotificationFeedback("Notifications enabled.");
            return;
        }

        if (permission === "denied") {
            setNotificationFeedback("Notifications are blocked. Enable them in browser/app settings.");
            return;
        }

        setNotificationFeedback("Notification permission was not granted.");
    };

    const handleSendTestNotification = async (): Promise<void> => {
        await showNotification({
            title: "Omnilots Test",
            body: `Test sent at ${new Date().toLocaleTimeString()}`,
            tag: "omnilots-test",
        });

        setNotificationFeedback("Test notification sent.");
    };

    const handleDismissIosPopup = (): void => {
        window.localStorage.setItem("omnilots-ios-notification-popup-dismissed", "1");
        setShowIosNotificationPopup(false);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-900">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!session) {
        return null;
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
            {showIosNotificationPopup ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Enable Notifications on iOS</h2>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                            Get live parking updates while Omnilots is open. Tap Enable to allow notifications.
                        </p>
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            Tip: Install Omnilots to your Home Screen for the best iOS notification support.
                        </p>
                        <div className="mt-4 flex gap-2">
                            <button
                                type="button"
                                onClick={handleDismissIosPopup}
                                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                                Not now
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    void handleEnableNotifications();
                                }}
                                className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                            >
                                Enable
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            <div className="max-w-2xl mx-auto px-4 py-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Settings</h1>
                    <button
                        onClick={() => router.push("/map")}
                        className="rounded-lg bg-slate-200 dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-300 dark:hover:bg-slate-700 transition"
                    >
                        ← Back to Map
                    </button>
                </div>

                {/* Theme Section */}
                <section className="rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-6 transition-colors">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Appearance</h2>

                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                        Choose your theme:
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                        <button
                            onClick={() => setTheme("dark")}
                            className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
                                theme === "dark"
                                    ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/30"
                                    : "bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
                            }`}
                        >
                            🌙 Dark
                        </button>
                        <button
                            onClick={() => setTheme("light")}
                            className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
                                theme === "light"
                                    ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/30"
                                    : "bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
                            }`}
                        >
                            ☀️ Light
                        </button>
                        <button
                            onClick={() => setTheme("auto")}
                            className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
                                theme === "auto"
                                    ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/30"
                                    : "bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
                            }`}
                        >
                            🌅 Auto
                        </button>
                    </div>
                    {theme === "auto" && (
                        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                            Theme changes based on sunrise and sunset
                        </p>
                    )}
                </section>

                <section className="mt-6 rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-6 transition-colors">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Notifications</h2>

                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Status: <span className="font-semibold">{notificationPermission}</span>
                    </p>

                    <div className="flex flex-wrap gap-3">
                        <button
                            onClick={() => {
                                void handleEnableNotifications();
                            }}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
                        >
                            Enable Notifications
                        </button>

                        <button
                            onClick={() => {
                                void handleSendTestNotification();
                            }}
                            disabled={notificationPermission !== "granted"}
                            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Send Test Notification
                        </button>
                    </div>

                    {isIosDevice ? (
                        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                            iOS note: install Omnilots to home screen first, then allow notifications when prompted.
                        </p>
                    ) : null}

                    {notificationFeedback ? (
                        <p className="mt-3 text-sm text-slate-900 dark:text-slate-100">{notificationFeedback}</p>
                    ) : null}
                </section>
            </div>
        </div>
    );
}
