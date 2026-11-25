// Cuentas locales: registro, inicio de sesión con cookie HttpOnly y middleware de autenticación.
import crypto from 'node:crypto';
import { getDb } from './db.js';
import { hashPassword, verifyPassword, newToken, sha256 } from './security.js';
import { workspaces, importLegacyState } from './store.js';

const COOKIE = 's1_sid';
const SESSION_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const fail = (status, message) => Object.assign(new Error(message), { status });

// ---------- cookies ----------

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = process.env.COOKIE_SECURE === 'true' || req.secure;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}

// ---------- límite de intentos (en memoria) ----------

const attempts = new Map();
function rateLimit(key, max = 10, windowMs = 15 * 60 * 1000) {
  const t = Date.now();
  const list = (attempts.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= max) throw fail(429, 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.');
  list.push(t);
  attempts.set(key, list);
}

// ---------- usuarios ----------

export const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, onboarded: !!u.onboarded, activeWorkspace: u.active_workspace };
export const getUser = (id) => getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;

export function setUserField(id, field, value) {
  if (!['ai_config', 'onboarded', 'active_workspace', 'name'].includes(field)) throw new Error('Campo inválido');
  getDb().prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(value, id);
}

function createSession(req, res, userId) {
  const token = newToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  getDb().prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, new Date().toISOString(), exp);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

export function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = getDb()
    .prepare('SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .get(sha256(token));
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  return row;
}

/** Middleware: exige sesión. Las rutas /api responden 401; las páginas redirigen a /login. */
export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) {
    if (req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Tu sesión expiró. Inicia sesión de nuevo.', auth: false });
    return res.redirect('/login');
  }
  req.user = user;
  next();
}

/** Protección CSRF simple: las peticiones que modifican datos deben venir del mismo origen. */
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Origen no permitido.' });
  next();
}

export function authRoutes(app, wrap) {
  app.post('/api/auth/register', wrap(async (req, res) => {
    const { name, email, password } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    rateLimit(`reg:${req.ip}`, 20);
    if (!EMAIL_RE.test(mail)) throw fail(400, 'Ingresa un correo válido.');
    if (String(password || '').length < 8) throw fail(400, 'La contraseña debe tener al menos 8 caracteres.');
    if (!String(name || '').trim()) throw fail(400, 'Ingresa tu nombre.');
    const db = getDb();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) throw fail(409, 'Ya existe una cuenta con ese correo. Inicia sesión.');
    const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      mail,
      String(name).trim().slice(0, 80),
      hashPassword(password),
      new Date().toISOString()
    );
    // El primer usuario hereda la evaluación de la versión anterior de la app (si existía).
    const imported = first ? importLegacyState(id) : null;
    const ws = imported || workspaces.create(id, { name: 'Mi primera evaluación', ig: 1 });
    setUserField(id, 'active_workspace', ws.id);
    createSession(req, res, id);
    res.json({ user: publicUser(getUser(id)), imported: !!imported });
  }));

  app.post('/api/auth/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    rateLimit(`login:${req.ip}:${mail}`);
    const u = getDb().prepare('SELECT * FROM users WHERE email = ?').get(mail);
    if (!u || !verifyPassword(password, u.password_hash)) throw fail(401, 'Correo o contraseña incorrectos.');
    createSession(req, res, u.id);
    res.json({ user: publicUser(u) });
  }));

  app.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const u = userFromRequest(req);
    res.json({ user: publicUser(u) });
  });
}
