// Contraseñas (scrypt), tokens de sesión y cifrado de las API keys de los usuarios (AES-256-GCM).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---------- contraseñas ----------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, n, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return crypto.timingSafeEqual(expected, got);
}

// ---------- tokens ----------

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ---------- cifrado de secretos ----------

let key = null;
function secretKey() {
  if (key) return key;
  let secret = process.env.APP_SECRET;
  if (!secret) {
    // Sin APP_SECRET se genera uno y se guarda en data/.secret (no se versiona).
    const file = path.resolve('data/.secret');
    try {
      secret = fs.readFileSync(file, 'utf8').trim();
    } catch {
      secret = crypto.randomBytes(32).toString('hex');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, secret, { mode: 0o600 });
    }
  }
  key = crypto.createHash('sha256').update(secret).digest();
  return key;
}

export function encrypt(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(blob) {
  if (!blob) return null;
  try {
    const [v, iv, tag, data] = String(blob).split(':');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null; // APP_SECRET cambió: la key guardada ya no se puede leer
  }
}

export const maskKey = (k) => (k ? `•••• ${String(k).slice(-4)}` : null);
