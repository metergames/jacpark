"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "../lib/supabase";

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{
        outcome: "accepted" | "dismissed";
        platform: string;
    }>;
};

const isStandaloneAppDisplayMode = (): boolean => {
    if (typeof window === "undefined") {
        return false;
    }

    const isStandaloneMedia = window.matchMedia("(display-mode: standalone)").matches;
    const isIosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isAndroidTwa = document.referrer.startsWith("android-app://");

    return isStandaloneMedia || isIosStandalone || isAndroidTwa;
};

export default function LandingPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [isCheckingAuth, setIsCheckingAuth] = useState(true);
    const [installError, setInstallError] = useState("");
    const [isIosDevice, setIsIosDevice] = useState(false);
    const [showIosInstallGuide, setShowIosInstallGuide] = useState(false);
    const [canInstallPwa, setCanInstallPwa] = useState(false);
    const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        // Check if user is already authenticated
        const checkExistingSession = async () => {
            try {
                const supabase = getSupabaseBrowserClient();
                const { data } = await supabase.auth.getSession();

                if (data.session) {
                    // User is already logged in, redirect to map
                    router.push("/map");
                } else {
                    setIsCheckingAuth(false);
                }
            } catch (err) {
                console.error("Error checking session:", err);
                setIsCheckingAuth(false);
            }
        };

        checkExistingSession();
    }, [router]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const userAgent = window.navigator.userAgent || "";
        const platform = window.navigator.platform || "";
        const isTouchMac = platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
        const detectedIos = /iPad|iPhone|iPod/.test(userAgent) || isTouchMac;
        setIsIosDevice(detectedIos);

        if (isStandaloneAppDisplayMode()) {
            setCanInstallPwa(false);
            setDeferredInstallPrompt(null);
            return;
        }

        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
            setCanInstallPwa(true);
        };

        const handleInstalled = () => {
            setCanInstallPwa(false);
            setDeferredInstallPrompt(null);
            setInstallError("");
        };

        const displayModeQuery = window.matchMedia("(display-mode: standalone)");
        const handleDisplayModeChange = () => {
            if (isStandaloneAppDisplayMode()) {
                setCanInstallPwa(false);
                setDeferredInstallPrompt(null);
            }
        };

        const supportsModernQueryListener = typeof displayModeQuery.addEventListener === "function";

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.addEventListener("appinstalled", handleInstalled);
        if (supportsModernQueryListener) {
            displayModeQuery.addEventListener("change", handleDisplayModeChange);
        } else {
            displayModeQuery.addListener(handleDisplayModeChange);
        }

        return () => {
            window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
            window.removeEventListener("appinstalled", handleInstalled);
            if (supportsModernQueryListener) {
                displayModeQuery.removeEventListener("change", handleDisplayModeChange);
            } else {
                displayModeQuery.removeListener(handleDisplayModeChange);
            }
        };
    }, []);

    const handleGoogleSignIn = async () => {
        setError("");
        setIsLoading(true);

        try {
            const supabase = getSupabaseBrowserClient();
            const { error: err } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: `${window.location.origin}/map`,
                },
            });
            if (err) setError(err.message);
        } catch {
            setError("Failed to sign in with Google. Supabase may not be configured.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleInstallPwa = async () => {
        if (isIosDevice && !deferredInstallPrompt) {
            setShowIosInstallGuide(true);
            return;
        }

        if (!deferredInstallPrompt) {
            return;
        }

        setInstallError("");

        try {
            await deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
        } catch {
            setInstallError("Unable to open install prompt right now.");
        } finally {
            setCanInstallPwa(false);
            setDeferredInstallPrompt(null);
        }
    };

    return (
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
            {showIosInstallGuide ? (
                <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
                    <div className="w-full max-w-sm rounded-2xl border border-gray-700 bg-[#111118] p-6 text-white shadow-2xl">
                        <h2 className="text-lg font-bold">Install Omnilots on iPhone</h2>
                        <p className="mt-3 text-sm text-gray-300">Use Safari, then follow these steps:</p>
                        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-gray-200">
                            <li>Tap the Share button in Safari.</li>
                            <li>Scroll and tap Add to Home Screen.</li>
                            <li>Tap Add to install Omnilots.</li>
                        </ol>
                        <button
                            type="button"
                            onClick={() => setShowIosInstallGuide(false)}
                            className="mt-5 w-full rounded-lg bg-[#5ce786] px-4 py-2 font-semibold text-black transition hover:bg-[#9bfea8]"
                        >
                            Got it
                        </button>
                    </div>
                </div>
            ) : null}

            {/* Background gradient */}
            <div className="fixed inset-0 -z-10 overflow-hidden">
                <div
                    className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20"
                    style={{ animation: "blob 7s infinite" }}
                />
                <div
                    className="absolute top-0 right-1/4 w-96 h-96 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20"
                    style={{ animation: "blob 7s infinite 2s" }}
                />
            </div>

            {isCheckingAuth ? (
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#5ce786]" />
                    <p className="text-gray-400 mt-4">Checking your session...</p>
                </div>
            ) : (
                <div className="w-full max-w-md">
                    {/* Header */}
                    <div className="text-center mb-12">
                        <h1 className="text-5xl font-bold text-white mb-3">Omnilots</h1>
                        <p className="text-gray-400 text-lg">Crowdsourced parking for John Abbott</p>
                    </div>

                    {/* Card */}
                    <div className="bg-[#111118] rounded-2xl border border-gray-700 p-8 shadow-2xl">
                        <p className="text-gray-400 text-center mb-6">Sign in with Google to get started</p>

                        {error && <p className="text-sm text-red-500 text-center mb-4">{error}</p>}

                        {/* Google Sign In */}
                        <button
                            onClick={handleGoogleSignIn}
                            disabled={isLoading}
                            className="w-full bg-[#5ce786] text-black font-semibold py-3 px-4 rounded-lg hover:bg-[#9bfea8] transition disabled:opacity-50 flex items-center justify-center gap-3"
                        >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            {isLoading ? "Signing in..." : "Continue with Google"}
                        </button>

                        {(canInstallPwa || isIosDevice) && (
                            <button
                                onClick={handleInstallPwa}
                                className="mt-3 w-full rounded-lg border border-[#5ce786]/60 bg-transparent px-4 py-3 font-semibold text-[#5ce786] transition hover:border-[#9bfea8] hover:text-[#9bfea8]"
                            >
                                Install Omnilots App
                            </button>
                        )}

                        {isIosDevice && !canInstallPwa ? (
                            <p className="mt-2 text-center text-xs text-gray-500">
                                iOS installs from Safari via Share to Add to Home Screen.
                            </p>
                        ) : null}

                        {installError && <p className="mt-3 text-center text-sm text-red-500">{installError}</p>}

                        {/* Footer */}
                        <p className="text-center text-xs text-gray-500 mt-8">
                            By signing in, you agree to our{" "}
                            <a href="#" className="text-[#5ce786] hover:underline">
                                Terms
                            </a>
                        </p>
                    </div>
                </div>
            )}

            <style jsx>{`
                @keyframes blob {
                    0%,
                    100% {
                        transform: translate(0, 0) scale(1);
                    }
                    33% {
                        transform: translate(30px, -50px) scale(1.1);
                    }
                    66% {
                        transform: translate(-20px, 20px) scale(0.9);
                    }
                }
            `}</style>
        </div>
    );
}
