"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type GlobalSupabase = typeof globalThis & {
    __jacparkSupabaseBrowserClient?: SupabaseClient;
};

const globalSupabase = globalThis as GlobalSupabase;

export const getSupabaseBrowserClient = (): SupabaseClient => {
    if (globalSupabase.__jacparkSupabaseBrowserClient) {
        return globalSupabase.__jacparkSupabaseBrowserClient;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error(
            "Missing Supabase browser configuration. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        );
    }

    globalSupabase.__jacparkSupabaseBrowserClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
    });

    return globalSupabase.__jacparkSupabaseBrowserClient;
};
