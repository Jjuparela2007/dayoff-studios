/**
 * Imágenes optimizadas al vuelo:  /img/<ancho>/uploads/foto.jpg   (o /img/<ancho>/media/foto.jpg)
 *                                  /img/og/uploads/foto.jpg  → versión 1200×630 para compartir en redes
 *
 * - Reduce la foto al ancho pedido (sin agrandarla nunca) y la convierte a WebP, que pesa mucho menos que JPG/PNG.
 * - La primera vez se genera y se guarda en uploads/.cache/; las siguientes se sirve directo (y el navegador la
 *   guarda 30 días). Así una foto de 3 MB subida desde el panel se descarga en el sitio en ~100–300 KB.
 * - Solo anchos fijos (evita que alguien llene el disco pidiendo tamaños raros) y solo archivos de /uploads y /public/media.
 * - Si algo falla, se envía la imagen original: el sitio nunca se queda sin foto.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let sharp = null;
try { sharp = require('sharp'); sharp.cache(false); sharp.concurrency(1); } catch { /* sin sharp → se sirven originales */ }

const WIDTHS = [320, 480, 640, 960, 1280, 1600, 1920, 2560];
const RE = /^\/img\/(\d+|og)\/(uploads|media)\/([^?#]+\.(?:jpe?g|png|webp|avif))$/i;
// "og" = imagen para compartir el link (WhatsApp, Facebook, LinkedIn, X): recorte exacto 1200×630 en JPG,
// que es el formato que todas las redes leen sin problemas.
const OG = { width: 1200, height: 630 };
const working = new Map();   // misma imagen pedida a la vez → se genera una sola vez

module.exports = function images(root) {
  const dirs = { uploads: path.join(root, 'uploads'), media: path.join(root, 'public', 'media') };
  const cacheDir = path.join(dirs.uploads, '.cache');

  return async (req, res, next) => {
    const m = req.path.match(RE);
    if (!m) return next();
    const og = m[1].toLowerCase() === 'og';
    const w = og ? 'og' : Number(m[1]);
    if (!og && !WIDTHS.includes(w)) return res.status(400).end();
    const base = dirs[m[2].toLowerCase()];
    const file = path.normalize(path.join(base, decodeURIComponent(m[3])));
    if (!file.startsWith(base + path.sep)) return res.status(400).end();   // impide rutas tipo ../../

    let stat;
    try { stat = await fs.promises.stat(file); } catch { return res.status(404).end(); }
    const sendOriginal = () => { res.setHeader('Cache-Control', 'public, max-age=86400'); res.sendFile(file); };
    if (!sharp) return sendOriginal();

    const key = crypto.createHash('sha1').update(`${file}|${stat.mtimeMs}|${w}`).digest('hex');
    const out = path.join(cacheDir, `${key}.${og ? 'jpg' : 'webp'}`);
    try {
      if (!fs.existsSync(out)) {
        if (!working.has(out)) {
          working.set(out, (async () => {
            await fs.promises.mkdir(cacheDir, { recursive: true });
            const tmp = `${out}.${process.pid}.tmp`;
            const img = sharp(file, { failOn: 'none' }).rotate();
            if (og) await img.resize({ ...OG, fit: 'cover', position: 'attention' }).flatten({ background: '#0a0908' }).jpeg({ quality: 82, mozjpeg: true }).toFile(tmp);
            else await img.resize({ width: w, withoutEnlargement: true }).webp({ quality: 74, effort: 4 }).toFile(tmp);
            await fs.promises.rename(tmp, out);
          })().finally(() => working.delete(out)));
        }
        await working.get(out);
      }
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.type(og ? 'image/jpeg' : 'image/webp');
      res.sendFile(out);
    } catch (e) {
      console.error('✖ imagen optimizada', m[3], e.message);
      sendOriginal();
    }
  };
};