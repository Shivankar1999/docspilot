-- 002_rls: Row-Level Security. Postgres itself enforces tenant isolation, so a
-- query that forgets "WHERE tenant_id = ..." still cannot see another tenant's rows.
--
-- How it works (see withTenant() in src/db/pool.ts):
--   * The API connects as the table owner, which bypasses RLS. For each
--     tenant-scoped request it opens a transaction and runs:
--         SET LOCAL ROLE docspilot_tenant;               -- drop to a restricted role
--         SELECT set_config('app.tenant_id', $1, true);  -- = SET LOCAL app.tenant_id
--   * The policies below compare each row's tenant_id with app.tenant_id.
--   * Both settings are LOCAL: they end with the transaction, so a pooled
--     connection never carries one tenant's context into the next request.

-- Roles are cluster-wide (shared by the dev and test databases), hence the guard.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'docspilot_tenant') THEN
    CREATE ROLE docspilot_tenant NOLOGIN; -- nobody can connect as it directly
  END IF;
END
$$;

-- Lets the app's user switch into the role. Implicit for superusers (local Docker),
-- required on managed Postgres where the app user is not a superuser.
GRANT docspilot_tenant TO CURRENT_USER;

-- The current transaction's tenant, or NULL when unset (so no rows match: fail closed).
-- NULLIF because after a SET LOCAL ends, the setting reads back as '' instead of NULL.
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- Least privilege: only the access the app actually needs.
GRANT USAGE ON SCHEMA public TO docspilot_tenant;
GRANT SELECT ON tenants, users TO docspilot_tenant;
-- Tenants may change their own settings, but never their own plan limits.
GRANT UPDATE (allowed_domains, secret_key_hash, docs_version) ON tenants TO docspilot_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents, chunks TO docspilot_tenant;
GRANT SELECT, INSERT ON conversations, messages, usage_events TO docspilot_tenant;
GRANT USAGE ON SEQUENCE usage_events_id_seq TO docspilot_tenant;

-- USING filters which rows are visible; WITH CHECK rejects writing rows for another tenant.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_current_tenant());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chunks
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversations
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON usage_events
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
