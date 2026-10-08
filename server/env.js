/**
 * Carga las variables de entorno.
 * - Por defecto lee el archivo .env (desarrollo local).
 * - Con "--env <archivo>" en la línea de comandos lee otro, por ejemplo .env.production:
 *     node server/scripts/init-db.js --env .env.production
 *   (así puedes preparar la base de datos de producción desde tu computador sin tocar tu .env)
 * - En Vercel no hay archivo: las variables se configuran en el panel de Vercel y ya están en process.env.
 */
const path = require('path');

const i = process.argv.indexOf('--env');
const file = i > -1 ? process.argv[i + 1] : '.env';
require('dotenv').config({ path: path.resolve(process.cwd(), file) });

if (i > -1) console.log(`· Usando variables de ${file} (${process.env.DB_HOST || 'sin DB_HOST'})`);
