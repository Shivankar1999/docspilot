import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config';
import { dispatchIngest, resumeStalledIngests } from '../jobs/ingest';
import { AppError } from '../lib/errors';
import { getAuth, requireTenant } from '../middleware/auth';
import {
  createDocument,
  deleteDocument,
  listDocuments,
  setDocumentStatus,
} from '../services/documents';
import { deleteStoredFile, saveFile } from '../services/storage';

export const documentsRouter = Router();

const MAX_UPLOAD_MB = config.MAX_UPLOAD_MB;
const FILE_TYPES: Partial<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

// Memory storage: the file is small (≤ MAX_UPLOAD_MB) and we validate it before storing it.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

// Parses the multipart "file" field, turning multer's errors into our JSON error format.
const receiveFile: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(413, 'FILE_TOO_LARGE', `Files must be ${MAX_UPLOAD_MB} MB or smaller`));
    }
    if (err instanceof multer.MulterError) {
      return next(new AppError(400, 'UPLOAD_ERROR', err.message));
    }
    next(err);
  });
};

documentsRouter.get('/api/documents', requireTenant, async (req, res) => {
  const { tenantId } = getAuth(req);
  // The dashboard polls this while documents are processing, which makes it a good
  // moment to restart inline ingestions whose function died (see resumeStalledIngests).
  if (config.INGEST_MODE === 'inline') {
    await resumeStalledIngests(tenantId).catch((err) => req.log.warn({ err }, 'could not resume stalled ingests'));
  }
  res.json({ documents: await listDocuments(tenantId) });
});

// Auth runs before multer, so anonymous requests are rejected before any upload is read.
documentsRouter.post('/api/documents', requireTenant, receiveFile, async (req, res) => {
  const { tenantId } = getAuth(req);
  const file = req.file;
  if (!file) throw new AppError(400, 'NO_FILE', 'Attach a file in the "file" form field');

  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = FILE_TYPES[ext];
  if (!mimeType) throw new AppError(415, 'UNSUPPORTED_TYPE', 'Only PDF, TXT and MD files are supported');
  if (file.size === 0) throw new AppError(400, 'EMPTY_FILE', 'The file is empty');
  if (mimeType === 'application/pdf' && file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new AppError(415, 'UNSUPPORTED_TYPE', 'This file is not a valid PDF');
  }

  const id = randomUUID();
  // Built only from server-generated IDs, never the user's filename: no path traversal.
  const storagePath = `${tenantId}/${id}${ext}`;
  await saveFile(storagePath, file.buffer);

  const document = await createDocument(tenantId, {
    id,
    filename: cleanFilename(file.originalname),
    mimeType,
    sizeBytes: file.size,
    storagePath,
  }).catch(async (err) => {
    await deleteStoredFile(storagePath); // don't leave an orphaned file behind
    throw err;
  });

  try {
    await dispatchIngest({ documentId: id, tenantId });
  } catch (err) {
    req.log.error({ err }, 'could not enqueue ingestion');
    await setDocumentStatus(tenantId, id, 'failed', 'Could not start processing. Please upload again.');
    throw new AppError(503, 'QUEUE_UNAVAILABLE', 'Could not start processing. Please try again.');
  }

  // 202 Accepted: the work continues in the background; poll GET /api/documents for status.
  res.status(202).json({ document });
});

documentsRouter.delete('/api/documents/:id', requireTenant, async (req, res) => {
  const { id } = z.object({ id: z.uuid('Invalid document id') }).parse(req.params);
  const storagePath = await deleteDocument(getAuth(req).tenantId, id);
  // Another tenant's document is invisible under RLS, so it is "not found" too.
  if (!storagePath) throw new AppError(404, 'NOT_FOUND', 'Document not found');
  await deleteStoredFile(storagePath);
  res.status(204).end();
});

// Multipart filenames arrive as latin1 bytes; re-decode as UTF-8 so "résumé.pdf" survives.
function cleanFilename(raw: string): string {
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  const name = decoded.includes('�') ? raw : decoded; // already UTF-8: keep as is
  return path.basename(name).replace(/[\u0000-\u001f]/g, '').slice(0, 200);
}
