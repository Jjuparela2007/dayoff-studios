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
  const conn = await mysql.createConnection(connectionConfig({ multipleStatements: true }));
  await conn.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  await conn.end();
  await pool.end();
  console.log('✔ Tablas creadas / verificadas en', process.env.DB_NAME);
})().catch((e) => { console.error('✖', e.message); process.exit(1); });
