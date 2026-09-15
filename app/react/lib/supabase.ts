import { createClient } from "@supabase/supabase-js";
// Capture before createClient consumes and clears the implicit recovery callback hash.
export const initialRecoveryRequested =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
// Offline simulation works without a configured database. Features must check this first.
export const isSupabaseConfigured = Boolean(url && key);
export const supabase = isSupabaseConfigured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
export function requireSupabase() {
  if (!supabase)
    throw new Error(
      "먼저 .env.local에 Supabase URL과 publishable key를 설정해주세요.",
    );
  return supabase;
}
