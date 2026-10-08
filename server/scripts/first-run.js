/**
 * Arranque automático en Railway (o cualquier servidor con Docker). Se ejecuta en cada despliegue y es seguro repetirlo:
 *   1. Si la base está vacía y SEED_DEMO=true → carga el contenido de ejemplo (en inglés).
 *   2. Si todavía no hay ningún administrador → crea el de ADMIN_USER / ADMIN_PASSWORD.
 * Nunca borra ni sobrescribe tu contenido ni cambia contraseñas existentes.
 */
require('../env');
const path = require('path');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');
const { pool, query } = require('../db');

(async () => {
  const [{ n: projects }] = await query('SELECT COUNT(*) AS n FROM projects');
  const [{ n: settings }] = await query('SELECT COUNT(*) AS n FROM settings');
  if (!projects && !settings && String(process.env.SEED_DEMO).toLowerCase() === 'true') {
    console.log('… base vacía: cargando contenido de ejemplo');
    execFileSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit' });
  }

  const [{ n: admins }] = await query('SELECT COUNT(*) AS n FROM admins');
  const { ADMIN_USER: user, ADMIN_PASSWORD: pass } = process.env;
  if (!admins && user && pass) {
    if (pass.length < 10) console.log('⚠ ADMIN_PASSWORD debe tener al menos 10 caracteres: no se creó el administrador');
    else {
      await query('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [user, await bcrypt.hash(pass, 12)]);
      console.log(`✔ Administrador "${user}" creado`);
    }
  } else if (!admins) console.log('⚠ No hay administrador: define ADMIN_USER y ADMIN_PASSWORD y vuelve a desplegar');
  await pool.end();
})().catch(async (e) => { console.error('✖ first-run:', e.message); await pool.end(); process.exit(1); });
