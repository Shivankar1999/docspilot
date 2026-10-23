import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs before /widget renders and sets `Content-Security-Policy: frame-ancestors`
 * to the tenant's allowed domains. The browser then refuses to display the widget
 * inside any other website, which is domain restriction the server decides
 * and the browser enforces. Unknown key or no domains → 'none' (never frameable).
 */
export async function proxy(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key') ?? '';
  const res = await fetch(`${apiBase(request)}/api/widget/config?key=${encodeURIComponent(key)}`, {
    cache: 'no-store',
  }).catch(() => null);
  const widget: { allowedDomains: string[] } | null = res?.ok ? await res.json() : null;
  const ancestors = widget?.allowedDomains.length ? widget.allowedDomains.join(' ') : "'none'";

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
  return response;
}

// On Vercel, middleware can't use the service binding (API_URL), so it calls the
// public /api route on this same domain, which vercel.json sends to the API.
function apiBase(request: NextRequest): string {
  if (process.env.VERCEL) return request.nextUrl.origin;
  return process.env.API_URL ?? 'http://localhost:4000';
}

export const config = { matcher: '/widget' };
