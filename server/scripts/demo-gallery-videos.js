/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  VIDEOS DE DEMOSTRACIÓN EN LAS GALERÍAS (solo para pruebas en LOCAL)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Añade 2 videos cortos a la galería de cada proyecto que todavía no tenga videos,
 *  usando los clips que ya están en public/media/ (los de "npm run demo:clips" o reel-1…4).
 *  Así puedes ver cómo se reproducen solos en la ficha del proyecto.
 *
 *  Uso:
 *    npm run demo:gallery              → añade los videos de prueba
 *    npm run demo:gallery -- --remove  → los quita (solo los de prueba; tus archivos no se tocan)
 *
 *  En producción no hace falta: sube tus videos desde el panel → Proyectos → Galería.
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('../env');
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../db');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'public', 'media');
const DEMO_CAPTION = 'Demo clip';

(async () => {
  if (process.argv.includes('--remove')) {
    const r = await query("DELETE FROM media WHERE type = 'video' AND url LIKE '/media/%' AND caption = ?", [DEMO_CAPTION]);
    console.log(`✔ Videos de prueba quitados de las galerías (${r.affectedRows}).`);
    return pool.end();
  }

  const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];
  let clips = files.filter((f) => /^showreel-\d+\.mp4$/.test(f)).sort();
  if (!clips.length) clips = files.filter((f) => /^reel-\d+\.mp4$/.test(f)).sort();
  if (!clips.length) {
    console.log('No hay clips en public/media/. Corre primero:  npm run demo:clips');
    return pool.end();
  }
  clips = clips.map((f) => `/media/${f}`);

  const projects = await query(`
    SELECT p.id, p.title FROM projects p
     WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.project_id = p.id AND m.type = 'video')
     ORDER BY p.id`);
  if (!projects.length) {
    console.log('Todos los proyectos ya tienen videos en su galería. Nada que hacer.');
    return pool.end();
  }

  let n = 0;
  for (const [i, p] of projects.entries()) {
    // Dos clips distintos por proyecto, rotando entre los disponibles; uno al principio y otro más abajo
    const a = clips[(i * 2) % clips.length], b = clips[(i * 2 + 1) % clips.length];
    await query('INSERT INTO media (project_id, type, url, caption, sort_order) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      [p.id, 'video', a, DEMO_CAPTION, 0, p.id, 'video', b, DEMO_CAPTION, 3]);
    n += 2;
    console.log(`  ▸ ${p.title}`);
  }
  console.log(`\n✔ ${n} videos de prueba añadidos a ${projects.length} galerías. Abre cualquier proyecto y baja hasta "Gallery".`);
  console.log('  Para quitarlos:  npm run demo:gallery -- --remove');
  await pool.end();
})().catch(async (e) => { console.error('✖', e.message); await pool.end(); process.exit(1); });
