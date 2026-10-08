/**
 * Almacenamiento de imágenes y videos en Cloudinary (para producción en Vercel).
 *
 * Cómo funciona (subida directa y firmada):
 *  1. El panel pide una FIRMA a nuestra API (solo con sesión de administrador).
 *  2. El navegador sube el archivo DIRECTAMENTE a Cloudinary con esa firma
 *     (no pasa por Vercel, así que no aplica su límite de 4,5 MB por petición).
 *  3. El panel registra la URL resultante en nuestra base de datos.
 *  La clave secreta (API secret) nunca sale del servidor.
 *
 * Se activa definiendo CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.
 * Sin esas variables, el proyecto guarda las subidas en la carpeta /uploads (modo local).
 */
const crypto = require('crypto');

const cfg = () => ({
  cloud: process.env.CLOUDINARY_CLOUD_NAME,
  key: process.env.CLOUDINARY_API_KEY,
  secret: process.env.CLOUDINARY_API_SECRET,
  folder: process.env.CLOUDINARY_FOLDER || 'dayoff-studios'
});

const enabled = () => { const c = cfg(); return !!(c.cloud && c.key && c.secret); };

/** Firma oficial de Cloudinary: parámetros ordenados "a=1&b=2" + API secret → SHA-1. */
function sign(params, secret = cfg().secret) {
  const str = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== '')
    .sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(str + secret).digest('hex');
}

/** Datos que necesita el navegador para subir un archivo firmado. */
function uploadSignature() {
  const c = cfg();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder: c.folder, timestamp };
  return {
    cloudName: c.cloud, apiKey: c.key, folder: c.folder, timestamp,
    signature: sign(params),
    uploadUrl: `https://api.cloudinary.com/v1_1/${c.cloud}/auto/upload`
  };
}

/** ¿Es una URL de nuestra cuenta de Cloudinary? (para no aceptar URLs arbitrarias al registrar) */
function isOwnUrl(url) {
  return typeof url === 'string' && url.startsWith(`https://res.cloudinary.com/${cfg().cloud}/`);
}

/** Borra un archivo de Cloudinary (al eliminarlo desde la biblioteca del panel). */
async function destroy(publicId, resourceType = 'image') {
  const c = cfg();
  const timestamp = Math.floor(Date.now() / 1000);
  const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: c.key, signature: sign({ public_id: publicId, timestamp }) });
  const res = await fetch(`https://api.cloudinary.com/v1_1/${c.cloud}/${resourceType}/destroy`, { method: 'POST', body });
  return res.ok;
}

module.exports = { enabled, sign, uploadSignature, isOwnUrl, destroy };
