"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrowserLandingPage from "./components/BrowserLandingPage";

export default function Home() {
    const router = useRouter();
    const [isStandalone, setIsStandalone] = useState<boolean | null>(null);

    useEffect(() => {
        const isInstalledDisplayMode =
            window.matchMedia("(display-mode: standalone)").matches ||
            window.matchMedia("(display-mode: fullscreen)").matches ||
            window.matchMedia("(display-mode: minimal-ui)").matches ||
            (typeof navigator !== "undefined" &&
                "standalone" in navigator &&
                Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

        if (isInstalledDisplayMode) {
            router.replace("/map");
        }

        setIsStandalone(isInstalledDisplayMode);
    }, [router]);

    if (isStandalone === null || isStandalone) {
        return null;
    }

    return <BrowserLandingPage />;
}
