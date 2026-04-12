"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrowserLandingPage from "./components/BrowserLandingPage";

export default function Home() {
    const router = useRouter();
    const [isStandalone, setIsStandalone] = useState<boolean | null>(null);

    useEffect(() => {
        const standaloneMode =
            window.matchMedia("(display-mode: standalone)").matches ||
            (typeof navigator !== "undefined" &&
                "standalone" in navigator &&
                Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

        if (standaloneMode) {
            router.replace("/map");
        }

        setIsStandalone(standaloneMode);
    }, [router]);

    if (isStandalone === null || isStandalone) {
        return null;
    }

    return <BrowserLandingPage />;
}
