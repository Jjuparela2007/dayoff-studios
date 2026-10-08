/**
 * NOTICIAS DE DEMOSTRACIÓN para ver la sección News (solo para pruebas en LOCAL).
 * Los medios y festivales son INVENTADOS ("Example…", "Sample…"): no los publiques en producción.
 *   npm run demo:news              → añade 9 noticias de ejemplo
 *   npm run demo:news -- --remove  → las quita (solo las de ejemplo)
 * En producción agrega las reales desde el panel → News.
 */
require('../env');
const { pool, query } = require('../db');
const TAG = '[demo]';

const ITEMS = [
  ['award', 'Best Short Film', 'Example Film Festival', '', '', '', '2025-11-14', 0],
  ['award', 'Best Cinematography', 'Sample Awards', '', '', '', '2025-06-02', 0],
  ['festival', 'Official Selection', 'Demo International Film Festival', '', '', '', '2025-09-20', 0],
  ['festival', 'Short Film Corner', 'Example Shorts Week', '', '', '', '2024-05-18', 0],
  ['video', 'Behind the scenes: how DayOff shot its new feature', 'Sample TV', 'An interview with the team about the shoot.', '', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', '2025-10-01', 1],
  ['press', 'The independent studio betting on intimate cinema', 'Sample Magazine', '', 'https://example.com/', 'https://picsum.photos/seed/news-1/1200/750', '2025-09-12', 0],
  ['press', 'Five productions to watch this season', 'The Demo Review', '', 'https://example.com/', 'https://picsum.photos/seed/news-2/1200/750', '2025-07-03', 0],
  ['video', 'Director interview at the festival red carpet', 'Placeholder News', '', '', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', '2025-03-22', 0],
  ['press', 'A new voice in Latin American filmmaking', 'Placeholder Daily', '', 'https://example.com/', 'https://picsum.photos/seed/news-3/1200/750', '2024-12-09', 0]
];

(async () => {
  if (process.argv.includes('--remove')) {
    const r = await query('DELETE FROM news WHERE excerpt LIKE ? OR excerpt = ?', [`%${TAG}`, TAG]);
    console.log(`✔ Noticias de ejemplo eliminadas (${r.affectedRows})`);
    return pool.end();
  }
  for (const [kind, title, outlet, excerpt, url, media, date, featured] of ITEMS) {
    const isVideo = /youtube|vimeo|\.mp4/.test(media);
    await query('INSERT INTO news (kind, title, outlet, excerpt, url, image_url, video_url, published_at, featured) VALUES (?,?,?,?,?,?,?,?,?)',
      [kind, title, outlet, `${excerpt} ${TAG}`.trim(), url || null, isVideo ? null : (media || null), isVideo ? media : null, date, featured]);
  }
  console.log(`✔ ${ITEMS.length} noticias de ejemplo añadidas. Recarga el sitio y baja hasta "News".`);
  console.log('  Para quitarlas:  npm run demo:news -- --remove');
  await pool.end();
})().catch(async (e) => { console.error('✖', e.message); await pool.end(); process.exit(1); });
