/**
 * Autenticación del panel admin.
 * - El token JWT viaja en una cookie httpOnly (no accesible desde JavaScript → protege contra XSS).
 * - SameSite=Strict protege contra CSRF en la mayoría de navegadores.
 */
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'dayoff_admin';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production', // en producción solo por HTTPS
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  };
}

function signToken(admin) {
  return jwt.sign(
    { sub: admin.id, username: admin.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '8h' }
  );
}

/** Middleware: deja pasar solo si hay una sesión válida. */
function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.status(401).json({ error: 'Sesión expirada' });
  }
}

module.exports = { COOKIE_NAME, cookieOptions, signToken, requireAuth };
