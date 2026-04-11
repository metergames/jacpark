"use client";

import { useEffect, useState } from "react";

type LatLng = {
    latitude: number;
    longitude: number;
};

const JOHN_ABBOTT_CENTER: LatLng = {
    latitude: 45.405,
    longitude: -73.943,
};

const CAMPUS_RADIUS_METERS = 250;
const EARTH_RADIUS_METERS = 6371008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const haversineDistanceMeters = (from: LatLng, to: LatLng): number => {
    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const dLat = toRadians(to.latitude - from.latitude);
    const dLon = toRadians(to.longitude - from.longitude);

    const sinHalfDLat = Math.sin(dLat / 2);
    const sinHalfDLon = Math.sin(dLon / 2);

    const a = sinHalfDLat * sinHalfDLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfDLon * sinHalfDLon;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_METERS * c;
};

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
