import { NextResponse } from 'next/server';

import { DataConfigError } from './supabase-server';

/**
 * Shared route-handler wrapper for every endpoint that reaches Supabase.
 *
 * `serverClient()` throws `DataConfigError` when the app is pointed at Supabase
 * without credentials. Left alone that becomes an opaque 500, and the screen
 * above it shows a "failed to fetch" nobody can act on. Turning it into a 503
 * with the actual fix step is what makes `DEMO_MODE` discoverable from the UI
 * instead of only from the README.
 *
 * Anything that is NOT a configuration problem is re-thrown untouched, so real
 * failures still surface as real failures.
 */
export function withData<Args extends unknown[]>(
  run: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await run(...args);
    } catch (error) {
      if (error instanceof DataConfigError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  };
}
