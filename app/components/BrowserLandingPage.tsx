"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function BrowserLandingPage() {
    const router = useRouter();
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setDeferredPrompt(event as BeforeInstallPromptEvent);
        };

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) {
            return;
        }

        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setDeferredPrompt(null);
    };

    return (
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
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

            <div className="w-full max-w-md">
                <div className="text-center mb-12">
                    <h1 className="text-5xl font-bold text-white mb-3">Omnilots</h1>
                    <p className="text-gray-400 text-lg">Find campus parking faster</p>
                </div>

                <div className="bg-[#111118] rounded-2xl border border-gray-700 p-8 shadow-2xl space-y-4">
                    <button
                        onClick={() => router.push("/login")}
                        className="w-full bg-[#5ce786] text-black font-semibold py-3 px-4 rounded-lg hover:bg-[#9bfea8] transition"
                    >
                        Login with Google
                    </button>

                    <button
                        onClick={handleInstall}
                        disabled={!deferredPrompt}
                        className="w-full bg-transparent text-white font-semibold py-3 px-4 rounded-lg border border-gray-600 hover:border-gray-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Install App
                    </button>

                    {!deferredPrompt && (
                        <p className="text-xs text-gray-500 text-center">
                            Install becomes available once your browser allows PWA install prompts.
                        </p>
                    )}
                </div>
            </div>

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
