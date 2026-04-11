"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const JOHN_ABBOTT_CENTER: [number, number] = [-73.943, 45.405];
const JOHN_ABBOTT_ZOOM = 15.5;
const LIGHT_STYLE_URL = "mapbox://styles/mapbox/standard";

export default function ParkingMap() {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);

    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) {
            return;
        }

        const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

        if (!accessToken) {
            console.warn("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN is missing. Map initialization skipped.");
            return;
        }

        mapboxgl.accessToken = accessToken;

        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: LIGHT_STYLE_URL,
            center: JOHN_ABBOTT_CENTER,
            zoom: JOHN_ABBOTT_ZOOM,
            attributionControl: false,
        });

        mapRef.current = map;

        const loadLotsPolygonLayerPlaceholder = (mapInstance: mapboxgl.Map): void => {
            // TODO: load lots.json as a GeoJSON source and add polygon fill/outline layers.
            // Example future step:
            // mapInstance.addSource("parking-lots", { type: "geojson", data: lotsGeoJson });
            // mapInstance.addLayer({ id: "parking-lots-fill", type: "fill", source: "parking-lots", ... });
            void mapInstance;
        };

        const handleMapLoad = (): void => {
            loadLotsPolygonLayerPlaceholder(map);
        };

        map.on("load", handleMapLoad);

        return () => {
            map.off("load", handleMapLoad);
            map.remove();
            mapRef.current = null;
        };
    }, []);

    return (
        <section className="relative h-[100dvh] w-screen overflow-hidden">
            <div ref={mapContainerRef} className="h-full w-full" />
        </section>
    );
}
