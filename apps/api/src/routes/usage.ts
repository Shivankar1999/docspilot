import { Router } from 'express';
import { z } from 'zod';
import { getAuth, requireAdmin, requireUser } from '../middleware/auth';
import { getAdminOverview } from '../services/admin';
import { getUsageSummary } from '../services/usage';

export const usageRouter = Router();

const UsageQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

/** This tenant's month-to-date usage against its limits, plus a daily series for charts. */
usageRouter.get('/api/usage', requireUser, async (req, res) => {
  const { days } = UsageQuery.parse(req.query);
  res.json(await getUsageSummary(getAuth(req).tenantId, days));
});

/** Platform-wide health for operators: queue, failures, usage across tenants. */
usageRouter.get('/api/admin/overview', ...requireAdmin, async (_req, res) => {
  res.json(await getAdminOverview());
});
