import { getSupabaseBrowserClient } from "./supabaseBrowser";

export type Achievement = {
    id: string;
    name: string;
    emoji: string;
    earned: boolean;
    description: string;
};

export async function computeStreak(userId: string): Promise<number> {
    try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase
            .from("parking_reports")
            .select("created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(200);

        if (!data || data.length === 0) return 0;

        const dayMs = 86400000;

        const uniqueDays = new Set<number>(
            data.map((r) => {
                const d = new Date(r.created_at as string);
                d.setHours(0, 0, 0, 0);
                return Math.floor(d.getTime() / dayMs);
            }),
        );

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayDay = Math.floor(today.getTime() / dayMs);

        const sortedDays = [...uniqueDays].sort((a, b) => b - a);

        if (!sortedDays.length || sortedDays[0] < todayDay - 1) return 0;

        let streak = 1;
        for (let i = 1; i < sortedDays.length; i++) {
            if (sortedDays[i] === (sortedDays[i - 1] as number) - 1) {
                streak++;
            } else {
                break;
            }
        }
        return streak;
    } catch {
        return 0;
    }
}

export async function computeDistinctLots(userId: string): Promise<number> {
    try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.from("parking_reports").select("lot_name").eq("user_id", userId);
        return new Set(data?.map((r) => r.lot_name as string) ?? []).size;
    } catch {
        return 0;
    }
}

export function computeAchievements(opts: {
    totalReports: number;
    streakDays: number;
    rank: number | null;
    distinctLots: number;
}): Achievement[] {
    const { totalReports, streakDays, rank, distinctLots } = opts;
    return [
        {
            id: "first_park",
            name: "First report",
            emoji: "🚗",
            earned: totalReports >= 1,
            description: "Submit your first parking report",
        },
        {
            id: "streak_7",
            name: "7-day streak",
            emoji: "🔥",
            earned: streakDays >= 7,
            description: "Report 7 days in a row",
        },
        {
            id: "reporter_10",
            name: "Contributor",
            emoji: "📡",
            earned: totalReports >= 10,
            description: "Submit 10 reports",
        },
        {
            id: "lot_scout",
            name: "Lot scout",
            emoji: "🔭",
            earned: distinctLots >= 3,
            description: "Report from 3 different lots",
        },
        {
            id: "top_3",
            name: "Top 3",
            emoji: "🏆",
            earned: rank !== null && rank <= 3,
            description: "Reach top 3 on the leaderboard",
        },
        {
            id: "reporter_50",
            name: "Legend",
            emoji: "⭐",
            earned: totalReports >= 50,
            description: "Submit 50 reports",
        },
    ];
}

const LEVEL_THRESHOLDS = [0, 10, 25, 50, 100, 200, 500, 1000];
const LEVEL_TITLES = ["Newcomer", "Observer", "Scout", "Reporter", "Veteran", "Expert", "Ace", "Legend"];

export function computeLevel(points: number): { level: number; title: string; progress: number; currentPts: number; nextPts: number } {
    let levelIndex = 0;
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
        if (points >= (LEVEL_THRESHOLDS[i] as number)) levelIndex = i;
        else break;
    }
    const level = levelIndex + 1;
    const currentPts = LEVEL_THRESHOLDS[levelIndex] as number;
    const nextPts = LEVEL_THRESHOLDS[Math.min(levelIndex + 1, LEVEL_THRESHOLDS.length - 1)] as number;
    const progress = nextPts > currentPts ? Math.min(1, (points - currentPts) / (nextPts - currentPts)) : 1;
    const title = LEVEL_TITLES[Math.min(levelIndex, LEVEL_TITLES.length - 1)] as string;
    return { level, title, progress, currentPts, nextPts };
}
