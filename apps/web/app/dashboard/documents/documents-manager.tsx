'use client';

import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { ErrorMessage } from '@/components/form';
import { apiRequest } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import type { DocumentStatus, UploadedDocument } from '@/lib/types';

const POLL_MS = 2_000;
const ACCEPT = '.pdf,.txt,.md';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB); // from next.config.ts

export function DocumentsManager() {
  const [documents, setDocuments] = useState<UploadedDocument[] | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { documents } = await apiRequest<{ documents: UploadedDocument[] }>('/api/documents');
    setDocuments(documents);
  }, []);

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  // Poll only while something is still processing; stops on its own once all are done.
  const inProgress = documents?.some((d) => d.status === 'pending' || d.status === 'processing');
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => refresh().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [inProgress, refresh]);

  async function uploadFiles(files: File[]) {
    setError(null);
    for (const file of files) {
      // Checked here too: on Vercel, an oversized body is rejected before it reaches the API.
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        setError(`${file.name}: Files must be ${MAX_UPLOAD_MB} MB or smaller`);
        continue;
      }
      setUploading((names) => [...names, file.name]);
      try {
        const form = new FormData();
        form.append('file', file);
        await apiRequest('/api/documents', { method: 'POST', body: form });
      } catch (err) {
        setError(`${file.name}: ${(err as Error).message}`);
      } finally {
        setUploading((names) => names.filter((n) => n !== file.name));
      }
    }
    await refresh();
  }

  async function remove(doc: UploadedDocument) {
    if (!confirm(`Delete "${doc.filename}"? The assistant will stop using it.`)) return;
    try {
      await apiRequest(`/api/documents/${doc.id}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <DropZone onFiles={uploadFiles} busy={uploading.length > 0} />
      {uploading.length > 0 && (
        <p className="text-sm text-slate-600">Uploading {uploading.join(', ')}…</p>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {documents === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No documents yet. Upload your FAQ, help articles or product docs to get started.
        </p>
      ) : (
        <DocumentTable documents={documents} onDelete={remove} />
      )}
    </div>
  );
}

function DropZone({ onFiles, busy }: { onFiles: (files: File[]) => void; busy: boolean }) {
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    onFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed p-8 text-center transition ${
        dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-slate-400'
      } ${busy ? 'pointer-events-none opacity-60' : ''}`}
    >
      <span className="font-medium text-slate-800">Drop files here or click to upload</span>
      <span className="text-sm text-slate-500">PDF, TXT or Markdown · up to {MAX_UPLOAD_MB} MB each</span>
      <input
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = ''; // allow re-selecting the same file
        }}
      />
    </label>
  );
}

function DocumentTable({
  documents,
  onDelete,
}: {
  documents: UploadedDocument[];
  onDelete: (doc: UploadedDocument) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Chunks</th>
            <th className="px-4 py-3 font-medium">Size</th>
            <th className="px-4 py-3 font-medium">Uploaded</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {documents.map((doc) => (
            <tr key={doc.id} className="align-top">
              <td className="max-w-xs px-4 py-3">
                <p className="truncate font-medium text-slate-900">{doc.filename}</p>
                {doc.error && <p className="mt-1 text-xs text-rose-600">{doc.error}</p>}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={doc.status} />
              </td>
              <td className="px-4 py-3 text-slate-600">{doc.status === 'ready' ? doc.chunkCount : '—'}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatBytes(doc.sizeBytes)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                {new Date(doc.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => onDelete(doc)}
                  className="text-sm font-medium text-slate-500 hover:text-rose-600"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_STYLES: Record<DocumentStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  processing: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-700',
};

function StatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {(status === 'pending' || status === 'processing') && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {status}
    </span>
  );
}
