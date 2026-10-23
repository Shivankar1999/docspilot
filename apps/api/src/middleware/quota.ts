import type { RequestHandler } from 'express';
import { getMonthlyMessageUsage, monthlyResetDate, planLimitError } from '../services/usage';
import { getAuth } from './auth';

/**
 * Blocks chat once the tenant's monthly message allowance is used up. A soft
 * limit: a few requests racing at the boundary can each pass, which is fine for
 * a quota (unlike documents, where the check is atomic; see services/documents.ts).
 */
export const messageQuota: RequestHandler = async (req, _res, next) => {
  const { used, limit } = await getMonthlyMessageUsage(getAuth(req).tenantId);
  if (used >= limit) {
    const resetsAt = monthlyResetDate();
    throw planLimitError(
      'messages',
      `This assistant has used all ${limit} messages included in this month's plan. It resets on ${resetsAt.toDateString()}.`,
      { used, max: limit, resetsAt: resetsAt.toISOString() },
    );
  }
  next();
};
