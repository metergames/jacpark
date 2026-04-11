export type LatLng = {
    latitude: number;
    longitude: number;
};

export const JOHN_ABBOTT_CENTER: LatLng = {
    latitude: 45.408822013619336,
    longitude: -73.94212693281301,
};

export const CAMPUS_RADIUS_METERS = 500;

const EARTH_RADIUS_METERS = 6371008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const haversineDistanceMeters = (from: LatLng, to: LatLng): number => {
    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);
    const deltaLatitude = toRadians(to.latitude - from.latitude);
    const deltaLongitude = toRadians(to.longitude - from.longitude);

    const sinHalfDeltaLatitude = Math.sin(deltaLatitude / 2);
    const sinHalfDeltaLongitude = Math.sin(deltaLongitude / 2);

    const a =
        sinHalfDeltaLatitude * sinHalfDeltaLatitude +
        Math.cos(lat1) * Math.cos(lat2) * sinHalfDeltaLongitude * sinHalfDeltaLongitude;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_METERS * c;
};
