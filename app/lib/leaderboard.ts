import { getSupabaseBrowserClient } from "./supabase";

export interface LeaderboardEntry {
    id: string;
    full_name: string;
    points: number;
    rank?: number;
}

export type LeaderboardPeriod = "week" | "month" | "all";

const POINTS_BY_ACTION: Record<string, number> = { parked: 2, leaving: 2, observing: 1 };

function periodStart(period: LeaderboardPeriod): Date | null {
    if (period === "all") return null;
    const now = new Date();
    if (period === "week") {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return d;
    }
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d;
}

export async function fetchLeaderboard(limit: number = 10, period: LeaderboardPeriod = "all"): Promise<LeaderboardEntry[]> {
    const supabase = getSupabaseBrowserClient();

    if (period === "all") {
        const { data: profiles, error } = await supabase
            .from("profiles")
            .select("id, display_name, points")
            .order("points", { ascending: false })
            .order("created_at", { ascending: true })
            .limit(limit);

        if (error) throw new Error(error.message);

        return (profiles || []).map((p, i) => ({
            id: p.id,
            full_name: p.display_name || "Unknown User",
            points: p.points || 0,
            rank: i + 1,
        }));
    }

    const since = periodStart(period)!;

    const { data: reports, error: reportsError } = await supabase
        .from("parking_reports")
        .select("user_id, action_type")
        .gte("created_at", since.toISOString())
        .not("user_id", "is", null);

    if (reportsError) throw new Error(reportsError.message);
    if (!reports || reports.length === 0) return [];

    const pointsMap = new Map<string, number>();
    for (const r of reports) {
        if (!r.user_id) continue;
        const pts = POINTS_BY_ACTION[r.action_type as string] ?? 1;
        pointsMap.set(r.user_id, (pointsMap.get(r.user_id) ?? 0) + pts);
    }

    const userIds = [...pointsMap.keys()];
    const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);

    if (profilesError) throw new Error(profilesError.message);

    const entries = (profiles || [])
        .map((p) => ({
            id: p.id,
            full_name: p.display_name || "Unknown User",
            points: pointsMap.get(p.id) ?? 0,
        }))
        .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));

    return entries.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
}

export async function getUserRank(userId: string, period: LeaderboardPeriod = "all"): Promise<{ rank: number; points: number } | null> {
    const supabase = getSupabaseBrowserClient();

    if (period === "all") {
        const { data: userProfile, error: userError } = await supabase
            .from("profiles")
            .select("points, created_at")
            .eq("id", userId)
            .single();

        if (userError || !userProfile) return null;

        const [{ count: morePoints, error: e1 }, { count: tiebreak, error: e2 }] = await Promise.all([
            supabase
                .from("profiles")
                .select("*", { count: "exact", head: true })
                .gt("points", userProfile.points),
            supabase
                .from("profiles")
                .select("*", { count: "exact", head: true })
                .eq("points", userProfile.points)
                .lt("created_at", userProfile.created_at),
        ]);

        if (e1) throw new Error(e1.message);
        if (e2) throw new Error(e2.message);

        return { rank: (morePoints || 0) + (tiebreak || 0) + 1, points: userProfile.points || 0 };
    }

    const since = periodStart(period)!;

    const { data: reports, error: reportsError } = await supabase
        .from("parking_reports")
        .select("user_id, action_type")
        .gte("created_at", since.toISOString())
        .not("user_id", "is", null);

    if (reportsError) throw new Error(reportsError.message);
    if (!reports) return null;

    const pointsMap = new Map<string, number>();
    for (const r of reports) {
        if (!r.user_id) continue;
        const pts = POINTS_BY_ACTION[r.action_type as string] ?? 1;
        pointsMap.set(r.user_id, (pointsMap.get(r.user_id) ?? 0) + pts);
    }

    const userPoints = pointsMap.get(userId) ?? 0;

    const sorted = [...pointsMap.entries()].sort(([aId, aPts], [bId, bPts]) => bPts - aPts || aId.localeCompare(bId));
    const userIndex = sorted.findIndex(([uid]) => uid === userId);
    if (userIndex === -1) return { rank: sorted.length + 1, points: 0 };

    return { rank: userIndex + 1, points: userPoints };
}
