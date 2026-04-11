import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const INPUT_FILE = process.argv[2];
const OUTPUT_FILE = path.resolve(process.cwd(), "public/boundaries/jac-parking-boundaries.geojson");

const fail = (message) => {
    console.error(`Error: ${message}`);
    process.exit(1);
};

const isObject = (value) => typeof value === "object" && value !== null;

const validateBoundaryGeoJson = (value) => {
    if (!isObject(value)) {
        fail("GeoJSON root must be an object.");
    }

    if (value.type !== "FeatureCollection") {
        fail("GeoJSON must be a FeatureCollection.");
    }

    if (!Array.isArray(value.features) || value.features.length === 0) {
        fail("FeatureCollection must contain at least one feature.");
    }

    const hasPolygonGeometry = value.features.some((feature) => {
        if (!isObject(feature) || !isObject(feature.geometry)) {
            return false;
        }

        return feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
    });

    if (!hasPolygonGeometry) {
        fail("Boundary file must include at least one Polygon or MultiPolygon feature.");
    }
};

const run = async () => {
    if (!INPUT_FILE) {
        fail("Usage: npm run boundary:upload -- <path-to-geojson>");
    }

    const absoluteInputPath = path.resolve(process.cwd(), INPUT_FILE);
    const rawInput = await readFile(absoluteInputPath, "utf8");

    let parsed;
    try {
        parsed = JSON.parse(rawInput);
    } catch {
        fail("Input file is not valid JSON.");
    }

    validateBoundaryGeoJson(parsed);

    await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await writeFile(OUTPUT_FILE, `${JSON.stringify(parsed, null, 4)}\n`, "utf8");

    console.log(`Boundary uploaded to ${OUTPUT_FILE}`);
};

run().catch((error) => {
    const message = error instanceof Error ? error.message : "Unexpected upload failure.";
    fail(message);
});
