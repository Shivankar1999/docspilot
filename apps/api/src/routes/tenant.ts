import { Router } from 'express';
import { z } from 'zod';
import { getAuth, requireUser } from '../middleware/auth';
import { rotateSecretKey, updateAllowedDomains } from '../services/tenants';

export const tenantRouter = Router();

// A hostname (optionally with port), or a wildcard for subdomains: "*.example.com".
const Domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(:\d{1,5})?$/,
    'Use a hostname like example.com, *.example.com or localhost:3000',
  );

const UpdateTenantBody = z.object({
  allowedDomains: z.array(Domain).max(20, 'At most 20 domains'),
});

// Settings and keys are dashboard-only (requireUser): a leaked secret key
// must not be able to rotate keys or change which sites can embed the widget.
tenantRouter.patch('/api/tenant', requireUser, async (req, res) => {
  const { allowedDomains } = UpdateTenantBody.parse(req.body);
  const tenant = await updateAllowedDomains(getAuth(req).tenantId, [...new Set(allowedDomains)]);
  res.json({ tenant });
});

tenantRouter.post('/api/tenant/secret-key', requireUser, async (req, res) => {
  const secretKey = await rotateSecretKey(getAuth(req).tenantId);
  res.status(201).json({ secretKey }); // the only time the raw key is ever returned
});
