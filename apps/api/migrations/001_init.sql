-- 001_init: core schema for DocsPilot.
-- Every table except tenants carries tenant_id, so Row-Level Security (added in 002)
-- can scope each query to one tenant.

CREATE EXTENSION IF NOT EXISTS vector;

-- A business using DocsPilot. API keys and limits live here to avoid extra tables.
CREATE TABLE tenants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  -- Only a SHA-256 hash of the secret key is stored; the raw key is shown once.
  secret_key_hash       text UNIQUE,
  -- Public widget key (pk_...). Safe to expose in HTML; restricted by allowed_domains.
  public_key            text NOT NULL UNIQUE,
  allowed_domains       text[] NOT NULL DEFAULT '{}',
  -- Bumped whenever documents change; part of the response-cache key, so
  -- stale cached answers are never served after an upload or delete.
  docs_version          integer NOT NULL DEFAULT 0,
  -- Monthly plan limits (per-tenant so they can be raised individually).
  monthly_message_limit integer NOT NULL DEFAULT 1000,
  max_documents         integer NOT NULL DEFAULT 50,
  max_storage_bytes     bigint  NOT NULL DEFAULT 52428800, -- 50 MB
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Dashboard users. Each user belongs to exactly one tenant.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         text NOT NULL UNIQUE, -- stored lowercase by the app
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_tenant_idx ON users (tenant_id);

-- An uploaded file and its ingestion status.
CREATE TABLE documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   integer NOT NULL,
  storage_path text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error        text,
  chunk_count  integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_tenant_created_idx ON documents (tenant_id, created_at DESC);

-- A slice of a document's text plus its embedding (1024 dims: Voyage's default size).
CREATE TABLE chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content     text NOT NULL,
  token_count integer NOT NULL,
  embedding   vector(1024) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Safety net for idempotent ingestion: a document can never hold two chunks at one index.
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX chunks_tenant_idx ON chunks (tenant_id);
-- HNSW: approximate nearest-neighbour index. Fast, high-recall queries and,
-- unlike IVFFlat, no training step, so it works on an empty table.
CREATE INDEX chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);

-- A chat session (dashboard playground, widget visitor or API client).
CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('dashboard', 'widget', 'api')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_tenant_idx ON conversations (tenant_id, created_at DESC);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  -- [{ documentId, filename, chunkIndex }] for assistant answers.
  citations       jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

-- One row per metered operation: a chat answer or a document ingestion.
CREATE TABLE usage_events (
  id               bigserial PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('chat', 'ingest')),
  model            text,
  input_tokens     integer NOT NULL DEFAULT 0,
  output_tokens    integer NOT NULL DEFAULT 0,
  embedding_tokens integer NOT NULL DEFAULT 0,
  cost_usd         numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms       integer,
  cache_hit        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_tenant_created_idx ON usage_events (tenant_id, created_at);
