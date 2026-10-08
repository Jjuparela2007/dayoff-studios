/**
 * Pool de conexiones MySQL compartido por toda la app.
 * Usa consultas preparadas (?) en todas partes para evitar inyección SQL.
 *
 * SSL (obligatorio en bases de datos en la nube como Aiven):
 *   DB_SSL=true            → conexión cifrada
 *   DB_SSL_CA="-----BEGIN CERTIFICATE-----…"   → contenido del certificado CA (recomendado en Vercel)
 *   DB_SSL_CA_FILE=ca.pem  → o la ruta al archivo del certificado (cómodo en local)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('./env');

function sslConfig() {
  if (String(process.env.DB_SSL).toLowerCase() !== 'true') return undefined;
  let ca = process.env.DB_SSL_CA;
  if (!ca && process.env.DB_SSL_CA_FILE) ca = fs.readFileSync(path.resolve(process.cwd(), process.env.DB_SSL_CA_FILE), 'utf8');
  if (ca) ca = ca.replace(/\\n/g, '\n'); // por si el certificado se pegó en una sola línea con "\n"
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
}

/** Datos de conexión (también los usa init-db.js). */
function connectionConfig(extra = {}) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    ssl: sslConfig(),
    ...extra
  };
}

// En Vercel cada instancia de la función abre pocas conexiones (el plan gratuito de Aiven admite ~75)
const pool = mysql.createPool(connectionConfig({
  waitForConnections: true,
  connectionLimit: process.env.VERCEL ? 3 : 10,
  enableKeepAlive: true
}));

/** Atajo: ejecuta una consulta y devuelve solo las filas. */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { pool, query, connectionConfig };
