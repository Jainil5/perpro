import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { demoClient } from './demo-store';

/** DEMO_MODE=1 runs the app against the in-memory seed instead of Supabase. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

/**
 * Thrown by `serverClient()` when the app is configured for Supabase but the
 * credentials are not actually there. Without it `createClient(undefined!, …)`
 * throws something opaque, the route answers a bare 500, and every Supabase
 * screen shows a "failed to fetch" that the owner cannot act on. This is the
 * difference between a setup step being documented and being discoverable.
 */
export class DataConfigError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = 'DataConfigError';
  }
}

const FIX_HINT =
  'Copy .env.example to .env.local and set DEMO_MODE=1 to run on the built-in demo ' +
  'data with no credentials, or fill in SUPABASE_URL + SUPABASE_SECRET_KEY ' +
  '(see supabase/schema.sql for the tables), then restart the server.';

/** Human message when the Supabase path cannot work, or null when it can. */
export function dataConfigProblem(): string | null {
  if (isDemoMode()) return null;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url && !secret) {
    return `No data source configured: DEMO_MODE is off and there are no Supabase credentials. ${FIX_HINT}`;
  }
  if (!url) {
    return `SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is missing. ${FIX_HINT}`;
  }
  if (!secret) {
    return `SUPABASE_SECRET_KEY is missing, so server-side writes would be rejected. ${FIX_HINT}`;
  }
  return null;
}

export function serverClient(): SupabaseClient {
  if (isDemoMode()) return demoClient() as unknown as SupabaseClient;
  const problem = dataConfigProblem();
  if (problem) throw new DataConfigError(problem);
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  );
}
