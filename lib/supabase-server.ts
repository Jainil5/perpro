import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { demoClient } from './demo-store';

/** DEMO_MODE=1 runs the app against the in-memory seed instead of Supabase. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

export function serverClient(): SupabaseClient {
  if (isDemoMode()) return demoClient() as unknown as SupabaseClient;
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  );
}
