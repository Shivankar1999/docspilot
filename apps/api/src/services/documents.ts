import type { PoolClient } from 'pg';
import { withTenant } from '../db/pool';
import { planLimitError } from './usage';

export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface DocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

const DOCUMENT_COLUMNS = `
  id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes", status, error,
  chunk_count AS "chunkCount", created_at AS "createdAt", updated_at AS "updatedAt"`;

export function listDocuments(tenantId: string): Promise<DocumentRecord[]> {
  return withTenant(tenantId, async (db) => {
    // No "WHERE tenant_id = ..." on purpose: Row-Level Security adds it inside Postgres.
    const { rows } = await db.query<DocumentRecord>(
      `SELECT ${DOCUMENT_COLUMNS} FROM documents ORDER BY created_at DESC`,
    );
    return rows;
  });
}

/** Inserts the document row, enforcing the plan's document and storage limits atomically. */
export function createDocument(
  tenantId: string,
  doc: { id: string; filename: string; mimeType: string; sizeBytes: number; storagePath: string },
): Promise<DocumentRecord> {
  return withTenant(tenantId, async (db) => {
    // Locking the tenant row makes parallel uploads take turns, so two of them
    // can't both see "one slot left" and together exceed the limit.
    const limits = await db.query<{ maxDocuments: number; maxStorageBytes: number }>(
      `SELECT max_documents AS "maxDocuments", max_storage_bytes AS "maxStorageBytes"
       FROM tenants WHERE id = $1 FOR UPDATE`,
      [tenantId],
    );
    const used = await db.query<{ documents: number; storageBytes: number }>(
      `SELECT count(*) AS documents, coalesce(sum(size_bytes), 0) AS "storageBytes" FROM documents`,
    );
    const { maxDocuments, maxStorageBytes } = limits.rows[0];
    const { documents, storageBytes } = used.rows[0];

    if (documents >= maxDocuments) {
      throw planLimitError('documents', `Your plan includes up to ${maxDocuments} documents. Delete one to upload another.`, {
        used: documents,
        max: maxDocuments,
      });
    }
    if (storageBytes + doc.sizeBytes > maxStorageBytes) {
      const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      throw planLimitError(
        'storage',
        `This upload would exceed your plan's ${mb(maxStorageBytes)} of storage (${mb(storageBytes)} used).`,
        { used: storageBytes, max: maxStorageBytes },
      );
    }

    const { rows } = await db.query<DocumentRecord>(
      `INSERT INTO documents (id, tenant_id, filename, mime_type, size_bytes, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${DOCUMENT_COLUMNS}`,
      [doc.id, tenantId, doc.filename, doc.mimeType, doc.sizeBytes, doc.storagePath],
    );
    return rows[0];
  });
}

export function setDocumentStatus(
  tenantId: string,
  documentId: string,
  status: DocumentStatus,
  error: string | null = null,
) {
  return withTenant(tenantId, (db) =>
    db.query('UPDATE documents SET status = $2, error = $3, updated_at = now() WHERE id = $1', [
      documentId,
      status,
      error,
    ]),
  );
}

/** Deletes the document (its chunks cascade). Returns its storage path, or null if not found. */
export function deleteDocument(tenantId: string, documentId: string): Promise<string | null> {
  return withTenant(tenantId, async (db) => {
    const { rows } = await db.query<{ storagePath: string }>(
      'DELETE FROM documents WHERE id = $1 RETURNING storage_path AS "storagePath"',
      [documentId],
    );
    if (rows.length === 0) return null;
    await bumpDocsVersion(db, tenantId);
    return rows[0].storagePath;
  });
}

/**
 * Call whenever the set of searchable chunks changes. The version is part of the
 * response-cache key (Phase 5), so bumping it makes old cached answers unreachable.
 */
export async function bumpDocsVersion(db: PoolClient, tenantId: string): Promise<void> {
  await db.query('UPDATE tenants SET docs_version = docs_version + 1 WHERE id = $1', [tenantId]);
}
