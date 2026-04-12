"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { getSupabaseBrowserClient } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";

const ParkingMap = dynamic(() => import("../components/ParkingMap"), { ssr: false });

export default function MapPage() {
    const router = useRouter();
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const checkAuth = async () => {
            try {
                const supabase = getSupabaseBrowserClient();

                // First try to get the stored session from localStorage
                const { data } = await supabase.auth.getSession();

                if (isMounted) {
                    if (data.session) {
                        setSession(data.session);
                        setIsLoading(false);
                    } else {
                        // Not authenticated, redirect to login
                        router.push("/login");
                    }
                }
            } catch (error) {
                console.error("Auth check failed:", error);
                if (isMounted) {
                    router.push("/login");
                }
            }
        };

        // Check session immediately
        checkAuth();

        // Set up auth state listener for real-time updates
        const supabase = getSupabaseBrowserClient();
        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
            if (isMounted) {
                if (session) {
                    setSession(session);
                    setIsLoading(false);
                } else if (event === "SIGNED_OUT") {
                    // User signed out
                    setSession(null);
                    router.push("/login");
                }
            }
        });

        return () => {
            isMounted = false;
            authListener?.subscription.unsubscribe();
        };
    }, [router]);

    if (isLoading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0f]">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#5ce786]" />
                    <p className="text-gray-400 mt-4">Loading map...</p>
                </div>
            </div>
        );
    }

    if (!session) {
        return null; // Will redirect in useEffect
    }

    return <ParkingMap />;
}
