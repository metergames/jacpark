"use client";

import dynamic from "next/dynamic";

const ParkingMap = dynamic(() => import("../components/ParkingMap"), { ssr: false });

export default function MapPage() {
    return <ParkingMap />;
}
