import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

// scrypt is deliberately slow and memory-hard, so a stolen password table is
// expensive to brute-force. Built into Node: no bcrypt dependency needed.
const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Returns "scrypt$<salt>$<hash>". A random salt per password means equal passwords hash differently. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  // Constant-time comparison: timing must not reveal how many bytes matched.
  return timingSafeEqual(actual, expected);
}
