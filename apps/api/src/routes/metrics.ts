import { Router } from 'express';
import { getIngestCounts } from '../jobs/ingest';
import { renderMetrics } from '../lib/metrics';

export const metricsRouter = Router();

// Prometheus scrape target. Like /health it lives outside /api, so the public
// Next.js proxy (which only forwards /api/*) never exposes it: it's reachable on
// the API's internal address only.
metricsRouter.get('/metrics', async (_req, res) => {
  const queueJobs = await getIngestCounts().catch(() => ({})); // queue down: still report the in-process numbers
  res.type('text/plain; version=0.0.4').send(renderMetrics(queueJobs));
});
