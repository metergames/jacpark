import { createClient } from "@supabase/supabase-js";

export function getSupabaseBrowserClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        {
            auth: {
                // Persist session in localStorage
                storage: typeof window !== "undefined" ? window.localStorage : undefined,
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
            },
        },
    );
}
