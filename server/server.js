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

/* Cabeceras de seguridad. La CSP permite GSAP (cdnjs), Google Fonts,
   imágenes/videos externos por HTTPS (CDN) y tráileres de YouTube/Vimeo. */
app.use(helmet({
  crossOriginEmbedderPolicy: false,
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

/* Archivos estáticos (con caché larga para medios subidos: tienen nombre único) */
app.use('/uploads', express.static(path.join(ROOT, 'uploads'), { maxAge: '30d', immutable: true }));
// En desarrollo, sin caché: así cada cambio en HTML/CSS/JS se ve al recargar.
const PROD = process.env.NODE_ENV === 'production';
const staticOpts = { extensions: ['html'], maxAge: PROD ? '1h' : 0, etag: true };
app.use(express.static(path.join(ROOT, 'public'), staticOpts));

/* Ficha de proyecto con URL propia: /project/my-film (también acepta la ruta antigua /proyecto/) → misma página, el JS abre la ficha */
app.get(['/project/:slug', '/proyecto/:slug', '/director/:slug'], (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

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