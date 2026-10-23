import { pool, withTenant, withTransaction } from '../db/pool';
import { AppError } from '../lib/errors';
import { generatePublicKey } from '../lib/keys';
import { hashPassword, verifyPassword } from '../lib/passwords';
import type { Session } from '../lib/session';
import { TENANT_COLUMNS, type Tenant } from './tenants';

export interface User {
  id: string;
  email: string;
  tenantId: string;
}

// Checked when the email doesn't exist, so a failed login takes the same time
// either way and response timing can't reveal which emails have accounts.
const DUMMY_HASH = hashPassword('timing-equalizer');

/** Signup: creates a tenant and its first user together (both or neither). */
export async function createAccount(input: {
  companyName: string;
  email: string;
  password: string;
}): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  try {
    // System transaction (no RLS): the tenant doesn't exist yet.
    return await withTransaction(async (db) => {
      const tenant = await db.query<{ id: string }>(
        'INSERT INTO tenants (name, public_key) VALUES ($1, $2) RETURNING id',
        [input.companyName, generatePublicKey()],
      );
      const tenantId = tenant.rows[0].id;
      const user = await db.query<{ id: string; email: string }>(
        'INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email',
        [tenantId, input.email, passwordHash],
      );
      return { ...user.rows[0], tenantId };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    throw err;
  }
}

export async function authenticate(email: string, password: string): Promise<User> {
  // System query: at login we don't know the tenant yet.
  const { rows } = await pool.query<User & { passwordHash: string }>(
    `SELECT id, email, tenant_id AS "tenantId", password_hash AS "passwordHash"
     FROM users WHERE email = $1`,
    [email],
  );
  const user = rows.at(0);
  const valid = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !valid) {
    // Same error for "no such email" and "wrong password": don't help attackers enumerate users.
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  return { id: user.id, email: user.email, tenantId: user.tenantId };
}

/** The logged-in user and their tenant, or null if either no longer exists. */
export async function getAccount(
  session: Session,
): Promise<{ user: Omit<User, 'tenantId'>; tenant: Tenant } | null> {
  return withTenant(session.tenantId, async (db) => {
    const user = await db.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE id = $1',
      [session.userId],
    );
    const tenant = await db.query<Tenant>(`SELECT ${TENANT_COLUMNS} FROM tenants WHERE id = $1`, [
      session.tenantId,
    ]);
    const [u, t] = [user.rows.at(0), tenant.rows.at(0)];
    return u && t ? { user: u, tenant: t } : null;
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}
