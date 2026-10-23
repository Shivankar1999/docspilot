import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { clearSessionCookie, setSessionCookie } from '../lib/session';
import { getAuth, isAdminEmail, requireUser } from '../middleware/auth';
import { authenticate, createAccount, getAccount } from '../services/accounts';

export const authRouter = Router();

const Email = z.email('Enter a valid email address').toLowerCase();

const SignupBody = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(100),
  email: Email,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});

const LoginBody = z.object({
  email: Email,
  password: z.string().min(1, 'Password is required').max(128),
});

authRouter.post('/api/auth/signup', async (req, res) => {
  const input = SignupBody.parse(req.body);
  const user = await createAccount(input);
  await setSessionCookie(res, { userId: user.id, tenantId: user.tenantId });
  res.status(201).json({ user });
});

authRouter.post('/api/auth/login', async (req, res) => {
  const { email, password } = LoginBody.parse(req.body);
  const user = await authenticate(email, password);
  await setSessionCookie(res, { userId: user.id, tenantId: user.tenantId });
  res.json({ user });
});

authRouter.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/api/auth/me', requireUser, async (req, res) => {
  const { userId, tenantId } = getAuth(req);
  const account = userId ? await getAccount({ userId, tenantId }) : null;
  // Valid token, but the user or tenant was deleted since: treat as logged out.
  if (!account) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  res.json({ ...account, user: { ...account.user, isAdmin: isAdminEmail(account.user.email) } });
});
