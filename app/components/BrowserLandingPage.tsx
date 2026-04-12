"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, Crown, Download, Flame, Lock, LogOut, MapPin, Mic, Shield, Star, Trophy } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type Glow = "emerald" | "blue" | "purple";

function GoogleIcon() {
    return (
        <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
    );
}

function GlassCard({ children, glow = "emerald", className = "" }: { children: ReactNode; glow?: Glow; className?: string }) {
    const glowClass = {
        emerald: "hover:shadow-[0_0_30px_rgba(92,231,134,0.15)] border-[#5ce786]/10",
        blue: "hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] border-[#3b82f6]/10",
        purple: "hover:shadow-[0_0_30px_rgba(147,51,234,0.15)] border-[#9333ea]/10",
    };

    return <div className={`rounded-2xl border bg-white/[0.03] backdrop-blur-xl transition-shadow duration-500 ${glowClass[glow]} ${className}`}>{children}</div>;
}

function AmbientOrbs() {
    return (
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
            <motion.div
                className="absolute w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
                style={{ background: "radial-gradient(circle, #5ce786 0%, transparent 70%)", top: "10%", left: "-10%" }}
                animate={{ x: [0, 80, 0], y: [0, 40, 0] }}
                transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
                className="absolute w-[500px] h-[500px] rounded-full opacity-15 blur-[120px]"
                style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)", top: "50%", right: "-5%" }}
                animate={{ x: [0, -60, 0], y: [0, -50, 0] }}
                transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
            />
        </div>
    );
}

export default function BrowserLandingPage() {
    const router = useRouter();
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setDeferredPrompt(event as BeforeInstallPromptEvent);
        };

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) {
            return;
        }

        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setDeferredPrompt(null);
    };

    const PrimaryCTA = ({ compact = false }: { compact?: boolean }) => (
        <motion.button
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => router.push("/login")}
            className={`flex items-center justify-center gap-3 px-7 ${compact ? "py-3" : "py-3.5"} rounded-xl bg-[#5ce786] text-[#0a0a0f] transition-all duration-300 shadow-[0_0_20px_rgba(92,231,134,0.3)] hover:shadow-[0_0_40px_rgba(92,231,134,0.5)]`}
        >
            <GoogleIcon />
            <span>Sign in with Google</span>
        </motion.button>
    );

    const InstallCTA = ({ compact = false }: { compact?: boolean }) => {
        if (!deferredPrompt) {
            return null;
        }

        return (
            <motion.button
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleInstall}
                className={`flex items-center justify-center gap-3 px-7 ${compact ? "py-3" : "py-3.5"} rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-md text-white hover:border-[#3b82f6]/40 hover:shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-all duration-300`}
            >
                <Download className="w-5 h-5" />
                <span>Install App (PWA)</span>
            </motion.button>
        );
    };

    const features = [
        {
            title: "Live Heatmap Intelligence",
            body: "Real-time, crowdsourced parking visibility across Casgrain, Oval, and Library lots.",
            tag: "Live crowd telemetry",
            icon: MapPin,
            accent: "#5ce786",
            glow: "emerald" as const,
            large: true,
        },
        {
            title: "Nordsec Geofenced Security",
            body: "Reports are accepted near campus to improve trust and reduce fake updates.",
            tag: "Proximity-verified reporting",
            icon: Shield,
            accent: "#3b82f6",
            glow: "blue" as const,
            large: false,
        },
        {
            title: "Drive Mode (AI Voice)",
            body: "Submit updates hands-free so you can contribute safely while driving.",
            tag: "AI voice interaction",
            icon: Mic,
            accent: "#9333ea",
            glow: "purple" as const,
            large: false,
        },
        {
            title: "Campus Economy",
            body: "Earn points for quality reports and climb the leaderboard with useful contributions.",
            tag: "Gamified rewards",
            icon: Trophy,
            accent: "#5ce786",
            glow: "emerald" as const,
            large: true,
        },
    ];

    const rewardMechanics = [
        { icon: Activity, title: "Report Activity", desc: "Share lot status to earn points and improve map accuracy.", color: "#5ce786" },
        { icon: LogOut, title: "Check-Out Signals", desc: "Mark when you leave so others can react to open spots.", color: "#3b82f6" },
        { icon: Crown, title: "Leaderboard", desc: "Compete with friends and top contributors across campus.", color: "#9333ea" },
        { icon: Lock, title: "Premium Unlock", desc: "Consistent contributors unlock advanced features first.", color: "#5ce786" },
    ];

    return (
        <div className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden">
            <AmbientOrbs />

            <motion.nav
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-[#0a0a0f]/60 backdrop-blur-xl border-b border-white/[0.04]"
            >
                <div className="flex items-center gap-3">
                    <img src="/icons/icon-192x192.png" alt="Omnilots" className="w-8 h-8 rounded-lg" />
                    <span className="text-white font-bold">Omnilots</span>
                </div>
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => router.push("/login")}
                    className="px-4 py-2 text-sm rounded-lg bg-white/[0.06] border border-white/10 text-white hover:border-[#5ce786]/30 transition-colors"
                >
                    Sign in
                </motion.button>
            </motion.nav>

            <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 text-center overflow-hidden">
                <motion.div
                    className="absolute w-72 h-72 border border-[#5ce786]/10 rounded-full"
                    style={{ top: "15%", left: "10%" }}
                    animate={{ rotate: 360 }}
                    transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
                />
                <motion.div
                    className="absolute w-96 h-96 border border-[#3b82f6]/10 rounded-full"
                    style={{ bottom: "10%", right: "5%" }}
                    animate={{ rotate: -360 }}
                    transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
                />

                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }} className="mb-6">
                    <img src="/icons/icon-192x192.png" alt="Omnilots" className="w-20 h-20 rounded-2xl" />
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mb-8 px-4 py-1.5 rounded-full border border-[#5ce786]/20 bg-[#5ce786]/[0.06] text-[#5ce786] text-sm"
                >
                    Crowdsourced parking for John Abbott College
                </motion.div>

                <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mb-6">
                    {[
                        "Beat the lot.",
                        "Make class.",
                    ].map((word, i) => (
                        <motion.span
                            key={word}
                            initial={{ opacity: 0, y: 40, filter: "blur(8px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            transition={{ delay: 0.4 + i * 0.2, duration: 0.7, ease: "easeOut" }}
                            className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl text-white tracking-tight font-bold"
                        >
                            {word}
                        </motion.span>
                    ))}
                </div>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.9, duration: 0.6 }}
                    className="max-w-2xl text-white/50 text-lg mb-8"
                >
                    Omnilots is the student-powered parking network for John Abbott College, with live heatmaps and campus-verified reports.
                </motion.p>

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="flex flex-wrap justify-center gap-2 mb-10">
                    {[
                        "Live crowd data",
                        "Campus-verified",
                        "Hands-free reporting",
                        "Built for JAC",
                    ].map((chip) => (
                        <span key={chip} className="px-3 py-1 rounded-full text-xs border border-white/10 bg-white/[0.04] text-white/60">
                            {chip}
                        </span>
                    ))}
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3 }} className="flex flex-col sm:flex-row gap-4 mb-4">
                    <PrimaryCTA />
                    <InstallCTA />
                </motion.div>
            </section>

            <section className="relative px-6 py-24 max-w-6xl mx-auto">
                <div className="text-center mb-16">
                    <h2 className="text-3xl sm:text-4xl md:text-5xl text-white mb-4 font-bold">Built for real commuter mornings</h2>
                    <p className="text-white/40 max-w-xl mx-auto">Every feature is designed to reduce uncertainty, improve safety, and keep data trustworthy.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {features.map((feature) => {
                        const Icon = feature.icon;
                        return (
                            <div key={feature.title} className={feature.large ? "md:col-span-2" : ""}>
                                <GlassCard glow={feature.glow} className="p-8 h-full">
                                    <div className="flex items-start gap-5">
                                        <div
                                            className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                                            style={{ background: `${feature.accent}15`, border: `1px solid ${feature.accent}30` }}
                                        >
                                            <Icon className="w-6 h-6" style={{ color: feature.accent }} />
                                        </div>
                                        <div className="flex-1">
                                            <h3 className="text-white text-lg mb-2 font-semibold">{feature.title}</h3>
                                            <p className="text-white/40 text-sm mb-3">{feature.body}</p>
                                            <span className="inline-block px-3 py-1 rounded-full text-xs" style={{ background: `${feature.accent}12`, color: feature.accent, border: `1px solid ${feature.accent}25` }}>
                                                {feature.tag}
                                            </span>
                                        </div>
                                    </div>
                                </GlassCard>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="relative px-6 py-24 max-w-6xl mx-auto">
                <div className="text-center mb-16">
                    <h2 className="text-3xl sm:text-4xl md:text-5xl text-white mb-4 font-bold">Fuel the campus parking economy</h2>
                    <p className="text-white/40 max-w-xl mx-auto">The more you help the community, the more Omnilots gives back.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                    <GlassCard glow="purple" className="p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-lg bg-[#9333ea]/10 border border-[#9333ea]/20 flex items-center justify-center">
                                <Flame className="w-5 h-5 text-[#9333ea]" />
                            </div>
                            <div>
                                <h3 className="text-white font-semibold">Campus Leaderboard</h3>
                                <p className="text-white/30 text-xs">Top contributors this week</p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            {[
                                { rank: 1, name: "Alex M.", points: "2480" },
                                { rank: 2, name: "Sam K.", points: "2210" },
                                { rank: 3, name: "Jordan L.", points: "1950" },
                            ].map((user) => (
                                <div key={user.rank} className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                                    <span className="w-6 text-center text-white/30 text-sm font-semibold">{user.rank}</span>
                                    <span className="flex-1 text-white text-sm">{user.name}</span>
                                    <div className="flex items-center gap-1">
                                        <Star className="w-3.5 h-3.5 text-[#5ce786]" />
                                        <span className="text-[#5ce786] text-sm font-semibold">{user.points}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </GlassCard>

                    <div className="space-y-4">
                        {rewardMechanics.map((mechanic) => {
                            const Icon = mechanic.icon;
                            return (
                                <GlassCard key={mechanic.title} glow="emerald" className="p-5">
                                    <div className="flex items-start gap-4">
                                        <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${mechanic.color}12`, border: `1px solid ${mechanic.color}25` }}>
                                            <Icon className="w-5 h-5" style={{ color: mechanic.color }} />
                                        </div>
                                        <div>
                                            <h4 className="text-white text-sm mb-1 font-semibold">{mechanic.title}</h4>
                                            <p className="text-white/40 text-sm">{mechanic.desc}</p>
                                        </div>
                                    </div>
                                </GlassCard>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="relative px-6 py-32 text-center overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[500px] h-[500px] rounded-full bg-[#5ce786]/[0.06] blur-[100px]" />
                </div>

                <div className="relative z-10 max-w-2xl mx-auto">
                    <h2 className="text-3xl sm:text-4xl md:text-5xl text-white mb-4 font-bold">
                        Turn commuter stress into <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#5ce786] via-[#3b82f6] to-[#9333ea]">commuter strategy</span>
                    </h2>
                    <p className="text-white/40 mb-10 max-w-lg mx-auto">Check live lots, report safely, and help the next student park faster.</p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
                        <PrimaryCTA compact />
                        <InstallCTA compact />
                    </div>
                    <p className="text-white/20 text-sm">Student-built. Campus-verified. Powered by the JAC community.</p>
                </div>
            </section>

            <footer className="relative z-10 border-t border-white/[0.04] py-8 px-6 text-center">
                <p className="text-white/20 text-sm">Copyright 2026 Omnilots. Built by students who commute too.</p>
            </footer>
        </div>
    );
}
