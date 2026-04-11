import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    applicationName: "JACPark",
    title: {
        default: "JACPark",
        template: "%s | JACPark",
    },
    description: "Crowdsourced parking updates for John Abbott College, built for fast mobile reporting.",
    manifest: "/manifest.json",
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "JACPark",
    },
    formatDetection: {
        telephone: false,
        address: false,
        email: false,
    },
    icons: {
        apple: [
            {
                url: "/icons/apple-touch-icon-180x180.png",
                sizes: "180x180",
                type: "image/png",
            },
        ],
        icon: [
            {
                url: "/icons/icon-192x192.png",
                sizes: "192x192",
                type: "image/png",
            },
            {
                url: "/icons/icon-512x512.png",
                sizes: "512x512",
                type: "image/png",
            },
        ],
    },
    other: {
        "mobile-web-app-capable": "yes",
    },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: "#0b0f19",
    colorScheme: "dark",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
            <body className="min-h-full flex flex-col">{children}</body>
        </html>
    );
}
