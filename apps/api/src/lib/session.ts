import type { Request, Response } from 'express';
import { config } from '../config';

export const SESSION_COOKIE = 'dp_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const secret = new TextEncoder().encode(config.JWT_SECRET);

// jose is ESM-only and this package compiles to CommonJS. Node caches import(), and
// unlike require() it loads ES modules on every runtime (Vercel's can't require() them).
const loadJose = () => import('jose');

export interface Session {
  userId: string;
  tenantId: string;
}

/** Signs a JWT for the user and stores it in an httpOnly cookie. */
export async function setSessionCookie(res: Response, session: Session): Promise<void> {
  const { SignJWT } = await loadJose();
  const token = await new SignJWT({ tid: session.tenantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret);

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // page JavaScript can't read it, so an XSS bug can't steal the session
    sameSite: 'lax', // not sent on cross-site POSTs, which blocks CSRF
    secure: config.NODE_ENV === 'production', // HTTPS-only outside local dev
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** The session from the request's cookie, or null if missing, expired or tampered with. */
export async function readSession(req: Request): Promise<Session | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const { jwtVerify } = await loadJose();
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string') return null;
    return { userId: payload.sub, tenantId: payload.tid };
  } catch {
    return null; // bad signature, expired, or malformed
  }
}

// Express doesn't parse cookies; this small helper saves a cookie-parser dependency.
function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
