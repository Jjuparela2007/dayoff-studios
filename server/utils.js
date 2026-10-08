/** Utilidades pequeñas compartidas. */

/** "Ópera Prima: El Regreso" → "opera-prima-el-regreso" */
function slugify(text = '') {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'item';
}

/** Envuelve handlers async para que los errores lleguen al manejador central. */
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Toma solo los campos permitidos de un objeto (evita que el cliente escriba columnas no previstas). */
function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f] === '' ? null : obj[f];
  return out;
}

/** Genera "SET a = ?, b = ?" + valores, a partir de un objeto ya filtrado. */
function toSet(data) {
  const keys = Object.keys(data);
  return { sql: keys.map((k) => `\`${k}\` = ?`).join(', '), values: keys.map((k) => data[k]) };
}

module.exports = { slugify, asyncH, pick, toSet };
