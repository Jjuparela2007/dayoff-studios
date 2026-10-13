/**
 * DayOff Studio — servidor principal
 *   /            → sitio público (carpeta /public)
 *   /admin       → panel de administración (carpeta /public/admin)
 *   /uploads     → archivos subidos desde el panel
 *   /api/...     → API REST
 */
require('./env');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('Define JWT_SECRET (mínimo 32 caracteres) en .env o en las variables de entorno de Vercel');
}

const app = express();
const ROOT = path.join(__dirname, '..');
app.set('trust proxy', 1); // necesario detrás de Nginx / hosting para el rate-limit por IP

/* Dominio oficial: si en Railway existe la variable PUBLIC_URL (ej. https://www.dayoffstudios.net), quien entre por
   otra dirección (…up.railway.app, o el dominio sin "www") se envía a la oficial con un 301 permanente.
   Así Google ve UNA sola dirección del sitio. Sin la variable, no se redirige nada. */
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
let PUBLIC_HOST = '';
try { PUBLIC_HOST = PUBLIC_URL ? new URL(PUBLIC_URL).host.toLowerCase() : ''; } catch { console.warn('⚠ PUBLIC_URL no es una dirección válida:', PUBLIC_URL); }
if (PUBLIC_HOST) {
  app.use((req, res, next) => {
    const host = String(req.get('host') || '').toLowerCase();
    // Solo visitas normales (GET/HEAD); en local (localhost) nunca se redirige
    if (!host || host === PUBLIC_HOST || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) || !['GET', 'HEAD'].includes(req.method)) return next();
    res.redirect(301, PUBLIC_URL + req.originalUrl);
  });
}

/* Cabeceras de seguridad. La CSP permite GSAP (cdnjs), Google Fonts,
   imágenes/videos externos por HTTPS (CDN) y tráileres de YouTube/Vimeo. */
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  // Las imágenes deben poder verse desde otros sitios (vistas previas de WhatsApp/LinkedIn, opengraph.xyz, Google Imágenes)
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // YouTube exige recibir el dominio de origen (Referer) en los videos incrustados; con "no-referrer"
  // (el valor por defecto de Helmet) muestra "Error 153". Esta política envía solo el dominio, no la URL completa.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      frameSrc: ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com'],
      connectSrc: ["'self'", 'https://api.cloudinary.com']   // subidas directas del panel a Cloudinary
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

/* API */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/public'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

/* SEO: cada página con su título/descripción/imagen + redirecciones del sitio anterior (ver seo.js) */
const seo = require('./seo');
app.get(['/', '/index.html'], seo.home);
app.use(seo.legacy);

/* Imágenes optimizadas (más livianas, en WebP y al tamaño justo): /img/<ancho>/uploads/foto.jpg */
app.use(require('./images')(ROOT));

/* Archivos estáticos (con caché larga para medios subidos: tienen nombre único) */
app.use('/uploads', express.static(path.join(ROOT, 'uploads'), { maxAge: '30d', immutable: true }));
// En desarrollo, sin caché: así cada cambio en HTML/CSS/JS se ve al recargar.
const PROD = process.env.NODE_ENV === 'production';
// Caché de archivos del sitio:
//  · HTML, JS y CSS → "no-cache": el navegador pregunta siempre si cambió (respuesta 304 instantánea si no).
//    Así una actualización publicada se ve con un F5 normal, sin Ctrl+F5.
//  · Imágenes, videos y fuentes (pesados y casi nunca cambian) → 1 día en producción.
const staticOpts = {
  extensions: ['html'], etag: true, lastModified: true,
  setHeaders(res, file) {
    if (!PROD || /\.(html|js|css|json|txt|map)$/i.test(file)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  }
};
app.use(express.static(path.join(ROOT, 'public'), staticOpts));

/* SEO: robots.txt y sitemap.xml (el mapa del sitio se arma solo con los proyectos publicados) */
app.get('/robots.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
});
app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const { query } = require('./db');
    const base = `${req.protocol}://${req.get('host')}`;
    const rows = await query('SELECT slug FROM projects WHERE published = 1 ORDER BY sort_order, id').catch(() => []);
    const urls = ['/', ...rows.map((r) => `/project/${encodeURIComponent(r.slug)}`)];
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  } catch (e) { next(e); }
});

/* Ficha de proyecto con URL propia: /project/my-film (también acepta la ruta antigua /proyecto/) → misma página, el JS abre la ficha */
app.get(['/project/:slug', '/proyecto/:slug'], seo.project);
app.get('/director/:slug', seo.director);

/* Cualquier otra dirección → página 404 propia ("Scene not found") */
app.use((req, res) => seo.notFound(req, res));

/* Manejador central de errores */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Archivo demasiado grande' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe un registro con ese nombre/slug' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
});

/* En local se arranca el servidor; en Vercel se exporta la app (index.js) y Vercel la ejecuta como función. */
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🎬 DayOff Studio en http://localhost:${PORT}`);
    console.log(`   Panel admin:    http://localhost:${PORT}/admin`);
  });
}

module.exports = app;