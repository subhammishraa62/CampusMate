import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";

export function createClient() {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase isn't configured yet. Add the public URL and key to .env.local.");
  return createBrowserClient(config.url, config.key);
}
