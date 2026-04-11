"use client";

import { useEffect, useState } from "react";
import { CAMPUS_RADIUS_METERS, haversineDistanceMeters, JOHN_ABBOTT_CENTER, type LatLng } from "../lib/geo";

type CampusProximityState = {
    isNearCampus: boolean;
    distanceToCampus: number;
    locationError: string;
};

export default function useCampusProximity(): CampusProximityState {
    const geolocationSupported = typeof window !== "undefined" && "geolocation" in navigator;

    const [distanceToCampus, setDistanceToCampus] = useState<number>(Number.POSITIVE_INFINITY);
    const [isNearCampus, setIsNearCampus] = useState<boolean>(false);
    const [locationError, setLocationError] = useState<string>(
        geolocationSupported ? "" : "Geolocation is not supported by this browser.",
    );

    useEffect(() => {
        if (!geolocationSupported) {
            return;
        }

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const userLocation: LatLng = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                };

                const distance = haversineDistanceMeters(userLocation, JOHN_ABBOTT_CENTER);

                setDistanceToCampus(distance);
                setIsNearCampus(distance <= CAMPUS_RADIUS_METERS);
                setLocationError("");
            },
            (error) => {
                if (error.code === error.PERMISSION_DENIED) {
                    setLocationError("Location permission denied.");
                } else {
                    setLocationError("Unable to get your current location.");
                }

                setIsNearCampus(false);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 5000,
                timeout: 10000,
            },
        );

        return () => {
            navigator.geolocation.clearWatch(watchId);
        };
    }, [geolocationSupported]);

    return {
        isNearCampus,
        distanceToCampus,
        locationError,
    };
}
