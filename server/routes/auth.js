/**
 * Login / logout / sesión / cambio de contraseña del administrador.
 * Las contraseñas se comparan contra un hash bcrypt (nunca se guardan en texto plano).
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { asyncH } = require('../utils');
const { COOKIE_NAME, cookieOptions, signToken, requireAuth } = require('../middleware/auth');

// Máximo 5 intentos fallidos por IP cada 15 minutos (frena ataques de fuerza bruta)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' }
});

// Hash "señuelo" para que el tiempo de respuesta sea igual exista o no el usuario
const DUMMY_HASH = bcrypt.hashSync('dummy-password-timing', 12);

router.post('/login', loginLimiter, asyncH(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }
  const rows = await query('SELECT id, username, password_hash FROM admins WHERE username = ?', [username.trim()]);
  const admin = rows[0];
  const ok = await bcrypt.compare(password, admin ? admin.password_hash : DUMMY_HASH);
  if (!admin || !ok) return res.status(401).json({ error: 'Credenciales incorrectas' });

  await query('UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]);
  res.cookie(COOKIE_NAME, signToken(admin), cookieOptions());
  res.json({ ok: true, username: admin.username });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ username: req.admin.username }));

router.post('/password', requireAuth, asyncH(async (req, res) => {
  const { current, next } = req.body || {};
  if (typeof next !== 'string' || next.length < 10) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 10 caracteres' });
  }
  const [admin] = await query('SELECT id, password_hash FROM admins WHERE id = ?', [req.admin.sub]);
  if (!admin || !(await bcrypt.compare(String(current || ''), admin.password_hash))) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }
  await query('UPDATE admins SET password_hash = ? WHERE id = ?', [await bcrypt.hash(next, 12), admin.id]);
  res.json({ ok: true });
}));

module.exports = router;
