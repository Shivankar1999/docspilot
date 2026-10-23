import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { del, get, put } from '@vercel/blob';
import { config } from '../config';

// File storage behind three small functions, so callers never care where files live:
// local disk (UPLOAD_DIR, shared by the API and worker) or, on Vercel, private Blob
// storage (STORAGE_DRIVER=blob). Private blobs are only readable with the project's
// credentials, never by URL.

export async function saveFile(storagePath: string, data: Buffer): Promise<void> {
  if (config.STORAGE_DRIVER === 'blob') {
    await put(storagePath, data, { access: 'private', allowOverwrite: true });
    return;
  }
  const fullPath = resolve(storagePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
}

export async function readStoredFile(storagePath: string): Promise<Buffer> {
  if (config.STORAGE_DRIVER === 'blob') {
    const result = await get(storagePath, { access: 'private' });
    if (result?.statusCode !== 200) throw new Error(`Stored file not found: ${storagePath}`);
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  return readFile(resolve(storagePath));
}

export async function deleteStoredFile(storagePath: string): Promise<void> {
  if (config.STORAGE_DRIVER === 'blob') {
    await del(storagePath); // already gone is fine
    return;
  }
  await rm(resolve(storagePath), { force: true }); // already gone is fine
}

function resolve(storagePath: string): string {
  return path.join(config.UPLOAD_DIR, storagePath);
}
