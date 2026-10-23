import type { Request, RequestHandler } from 'express';
import { config } from '../config';
import { withTenant } from '../db/pool';
import { isAllowedOrigin } from '../lib/domains';
import { AppError } from '../lib/errors';
import { readSession } from '../lib/session';
import { findTenantByPublicKey, findTenantIdBySecretKey } from '../services/tenants';

export interface AuthContext {
  tenantId: string;
  userId?: string; // only for dashboard sessions; key-based calls have no user
  via: 'session' | 'secret_key' | 'widget';
}

/** Dashboard-only routes (settings, key rotation): requires a logged-in user. */
export const requireUser: RequestHandler = async (req, _res, next) => {
  const session = await readSession(req);
  if (!session) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  setAuth(req, { tenantId: session.tenantId, userId: session.userId, via: 'session' });
  next();
};

/** Tenant data routes: accepts a session cookie OR `Authorization: Bearer sk_...`. */
export const requireTenant: RequestHandler = async (req, res, next) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return requireUser(req, res, next);

  const tenantId = await findTenantIdBySecretKey(header.slice('Bearer '.length).trim());
  if (!tenantId) throw new AppError(401, 'INVALID_API_KEY', 'Invalid API key');
  setAuth(req, { tenantId, via: 'secret_key' });
  next();
};

/**
 * Chat only: also accepts the public widget key (X-Widget-Key: pk_...) from the
 * embedded widget, restricted to the tenant's allowed domains (X-Widget-Origin).
 * A widget key can ask questions and nothing else: it never passes requireTenant.
 */
export const requireChatAuth: RequestHandler = async (req, res, next) => {
  const publicKey = req.header('x-widget-key');
  if (!publicKey) return requireTenant(req, res, next);

  const tenant = await findTenantByPublicKey(publicKey);
  if (!tenant) throw new AppError(401, 'INVALID_WIDGET_KEY', 'This chat widget is not set up correctly');
  if (!isAllowedOrigin(req.header('x-widget-origin') ?? '', tenant.allowedDomains)) {
    throw new AppError(403, 'DOMAIN_NOT_ALLOWED', 'This website is not allowed to use this chat widget');
  }
  setAuth(req, { tenantId: tenant.id, via: 'widget' });
  next();
};

export function isAdminEmail(email: string): boolean {
  return config.ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Platform-operator routes: a logged-in user whose email is listed in ADMIN_EMAILS. */
export const requireAdmin: RequestHandler[] = [
  requireUser,
  async (req, _res, next) => {
    const { tenantId, userId } = getAuth(req);
    const { rows } = await withTenant(tenantId, (db) =>
      db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]),
    );
    if (!rows[0] || !isAdminEmail(rows[0].email)) {
      throw new AppError(403, 'FORBIDDEN', 'This page is only available to platform admins');
    }
    next();
  },
];

/** Reads the auth context in a route. Throws if the route forgot its auth middleware. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  return req.auth;
}

function setAuth(req: Request, auth: AuthContext) {
  req.auth = auth;
  // Every later log line for this request (including "request completed") carries the tenant.
  req.log = req.log.child({ tenantId: auth.tenantId });
}
