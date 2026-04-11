import { getSupabaseBrowserClient } from "./supabase";

export interface LeaderboardEntry {
    id: string;
    full_name: string;
    points: number;
    rank?: number;
}

export async function fetchLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
    try {
        const supabase = getSupabaseBrowserClient();

        // Fetch all users from profiles table, sorted by points descending (including those with 0 points)
        const { data: profiles, error: profileError } = await supabase
            .from("profiles")
            .select("id, display_name, points")
            .order("points", { ascending: false })
            .order("created_at", { ascending: true });

        if (profileError) {
            console.warn("Error fetching profiles table:", profileError);
            return [];
        }

        // Transform and add rank, limit to specified amount
        return (profiles || []).slice(0, limit).map((profile, index) => ({
            id: profile.id,
            full_name: profile.display_name || "Unknown User",
            points: profile.points || 0,
            rank: index + 1,
        }));
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        return [];
    }
}

export async function getUserRank(userId: string): Promise<{ rank: number; points: number } | null> {
    try {
        const supabase = getSupabaseBrowserClient();

        // Get the user's points
        const { data: userProfile, error: userError } = await supabase
            .from("profiles")
            .select("points")
            .eq("id", userId)
            .single();

        if (userError || !userProfile) {
            console.warn("Could not fetch user profile:", userError);
            return null;
        }

        // Count how many users have more points
        const { count, error: countError } = await supabase
            .from("profiles")
            .select("*", { count: "exact", head: true })
            .gt("points", userProfile.points);

        if (countError) {
            console.warn("Could not fetch user rank:", countError);
            return null;
        }

        return {
            rank: (count || 0) + 1,
            points: userProfile.points || 0,
        };
    } catch (error) {
        console.error("Error fetching user rank:", error);
        return null;
    }
}
