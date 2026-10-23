// Worker entrypoint: a separate process from the API. Slow ingestion work (PDF
// parsing, embedding calls) never blocks HTTP requests, and each side can be
// scaled on its own (e.g. more workers during a bulk upload).
import { pool } from './db/pool';
import { createIngestWorker } from './jobs/ingest';
import { logger } from './lib/logger';
import { getEmbeddingProvider } from './providers';

const embedder = getEmbeddingProvider();
const ingest = createIngestWorker(embedder);
logger.info({ embeddingModel: embedder.model }, 'worker started');

// Graceful shutdown: finish in-flight jobs before exiting, so none are left half-done.
async function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutting down');
  await ingest.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
