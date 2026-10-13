/**
 * Crea las tablas ejecutando server/schema.sql.
 * Uso: npm run db:init   (la base de datos DB_NAME debe existir; ver README)
 */
require('../env');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { pool, connectionConfig } = require('../db');

(async () => {
  // En la nube la base de datos puede tardar unos segundos en aceptar conexiones: se reintenta hasta ~1 minuto
  let conn;
  for (let i = 1; ; i++) {
    try { conn = await mysql.createConnection(connectionConfig({ multipleStatements: true })); break; } catch (e) {
      if (i >= 12) throw e;
      console.log(`… esperando a la base de datos (${e.code || e.message || e}), intento ${i}/12`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await conn.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  await conn.end();
  await pool.end();
  console.log('✔ Tablas creadas / verificadas en', connectionConfig().database);
})().catch((e) => { console.error('✖ No se pudo conectar a la base de datos:', e.message || e.code || String(e), '— revisa DATABASE_URL (o DB_HOST, DB_USER…) en las variables del SITIO'); process.exit(1); });