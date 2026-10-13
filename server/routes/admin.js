/**
 * API del panel de administración. TODAS las rutas exigen sesión (requireAuth).
 *
 *  Textos       GET/PUT  /api/admin/settings
 *  Categorías   GET/POST /api/admin/categories      PUT/DELETE /api/admin/categories/:id
 *  Proyectos    GET/POST /api/admin/projects        GET/PUT/DELETE /api/admin/projects/:id
 *  Créditos     PUT      /api/admin/projects/:id/credits   (reemplaza la lista completa)
 *  Galería      PUT      /api/admin/projects/:id/media     (reemplaza la lista completa)
 *  News         GET/POST /api/admin/news    PUT/DELETE /api/admin/news/:id
 *  Galería del estudio  GET/PUT /api/admin/studio-photos  (PUT reemplaza la lista completa)
 *  Personas     GET/POST /api/admin/people          PUT/DELETE /api/admin/people/:id
 *  Archivos     GET/POST /api/admin/uploads         DELETE /api/admin/uploads/:id
 *               GET /api/admin/uploads/config · GET /api/admin/uploads/signature · POST /api/admin/uploads/register (Cloudinary)
 */
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool, query } = require('../db');
const { asyncH, slugify, pick, toSet } = require('../utils');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

/* ─────────────── Textos del sitio ─────────────── */

router.get('/settings', asyncH(async (req, res) => {
  const rows = await query('SELECT setting_key, setting_value FROM settings ORDER BY setting_key');
  res.json(Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])));
}));

router.put('/settings', asyncH(async (req, res) => {
  const entries = Object.entries(req.body || {}).filter(([k]) => /^[a-z0-9_]{1,80}$/.test(k));
  for (const [k, v] of entries) {
    await query(
      'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      [k, v == null ? null : String(v)]
    );
  }
  res.json({ ok: true, updated: entries.length });
}));

/* ─────────────── Categorías ─────────────── */

const CATEGORY_FIELDS = ['name', 'slug', 'description', 'cover_url', 'sort_order', 'is_gallery'];

router.get('/categories', asyncH(async (req, res) => {
  res.json(await query(
    `SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.category_id = c.id) AS project_count,
            (SELECT COUNT(*) FROM category_photos f WHERE f.category_id = c.id) AS photo_count
       FROM categories c ORDER BY c.sort_order, c.name`));
}));

// Fotos de una categoría tipo galería (PUT reemplaza la lista completa, en el orden en que llega)
router.get('/categories/:id/photos', asyncH(async (req, res) => {
  res.json(await query('SELECT * FROM category_photos WHERE category_id = ? ORDER BY sort_order, id', [req.params.id]));
}));
router.put('/categories/:id/photos', asyncH(async (req, res) => {
  const list = (Array.isArray(req.body) ? req.body : [])
    .map((r) => ({ url: String(r.url || '').trim().slice(0, 500), caption: String(r.caption || '').trim().slice(0, 300) || null }))
    .filter((r) => /^(\/uploads\/|\/media\/|https:\/\/)/i.test(r.url)).slice(0, 500);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM category_photos WHERE category_id = ?', [req.params.id]);
    for (const [i, r] of list.entries()) {
      await conn.execute('INSERT INTO category_photos (category_id, url, caption, sort_order) VALUES (?, ?, ?, ?)', [req.params.id, r.url, r.caption, i]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  res.json({ ok: true, count: list.length });
}));

router.post('/categories', asyncH(async (req, res) => {
  const data = pick(req.body, CATEGORY_FIELDS);
  if (!data.name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  data.slug = slugify(data.slug || data.name);
  const { sql, values } = toSet(data);
  const r = await query(`INSERT INTO categories SET ${sql}`, values);
  res.status(201).json({ id: r.insertId });
}));

router.put('/categories/:id', asyncH(async (req, res) => {
  const data = pick(req.body, CATEGORY_FIELDS);
  if (data.slug !== undefined || data.name) data.slug = slugify(data.slug || data.name);
  const { sql, values } = toSet(data);
  if (!sql) return res.json({ ok: true });
  await query(`UPDATE categories SET ${sql} WHERE id = ?`, [...values, req.params.id]);
  res.json({ ok: true });
}));

router.delete('/categories/:id', asyncH(async (req, res) => {
  // Los proyectos de la categoría NO se borran: quedan "sin categoría" (ON DELETE SET NULL)
  await query('DELETE FROM categories WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

/* ─────────────── Proyectos ─────────────── */

const PROJECT_FIELDS = ['category_id', 'title', 'slug', 'tagline', 'year', 'duration', 'genre', 'synopsis',
  'director', 'poster_url', 'backdrop_url', 'trailer_url', 'featured', 'published', 'sort_order'];

/* ── Director: un solo dato en dos lugares ──
   El campo "Director/a" de la ficha y el crédito de dirección (pestaña Créditos) se mantienen iguales:
   al guardar la ficha se crea/actualiza el crédito; al guardar los créditos se actualiza la ficha.
   Varios directores: "Ana Ruiz & Luis Gil" (también vale coma o " y "). */
const DIRECTOR_ROLE = /^(director|directora|direcci[oó]n|directed by|dirigida por|dirigido por)$/i;
const splitNames = (t) => String(t || '').split(/\s*(?:&|,|\sy\s|\sand\s)\s*/i).map((x) => x.trim()).filter(Boolean);

async function syncDirectorCredits(projectId, directorField) {
  const names = splitNames(directorField);
  if (!names.length) return;                       // campo vacío: no se tocan los créditos
  const credits = await query(
    `SELECT cr.id, cr.role, cr.sort_order, COALESCE(pe.name, cr.name) AS name FROM credits cr
       LEFT JOIN people pe ON pe.id = cr.person_id WHERE cr.project_id = ? ORDER BY cr.sort_order, cr.id`, [projectId]);
  const dirs = credits.filter((c) => DIRECTOR_ROLE.test(c.role));
  for (const [i, name] of names.entries()) {
    const [person] = await query('SELECT id FROM people WHERE name = ? LIMIT 1', [name]);   // si existe en Personas, se enlaza su bio
    const pid = person ? person.id : null;
    if (dirs[i]) {
      if (dirs[i].name !== name) await query('UPDATE credits SET name = ?, person_id = ? WHERE id = ?', [name, pid, dirs[i].id]);
    } else {
      // Nuevo director: justo después de los que ya había (o al principio del equipo si no había ninguno)
      const after = dirs.length ? Math.max(...dirs.map((d) => d.sort_order)) + i : -10 + i;
      await query("INSERT INTO credits (project_id, person_id, name, role, department, sort_order) VALUES (?, ?, ?, 'Director', 'equipo', ?)",
        [projectId, pid, name, after]);
    }
  }
  for (const extra of dirs.slice(names.length)) await query('DELETE FROM credits WHERE id = ?', [extra.id]);
}

const creditsOf = (projectId) => query('SELECT * FROM credits WHERE project_id = ? ORDER BY department, sort_order, id', [projectId]);

/** Guarda el slug anterior para que los enlaces viejos (/project/slug-viejo) sigan funcionando. */
async function rememberSlug(projectId, newSlug) {
  const [cur] = await query('SELECT slug FROM projects WHERE id = ?', [projectId]);
  if (!cur || !cur.slug || cur.slug === newSlug) return;
  await query('INSERT INTO project_slugs (slug, project_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE project_id = VALUES(project_id)', [cur.slug, projectId]);
  await query('DELETE FROM project_slugs WHERE slug = ?', [newSlug]);   // el slug actual nunca es "viejo"
}

router.get('/projects', asyncH(async (req, res) => {
  res.json(await query(
    `SELECT p.id, p.title, p.slug, p.year, p.poster_url, p.published, p.featured, p.category_id,
            c.name AS category_name
       FROM projects p LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.sort_order, p.year DESC, p.title`));
}));

router.get('/projects/:id', asyncH(async (req, res) => {
  const [project] = await query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'No encontrado' });
  const [credits, media] = await Promise.all([
    query('SELECT * FROM credits WHERE project_id = ? ORDER BY department, sort_order, id', [project.id]),
    query('SELECT * FROM media WHERE project_id = ? ORDER BY sort_order, id', [project.id])
  ]);
  res.json({ ...project, credits, media });
}));

router.post('/projects', asyncH(async (req, res) => {
  const data = pick(req.body, PROJECT_FIELDS);
  if (!data.title) return res.status(400).json({ error: 'El título es obligatorio' });
  data.slug = await uniqueSlug('projects', slugify(data.slug || data.title));
  const { sql, values } = toSet(data);
  const r = await query(`INSERT INTO projects SET ${sql}`, values);
  if (data.director) await syncDirectorCredits(r.insertId, data.director);
  res.status(201).json({ id: r.insertId, slug: data.slug });
}));

router.put('/projects/:id', asyncH(async (req, res) => {
  const data = pick(req.body, PROJECT_FIELDS);
  if (data.slug !== undefined || data.title) {
    data.slug = await uniqueSlug('projects', slugify(data.slug || data.title), req.params.id);
    await rememberSlug(req.params.id, data.slug);
  }
  const { sql, values } = toSet(data);
  if (sql) await query(`UPDATE projects SET ${sql} WHERE id = ?`, [...values, req.params.id]);
  if (data.director !== undefined) await syncDirectorCredits(req.params.id, data.director);
  // Se devuelven los créditos para que la pestaña Créditos del panel quede al día sin recargar
  res.json({ ok: true, slug: data.slug, credits: await creditsOf(req.params.id) });
}));

router.delete('/projects/:id', asyncH(async (req, res) => {
  await query('DELETE FROM projects WHERE id = ?', [req.params.id]); // créditos y galería se borran en cascada
  res.json({ ok: true });
}));

/** Reemplaza todos los créditos de un proyecto en una transacción. */
router.put('/projects/:id/credits', asyncH(async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  await replaceChildren('credits', req.params.id, list.map((c, i) => ({
    person_id: c.person_id || null,
    name: c.name || null,
    role: c.role || '—',
    department: ['reparto', 'artistas', 'equipo'].includes(c.department) ? c.department : 'equipo',
    sort_order: i
  })));
  // Si hay crédito(s) de dirección, la ficha toma ese nombre (si no hay ninguno, la ficha no se toca)
  const dirs = list.filter((c) => DIRECTOR_ROLE.test(String(c.role || '').trim()) && c.name).map((c) => c.name.trim());
  let director;
  if (dirs.length) {
    director = dirs.join(' & ');
    await query('UPDATE projects SET director = ? WHERE id = ?', [director, req.params.id]);
  }
  res.json({ ok: true, director, credits: await creditsOf(req.params.id) });
}));

/** Reemplaza toda la galería de un proyecto en una transacción. */
router.put('/projects/:id/media', asyncH(async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  await replaceChildren('media', req.params.id, list.filter((m) => m.url).map((m, i) => ({
    type: m.type === 'video' ? 'video' : 'image',
    url: m.url,
    caption: m.caption || null,
    sort_order: i
  })));
  res.json({ ok: true });
}));

/* ─────────────── News: prensa, premios, festivales y videos ─────────────── */

const NEWS_FIELDS = ['kind', 'title', 'outlet', 'excerpt', 'url', 'image_url', 'video_url', 'project_id',
  'published_at', 'featured', 'published', 'sort_order'];
const NEWS_KINDS = ['press', 'award', 'festival', 'video'];
const cleanNews = (body) => {
  const d = pick(body, NEWS_FIELDS);
  if (d.kind !== undefined && !NEWS_KINDS.includes(d.kind)) d.kind = 'press';
  if (d.project_id !== undefined) d.project_id = d.project_id ? Number(d.project_id) || null : null;
  if (d.published_at !== undefined && d.published_at && !/^\d{4}-\d{2}-\d{2}$/.test(d.published_at)) d.published_at = null;
  return d;
};

router.get('/news', asyncH(async (req, res) => {
  res.json(await query(`SELECT n.*, DATE_FORMAT(n.published_at, '%Y-%m-%d') AS published_at, p.title AS project_title FROM news n LEFT JOIN projects p ON p.id = n.project_id
                         ORDER BY n.published_at IS NULL, n.published_at DESC, n.sort_order, n.id DESC`));
}));

router.post('/news', asyncH(async (req, res) => {
  const data = cleanNews(req.body);
  if (!data.title) return res.status(400).json({ error: 'El título es obligatorio' });
  const { sql, values } = toSet(data);
  const r = await query(`INSERT INTO news SET ${sql}`, values);
  res.status(201).json({ id: r.insertId });
}));

router.put('/news/:id', asyncH(async (req, res) => {
  const { sql, values } = toSet(cleanNews(req.body));
  if (sql) await query(`UPDATE news SET ${sql} WHERE id = ?`, [...values, req.params.id]);
  res.json({ ok: true });
}));

router.delete('/news/:id', asyncH(async (req, res) => {
  await query('DELETE FROM news WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

/* ─────────────── Galería del estudio ("On set": videos de rodaje y detrás de cámaras) ─────────────── */

router.get('/studio-photos', asyncH(async (req, res) => {
  res.json(await query('SELECT * FROM studio_photos ORDER BY sort_order, id'));
}));

// Reemplaza la lista completa (mismo orden en que llegan)
router.put('/studio-photos', asyncH(async (req, res) => {
  const list = (Array.isArray(req.body) ? req.body : [])
    .map((r) => ({
      url: String(r.url || '').trim().slice(0, 500),
      poster_url: /^(\/uploads\/|\/media\/|https:\/\/)/i.test(String(r.poster_url || '').trim()) ? String(r.poster_url).trim().slice(0, 500) : null,
      caption: String(r.caption || '').trim().slice(0, 300) || null,
      published: +r.published ? 1 : 0
    }))
    .filter((r) => /^(\/uploads\/|\/media\/|https:\/\/)/i.test(r.url))
    .slice(0, 200);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM studio_photos');
    for (const [i, r] of list.entries()) {
      await conn.execute('INSERT INTO studio_photos (url, poster_url, caption, published, sort_order) VALUES (?, ?, ?, ?, ?)', [r.url, r.poster_url, r.caption, r.published, i]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  res.json({ ok: true, count: list.length });
}));

/* ─────────────── Personas (actores, artistas, equipo) ─────────────── */

const PEOPLE_FIELDS = ['name', 'kind', 'bio', 'photo_url'];

router.get('/people', asyncH(async (req, res) => {
  res.json(await query('SELECT * FROM people ORDER BY name'));
}));

router.post('/people', asyncH(async (req, res) => {
  const data = pick(req.body, PEOPLE_FIELDS);
  if (!data.name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const { sql, values } = toSet(data);
  const r = await query(`INSERT INTO people SET ${sql}`, values);
  res.status(201).json({ id: r.insertId });
}));

router.put('/people/:id', asyncH(async (req, res) => {
  const { sql, values } = toSet(pick(req.body, PEOPLE_FIELDS));
  if (sql) await query(`UPDATE people SET ${sql} WHERE id = ?`, [...values, req.params.id]);
  res.json({ ok: true });
}));

router.delete('/people/:id', asyncH(async (req, res) => {
  await query('DELETE FROM people WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

/* ─────────────── Subida de archivos ─────────────── */

const cloudinary = require('../cloudinary');
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
// En Vercel el disco es de solo lectura: ahí las subidas van a Cloudinary (ver server/cloudinary.js)
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* sin disco escribible */ }

// Solo formatos de imagen/video seguros. SVG se excluye a propósito (puede contener scripts).
const ALLOWED = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov'
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // Nombre aleatorio: evita colisiones y que alguien adivine o sobrescriba archivos
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ALLOWED[file.mimetype]}`)
  }),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 200) * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) cb(null, true);
    else cb(Object.assign(new Error(`Formato no permitido: ${file.mimetype}`), { status: 400 }));
  }
});

router.get('/uploads', asyncH(async (req, res) => {
  res.json(await query('SELECT * FROM uploads ORDER BY created_at DESC, id DESC'));
}));

/* ── Cloudinary: el panel pregunta cómo subir y pide una firma para cada subida ── */
router.get('/uploads/config', (req, res) => {
  res.json({ mode: cloudinary.enabled() ? 'cloudinary' : 'local' });
});

router.get('/uploads/signature', (req, res) => {
  if (!cloudinary.enabled()) return res.status(400).json({ error: 'Cloudinary no está configurado' });
  res.json(cloudinary.uploadSignature());
});

/** Registra en la biblioteca un archivo que el navegador ya subió a Cloudinary. */
router.post('/uploads/register', asyncH(async (req, res) => {
  const { url, public_id, resource_type, format, bytes, original_name } = req.body || {};
  if (!cloudinary.isOwnUrl(url) || !public_id) return res.status(400).json({ error: 'Archivo no válido' });
  if (!['image', 'video'].includes(resource_type)) return res.status(400).json({ error: 'Formato no permitido' });
  const mime = `${resource_type}/${String(format || '').toLowerCase() === 'mov' ? 'quicktime' : String(format || '').toLowerCase()}`;
  const r = await query(
    'INSERT INTO uploads (filename, original_name, mime, size_bytes, url) VALUES (?, ?, ?, ?, ?)',
    [public_id, String(original_name || public_id).slice(0, 250), mime, Number(bytes) || 0, url]);
  res.status(201).json({ id: r.insertId, url, mime, original_name });
}));

router.post('/uploads', (req, res, next) => {
  // Sin disco escribible (Vercel) y sin Cloudinary configurado no hay dónde guardar
  if (process.env.VERCEL && !cloudinary.enabled()) {
    return res.status(400).json({ error: 'En producción configura Cloudinary (CLOUDINARY_*) para poder subir archivos' });
  }
  next();
}, upload.array('files', 20), asyncH(async (req, res) => {
  const saved = [];
  for (const f of req.files || []) {
    const url = `/uploads/${f.filename}`;
    const r = await query(
      'INSERT INTO uploads (filename, original_name, mime, size_bytes, url) VALUES (?, ?, ?, ?, ?)',
      [f.filename, f.originalname, f.mimetype, f.size, url]);
    saved.push({ id: r.insertId, url, mime: f.mimetype, original_name: f.originalname });
  }
  res.status(201).json(saved);
}));

router.delete('/uploads/:id', asyncH(async (req, res) => {
  const [row] = await query('SELECT * FROM uploads WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (cloudinary.enabled() && cloudinary.isOwnUrl(row.url)) {
    // Archivo en Cloudinary
    await cloudinary.destroy(row.filename, String(row.mime).startsWith('video') ? 'video' : 'image').catch(() => {});
  } else {
    // Archivo local. path.basename impide rutas tipo "../../" aunque el nombre viniera manipulado
    const file = path.join(UPLOAD_DIR, path.basename(row.filename));
    await fs.promises.unlink(file).catch(() => {});
  }
  await query('DELETE FROM uploads WHERE id = ?', [row.id]);
  res.json({ ok: true });
}));

/* ─────────────── Helpers ─────────────── */

async function uniqueSlug(table, base, excludeId = null) {
  let slug = base, n = 2;
  // eslint-disable-next-line no-await-in-loop
  while ((await query(`SELECT id FROM ${table} WHERE slug = ? AND id <> ?`, [slug, excludeId || 0])).length) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

async function replaceChildren(table, projectId, rows) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM ${table} WHERE project_id = ?`, [projectId]);
    for (const row of rows) {
      const { sql, values } = toSet({ project_id: projectId, ...row });
      await conn.execute(`INSERT INTO ${table} SET ${sql}`, values);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = router;