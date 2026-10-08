/**
 * Actualiza la ubicación y el Instagram del estudio en la base de datos.
 * Uso: npm run db:contact        (en producción: npm run prod:db:contact)
 * También puedes cambiarlos a mano en el panel → Textos del sitio → Contacto / Redes.
 */
require('../env');
const { pool, query } = require('../db');

const VALUES = {
  contact_address: 'New York City · USA',
  instagram_url: 'https://www.instagram.com/dayoffstudios/'
};

(async () => {
  for (const [k, v] of Object.entries(VALUES)) {
    await query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [k, v]);
    console.log(`✔ ${k}: ${v}`);
  }
  await pool.end();
})().catch(async (e) => { console.error('✖', e.message); await pool.end(); process.exit(1); });
