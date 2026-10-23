// Shapes returned by the API (kept in sync with apps/api/src/services).
export interface Tenant {
  id: string;
  name: string;
  publicKey: string;
  allowedDomains: string[];
  hasSecretKey: boolean;
  monthlyMessageLimit: number;
  maxDocuments: number;
  maxStorageBytes: number;
}

export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface UploadedDocument {
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

export interface Citation {
  number: number; // the [n] marker in the answer
  documentId: string;
  filename: string;
  chunkIndex: number;
  similarity: number;
}

export interface Me {
  user: { id: string; email: string; isAdmin: boolean };
  tenant: Tenant;
}

export interface UsageSummary {
  month: {
    messages: number;
    messageLimit: number;
    documents: number;
    documentLimit: number;
    storageBytes: number;
    storageLimit: number;
    costUsd: number;
    resetsAt: string;
  };
  daily: {
    date: string;
    messages: number;
    cacheHits: number;
    inputTokens: number;
    outputTokens: number;
    embeddingTokens: number;
    costUsd: number;
  }[];
}

export interface AdminOverview {
  tenants: number;
  documents: Partial<Record<DocumentStatus, number>>;
  last30Days: { messages: number; costUsd: number; cacheHitRate: number | null; p95LatencyMs: number | null };
  topTenants: { name: string; messages: number; costUsd: number }[];
  queue: Record<'waiting' | 'active' | 'delayed' | 'completed' | 'failed', number>;
  failedJobs: {
    id: string;
    documentId: string;
    filename: string | null;
    tenantName: string | null;
    reason: string;
    attempts: number | null; // null when ingestion runs inline (no queue to count attempts)
    failedAt: string | null;
  }[];
}
