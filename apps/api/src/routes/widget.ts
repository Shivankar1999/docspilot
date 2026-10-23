import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { findTenantByPublicKey } from '../services/tenants';

export const widgetRouter = Router();

const ConfigQuery = z.object({ key: z.string().min(1, 'Missing widget key') });

/**
 * Public widget settings for a pk_ key. The Next.js /widget page uses the name
 * for its header, and its proxy turns allowedDomains into the CSP frame-ancestors
 * header (the same list is visible in that header anyway, so nothing secret leaks).
 */
widgetRouter.get('/api/widget/config', async (req, res) => {
  const { key } = ConfigQuery.parse(req.query);
  const tenant = await findTenantByPublicKey(key);
  if (!tenant) throw new AppError(404, 'INVALID_WIDGET_KEY', 'This chat widget is not set up correctly');
  res.json({ name: tenant.name, allowedDomains: tenant.allowedDomains });
});
