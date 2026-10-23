import { createHash, randomBytes } from 'node:crypto';

// Secret key: server-to-server use, full access to the tenant's data. Shown once, stored hashed.
export const generateSecretKey = () => `sk_${randomBytes(24).toString('base64url')}`;

// Public widget key: safe to put in a customer's HTML; restricted to allowed domains.
export const generatePublicKey = () => `pk_${randomBytes(16).toString('base64url')}`;

// Secret keys are long and random (not guessable like passwords), so a fast SHA-256
// is safe here, and being deterministic lets us find the tenant by hash in one lookup.
export const hashSecretKey = (key: string) => createHash('sha256').update(key).digest('hex');
