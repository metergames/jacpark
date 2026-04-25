// [lng, lat] coordinate pair
export type LngLat = [number, number];

export type ParkingLot = {
    name: string;
    // Coordinate where the lot name label is displayed on the map [lng, lat]
    labelCoord: LngLat;
    // Polygon boundary — array of [lng, lat] pairs (first and last point should match to close the ring)
    polygon: LngLat[];
};

export const PARKING_LOTS: ParkingLot[] = [
    {
        name: "West Student Lot",
        labelCoord: [-73.942904051639, 45.408480674568],
        polygon: [
            [-73.943440206985, 45.408042242276],
            [-73.942313679198, 45.408186046217],
            [-73.942294903735, 45.408060883548],
            [-73.942131288985, 45.408076861777],
            [-73.942235895137, 45.40866805305],
            [-73.94230831478, 45.40865740101],
            [-73.942378052215, 45.408992939314],
            [-73.942858167628, 45.408952994382],
            [-73.942895718554, 45.408891745432],
            [-73.943019100169, 45.408873104434],
            [-73.94304324005, 45.408811855397],
            [-73.943375833968, 45.408758595311],
            [-73.943391927222, 45.408715987206],
            [-73.943550177554, 45.408649411978],
            [-73.943440206985, 45.408042242276],
        ],
    },
    {
        name: "North Student Lot",
        labelCoord: [-73.941305455066, 45.409188692625],
        polygon: [
            [-73.942250690244, 45.408763876672],
            [-73.94035436847, 45.408936971751],
            [-73.940509936593, 45.409733202284],
            [-73.941016874097, 45.409674617142],
            [-73.941016874097, 45.40956543558],
            [-73.941440663121, 45.409520165114],
            [-73.94147284963, 45.409477557584],
            [-73.941652557634, 45.409448264888],
            [-73.941674015306, 45.40936837564],
            [-73.941859087728, 45.409339082888],
            [-73.941869816564, 45.409227237694],
            [-73.942296287797, 45.409171315014],
            [-73.942250690244, 45.408763876672],
        ],
    },
    {
        name: "Paid Parking",
        labelCoord: [-73.940189656116, 45.409572826367],
        polygon: [
            [-73.940016065377, 45.41004153353],
            [-73.939835016269, 45.409275931636],
            [-73.940383528012, 45.409221340495],
            [-73.940498863, 45.409781895789],
            [-73.940262828607, 45.409860452975],
            [-73.940333907146, 45.409956319224],
            [-73.940016065377, 45.41004153353],
        ],
    },
];

export const LOT_NAMES: ReadonlySet<string> = new Set(
    PARKING_LOTS.map((lot) => lot.name),
);

// Ray-casting point-in-polygon. point and polygon vertices are [lng, lat].
export function pointInPolygon(point: LngLat, polygon: LngLat[]): boolean {
    const [px, py] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
        ) {
            inside = !inside;
        }
    }
    return inside;
}

// Returns the lot the given coordinates fall inside, or null if none.
export function getLotForLocation(
    latitude: number,
    longitude: number,
): ParkingLot | null {
    const point: LngLat = [longitude, latitude];
    for (const lot of PARKING_LOTS) {
        if (pointInPolygon(point, lot.polygon)) {
            return lot;
        }
    }
    return null;
}
