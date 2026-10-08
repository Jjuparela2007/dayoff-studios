/**
 * Pasa al INGLÉS el contenido de demostración de una base de datos existente.
 * Solo cambia los textos que sigan EXACTAMENTE como en la demo en español:
 * todo lo que hayas escrito o editado tú se queda como está.
 * Uso: npm run db:english
 */
require('../env');
const { pool, query } = require('../db');
const { slugify } = require('../utils');
const T = require('./translations-en');

let changes = 0;
const log = (msg) => { changes++; console.log('✔', msg); };

(async () => {
  // 1) Textos del sitio
  for (const [key, [es, en]] of Object.entries(T.SETTINGS)) {
    const olds = key === 'footer_text' ? [es, ...T.FOOTER_OLD] : [es];
    const r = await query(`UPDATE settings SET setting_value = ? WHERE setting_key = ? AND setting_value IN (${olds.map(() => '?').join(',')})`, [en, key, ...olds]);
    if (r.affectedRows) log(`texto "${key}"`);
  }

  // 2) Categorías (por slug antiguo o por nombre en español)
  for (const cat of await query('SELECT id, name, slug, description FROM categories')) {
    const key = T.CATEGORIES[cat.slug] ? cat.slug : T.CATEGORY_NAMES_ES[cat.name];
    if (!key) continue;
    const [name, slug, descEn, descEs] = T.CATEGORIES[key];
    const desc = cat.description === descEs ? descEn : cat.description;
    if (name === cat.name && slug === cat.slug && desc === cat.description) continue;
    await query('UPDATE categories SET name = ?, slug = ?, description = ? WHERE id = ?', [name, slug, desc, cat.id]);
    log(`categoría ${cat.name} → ${name}`);
  }

  // 3) Proyectos (título, slug, frase, sinopsis, género)
  for (const p of await query('SELECT id, title, slug, tagline, synopsis, genre FROM projects')) {
    const tr = T.PROJECTS[p.title];
    const data = {};
    if (tr) {
      data.title = tr.title;
      data.slug = slugify(tr.title);
      if (tr.tagline && p.tagline === tr.tagline[0]) data.tagline = tr.tagline[1];
      if (tr.synopsis && p.synopsis === tr.synopsis[0]) data.synopsis = tr.synopsis[1];
    }
    if (T.GENRES[p.genre]) data.genre = T.GENRES[p.genre];
    if (!Object.keys(data).length) continue;
    // Evita choques de slug
    if (data.slug) {
      let base = data.slug, n = 2;
      while ((await query('SELECT id FROM projects WHERE slug = ? AND id <> ?', [data.slug, p.id])).length) data.slug = `${base}-${n++}`;
    }
    const keys = Object.keys(data);
    await query(`UPDATE projects SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => data[k]), p.id]);
    log(`proyecto ${p.title}${data.title ? ' → ' + data.title : ' (género)'}`);
  }

  // 4) Biografías
  for (const [name, [es, en]] of Object.entries(T.BIOS)) {
    const r = await query('UPDATE people SET bio = ? WHERE name = ? AND bio = ?', [en, name, es]);
    if (r.affectedRows) log(`biografía de ${name}`);
  }

  // 5) Roles en los créditos
  for (const [es, en] of Object.entries(T.ROLES)) {
    const r = await query('UPDATE credits SET role = ? WHERE role = ?', [en, es]);
    if (r.affectedRows) log(`rol "${es}" → "${en}" (${r.affectedRows})`);
  }

  // 6) Pies de foto de la galería: "Fotograma 3" → "Still 3"
  const r = await query("UPDATE media SET caption = REPLACE(caption, 'Fotograma ', 'Still ') WHERE caption LIKE 'Fotograma %'");
  if (r.affectedRows) log(`pies de foto (${r.affectedRows})`);

  console.log(changes ? `\nListo: ${changes} cambios.` : 'No había textos de demo en español: nada que cambiar.');
  console.log('Lo que hayas escrito tú en español (si hay algo) edítalo desde el panel.');
  await pool.end();
})().catch(async (e) => { console.error('✖', e.message); await pool.end(); process.exit(1); });
