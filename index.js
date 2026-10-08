/**
 * Punto de entrada para Vercel.
 * Vercel busca un archivo index.js / server.js / app.js en la raíz que exporte la app de Express.
 * En local se sigue usando "npm run dev" (server/server.js), que arranca el servidor normalmente.
 */
module.exports = require('./server/server');
