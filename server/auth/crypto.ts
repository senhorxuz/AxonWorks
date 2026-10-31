import crypto from 'node:crypto';

export function hashPassword(password: string): string {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('A senha deve ter no mínimo 8 caracteres.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1]!;
  const expectedHash = Buffer.from(parts[2]!, 'hex');
  const actualHash = crypto.scryptSync(password, salt, 64);
  if (expectedHash.length !== actualHash.length) return false;
  return crypto.timingSafeEqual(expectedHash, actualHash);
}

export function generateToken(prefix = 'axon_agt'): { rawToken: string; tokenHash: string; tokenPrefix: string } {
  const randomPart = crypto.randomBytes(24).toString('base64url');
  const rawToken = `${prefix}_${randomPart}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenPrefix = `${rawToken.slice(0, 12)}...`;
  return { rawToken, tokenHash, tokenPrefix };
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
