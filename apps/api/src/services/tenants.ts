import { pool, withTenant } from '../db/pool';
import { generateSecretKey, hashSecretKey } from '../lib/keys';

export interface Tenant {
  id: string;
  name: string;
  publicKey: string;
  allowedDomains: string[];
  hasSecretKey: boolean; // the key itself is never stored or returned again
  monthlyMessageLimit: number;
  maxDocuments: number;
  maxStorageBytes: number;
}

export const TENANT_COLUMNS = `
  id, name,
  public_key AS "publicKey",
  allowed_domains AS "allowedDomains",
  secret_key_hash IS NOT NULL AS "hasSecretKey",
  monthly_message_limit AS "monthlyMessageLimit",
  max_documents AS "maxDocuments",
  max_storage_bytes AS "maxStorageBytes"`;

export async function updateAllowedDomains(tenantId: string, domains: string[]): Promise<Tenant> {
  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query<Tenant>(
      `UPDATE tenants SET allowed_domains = $2 WHERE id = $1 RETURNING ${TENANT_COLUMNS}`,
      [tenantId, domains],
    );
    return rows[0];
  });
}

/** Creates a new secret key (replacing any old one) and returns it. The only time it's visible. */
export async function rotateSecretKey(tenantId: string): Promise<string> {
  const secretKey = generateSecretKey();
  await withTenant(tenantId, (db) =>
    db.query('UPDATE tenants SET secret_key_hash = $2 WHERE id = $1', [
      tenantId,
      hashSecretKey(secretKey),
    ]),
  );
  return secretKey;
}

export interface WidgetTenant {
  id: string;
  name: string;
  allowedDomains: string[];
}

export async function findTenantByPublicKey(publicKey: string): Promise<WidgetTenant | null> {
  if (!publicKey.startsWith('pk_')) return null;
  // System query: the public key is how we learn which tenant's widget this is.
  const { rows } = await pool.query<WidgetTenant>(
    'SELECT id, name, allowed_domains AS "allowedDomains" FROM tenants WHERE public_key = $1',
    [publicKey],
  );
  return rows[0] ?? null;
}

export async function findTenantIdBySecretKey(secretKey: string): Promise<string | null> {
  if (!secretKey.startsWith('sk_')) return null; // skip the DB for obvious garbage
  // System query: the key is how we learn which tenant is calling.
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM tenants WHERE secret_key_hash = $1',
    [hashSecretKey(secretKey)],
  );
  return rows[0]?.id ?? null;
}
