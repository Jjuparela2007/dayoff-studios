/**
 * API pública (solo lectura) que consume el sitio web.
 *   GET /api/site            → textos, categorías, proyectos publicados y el estreno destacado
 *   GET /api/projects/:slug  → ficha completa de un proyecto
 *   GET /api/people/:id      → biografía de una persona
 *   GET /api/founder         → perfil del fundador + su filmografía (página /director/...)
 */
const router = require('express').Router();

// Todo el contenido de la API se pide fresco en cada visita (con ETag: si no cambió, el servidor responde
// "304 sin cambios" en milisegundos y no se vuelve a descargar)
router.use((req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });
const { query } = require('../db');
const { asyncH } = require('../utils');
// Textos de ejemplo del fundador: se usan si la base de datos todavía no los tiene (sin necesidad de db:update)
const FOUNDER_DEFAULTS = require('../scripts/founder-defaults');
const withFounder = (settings) => {
  for (const [k, v] of Object.entries(FOUNDER_DEFAULTS)) if (settings[k] == null) settings[k] = v;
  return settings;
};

router.get('/site', asyncH(async (req, res) => {
  const [settingsRows, categories, projects] = await Promise.all([
    query('SELECT setting_key, setting_value FROM settings'),
    query('SELECT id, name, slug, description, cover_url FROM categories ORDER BY sort_order, name'),
    // trailer_url y preview_video (primer video de la galería) → vista previa al pasar el cursor por la obra
    query(`SELECT p.id, p.category_id, p.title, p.slug, p.tagline, p.year, p.genre, p.director, p.poster_url, p.backdrop_url,
                  p.featured, p.trailer_url,
                  (SELECT m.url FROM media m WHERE m.project_id = p.id AND m.type = 'video'
                    ORDER BY m.sort_order, m.id LIMIT 1) AS preview_video
             FROM projects p WHERE p.published = 1
            ORDER BY p.sort_order, p.year DESC, p.title`)
  ]);
  const settings = withFounder(Object.fromEntries(settingsRows.map((r) => [r.setting_key, r.setting_value])));

  // ESTRENO DESTACADO: el que se marca en el panel; si no hay ninguno, el más reciente
  // (mayor año; a igualdad, el marcado como "Destacado" y luego el primero en el orden del panel).
  const spotlightSql = `SELECT p.id, p.title, p.slug, p.tagline, p.year, p.duration, p.genre, p.director, p.synopsis,
                               p.poster_url, p.backdrop_url, p.trailer_url, c.name AS category_name
                          FROM projects p LEFT JOIN categories c ON c.id = p.category_id
                         WHERE p.published = 1`;
  let [spotlight] = settings.spotlight_project_id
    ? await query(`${spotlightSql} AND p.id = ?`, [settings.spotlight_project_id]) : [];
  if (!spotlight) [spotlight] = await query(`${spotlightSql} ORDER BY p.year DESC, p.featured DESC, p.sort_order ASC, p.created_at DESC LIMIT 1`);

  // Créditos del estreno para el bloque estilo póster de cine ("Directed by… · Starring…")
  if (spotlight) {
    spotlight.credits = await query(
      `SELECT COALESCE(pe.name, cr.name) AS name, cr.role, cr.department
         FROM credits cr LEFT JOIN people pe ON pe.id = cr.person_id
        WHERE cr.project_id = ? ORDER BY cr.department, cr.sort_order, cr.id`, [spotlight.id]);
  }

  // News (prensa, premios, festivales, videos): los publicados, primero los destacados y luego por fecha
  const news = await query(
    `SELECT n.id, n.kind, n.title, n.outlet, n.excerpt, n.url, n.image_url, n.video_url, DATE_FORMAT(n.published_at, '%Y-%m-%d') AS published_at, n.featured,
            p.slug AS project_slug, p.title AS project_title
       FROM news n LEFT JOIN projects p ON p.id = n.project_id AND p.published = 1
      WHERE n.published = 1
      ORDER BY n.featured DESC, n.published_at IS NULL, n.published_at DESC, n.sort_order, n.id DESC LIMIT 60`).catch(() => []);

  // Galería del estudio ("On set"): fotos publicadas, en el orden del panel
  const photos = await query('SELECT id, url, caption FROM studio_photos WHERE published = 1 ORDER BY sort_order, id LIMIT 60').catch(() => []);

  res.set('Cache-Control', 'no-cache');   // siempre se revisa: lo que guardes en el panel se ve al recargar (F5)
  res.json({ settings, categories, projects, spotlight: spotlight || null, news, photos });
}));

router.get('/projects/:slug', asyncH(async (req, res) => {
  const sql = `SELECT p.*, c.name AS category_name, c.slug AS category_slug
                 FROM projects p LEFT JOIN categories c ON c.id = p.category_id WHERE p.published = 1 AND `;
  let rows = await query(sql + 'p.slug = ?', [req.params.slug]);
  // Enlace viejo (el proyecto cambió de título/slug): se busca en el historial y el sitio corrige la URL
  if (!rows.length) {
    rows = await query(sql + 'p.id = (SELECT project_id FROM project_slugs WHERE slug = ?)', [req.params.slug]).catch(() => []);
  }
  if (!rows.length) return res.status(404).json({ error: 'Proyecto no encontrado' });
  const project = rows[0];

  const [credits, media] = await Promise.all([
    query(`SELECT cr.id, cr.role, cr.department, cr.person_id,
                  COALESCE(pe.name, cr.name) AS name, pe.bio, pe.photo_url
             FROM credits cr LEFT JOIN people pe ON pe.id = cr.person_id
            WHERE cr.project_id = ? ORDER BY cr.department, cr.sort_order, cr.id`, [project.id]),
    query('SELECT id, type, url, caption FROM media WHERE project_id = ? ORDER BY sort_order, id', [project.id])
  ]);
  res.json({ ...project, credits, media });
}));

/* Fundador: los textos vienen de los ajustes founder_*; la filmografía se arma sola con los proyectos
   donde figura como director o en los créditos (con su nombre exacto). Si todavía no aparece en ninguno,
   se muestran las últimas producciones del estudio. */
router.get('/founder', asyncH(async (req, res) => {
  const rows = await query("SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'founder\\_%'");
  const all = withFounder(Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value])));
  const f = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.replace('founder_', ''), v]));
  if (!f.name) return res.status(404).json({ error: 'Sin perfil de fundador' });
  const roleSql = `SELECT cr.role FROM credits cr LEFT JOIN people pe ON pe.id = cr.person_id
                    WHERE cr.project_id = p.id AND COALESCE(pe.name, cr.name) = ? ORDER BY cr.sort_order, cr.id LIMIT 1`;
  let films = await query(
    `SELECT p.title, p.slug, p.year, p.poster_url, p.backdrop_url, c.name AS category_name,
            COALESCE((${roleSql}), IF(p.director = ?, 'Director', NULL)) AS role
       FROM projects p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.published = 1 AND (p.director = ? OR EXISTS (
              SELECT 1 FROM credits cr LEFT JOIN people pe ON pe.id = cr.person_id
               WHERE cr.project_id = p.id AND COALESCE(pe.name, cr.name) = ?))
      ORDER BY p.year DESC, p.title`, [f.name, f.name, f.name, f.name]);
  let own = true;
  if (!films.length) {
    own = false;
    films = await query(
      `SELECT p.title, p.slug, p.year, p.poster_url, p.backdrop_url, c.name AS category_name, NULL AS role
         FROM projects p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.published = 1 ORDER BY p.year DESC, p.sort_order LIMIT 8`);
  }
  res.set('Cache-Control', 'no-cache');   // siempre se revisa: lo que guardes en el panel se ve al recargar (F5)
  res.json({ ...f, films, own });
}));

router.get('/people/:id', asyncH(async (req, res) => {
  const rows = await query('SELECT id, name, kind, bio, photo_url FROM people WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
  res.json(rows[0]);
}));

module.exports = router;