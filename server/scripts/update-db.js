/**
 * Actualiza una base de datos YA EXISTENTE sin borrar tu contenido:
 * añade los ajustes nuevos que falten (showreel de la portada, frase de la pantalla de carga).
 * Uso: npm run db:update
 */
require('../env');
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../db');
const FOUNDER = require('./founder-defaults');

const DEMO_REEL = JSON.stringify([1, 2, 3, 4].map((n) => `/media/reel-${n}.mp4`));

(async () => {
  const [row] = await query("SELECT setting_value FROM settings WHERE setting_key = 'hero_videos'");
  const current = row ? row.setting_value : null;
  // Se escribe la demo si no hay videos o si quedaron los enlaces de ejemplo externos de la versión anterior
  if (!current || current === '[]' || current.includes('gtv-videos-bucket')) {
    await query(
      'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      ['hero_videos', DEMO_REEL]);
    console.log('✔ hero_videos: clips de demostración locales');
  } else console.log('· hero_videos ya tiene tus videos (no se toca)');

  // Clips 4K de "npm run demo:clips" (public/media/showreel-NN.mp4): si existen y la portada todavía
  // tiene los clips de ejemplo básicos, se usan esos en su lugar (3 s por clip). Tus videos propios no se tocan.
  const MEDIA = path.join(__dirname, '..', '..', 'public', 'media');
  const reel4k = (fs.existsSync(MEDIA) ? fs.readdirSync(MEDIA) : []).filter((f) => /^showreel-\d+\.mp4$/.test(f)).sort().map((f) => `/media/${f}`);
  const [now] = await query("SELECT setting_value FROM settings WHERE setting_key = 'hero_videos'");
  if (reel4k.length && (!now || [DEMO_REEL, '[]', ''].includes(now.setting_value))) {
    const up = 'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)';
    await query(up, ['hero_videos', JSON.stringify(reel4k)]);
    await query(up, ['hero_clip_seconds', '3']);
    console.log(`✔ hero_videos: ${reel4k.length} clips 4K de public/media`);
  }

  for (const [k, v] of [['hero_clip_seconds', '7'], ['preloader_tagline', 'SHOW YOURSELF'],
    // Redes nuevas del footer (con enlaces genéricos: cámbialos en el panel o déjalos vacíos para ocultarlas)
    ['facebook_url', 'https://facebook.com/'], ['linkedin_url', 'https://linkedin.com/'],
    ['x_url', 'https://x.com/'], ['tiktok_url', 'https://tiktok.com/'],
    // Perfil del fundador (sección The studio + su página propia)
    ...Object.entries(FOUNDER)]) {
    const r = await query('INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)', [k, v]);
    console.log(r.affectedRows ? `✔ ${k} añadido` : `· ${k} ya existía`);
  }
  await pool.end();
})().catch(async (e) => { console.error('✖', e.message); await pool.end(); process.exit(1); });