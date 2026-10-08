/**
 * Crea (o actualiza la contraseña de) un administrador.
 *   npm run admin:create                      → usa ADMIN_USER / ADMIN_PASSWORD del .env
 *   npm run admin:create -- usuario "Clave"   → usa los argumentos
 * La contraseña se guarda como hash bcrypt (coste 12).
 */
require('../env');
const bcrypt = require('bcryptjs');
const { pool, query } = require('../db');

(async () => {
  // Argumentos opcionales (se ignora "--env <archivo>")
  const args = process.argv.slice(2).filter((a, i, arr) => a !== '--env' && arr[i - 1] !== '--env');
  const username = args[0] || process.env.ADMIN_USER;
  const password = args[1] || process.env.ADMIN_PASSWORD;
  if (!username || !password) throw new Error('Falta usuario o contraseña');
  if (password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres');

  const hash = await bcrypt.hash(password, 12);
  await query(
    'INSERT INTO admins (username, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
    [username, hash]);
  console.log(`✔ Administrador "${username}" listo. Entra en /admin`);
  await pool.end();
})().catch(async (e) => { console.error('✖', e.message); await pool.end(); process.exit(1); });
