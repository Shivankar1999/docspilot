import { cookies } from 'next/headers';
import { cache } from 'react';
import type { Me } from './types';

/**
 * Server-side URL of an Express path. API_URL is the API's internal address: set in
 * Docker, injected on Vercel by the service binding in vercel.json (a base URL that
 * may end in "/", hence the trim).
 */
export function apiUrl(path: string): string {
  return (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '') + path;
}

/**
 * GET from Express inside a server component, forwarding the browser's cookie.
 * (Server components call the API directly, not via the /api rewrite.)
 * Returns null when the user isn't allowed (401/403) so pages can redirect.
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const res = await fetch(apiUrl(path), {
    headers: { cookie: (await cookies()).toString() },
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`API responded ${res.status} to ${path}`);
  return res.json();
}

/** The logged-in account. cache() dedupes it per render (layout + page share one request). */
export const getMe = cache(() => apiGet<Me>('/api/auth/me'));
