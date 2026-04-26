import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    let version = "unknown";
    try {
        version = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf-8").trim();
    } catch {
        version = process.env.NODE_ENV === "development" ? "dev" : "unknown";
    }
    return NextResponse.json(
        { version },
        { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" } },
    );
}
