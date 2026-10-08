# Publicar DayOff Studios en Railway

Todo en un solo lugar: el sitio, el panel, la base de datos MySQL y los archivos que subas.
No hace falta Aiven ni Cloudinary, ni correr comandos desde tu computador.

## 1. Crea el proyecto
1. Entra a **railway.com** → inicia sesión con tu cuenta de GitHub.
2. **New Project → Deploy from GitHub repo** → elige tu repositorio (p. ej. `dayoff-studios-web`).
   Railway detecta el `Dockerfile` y empieza a construir. El primer intento fallará porque aún no hay base de datos: es normal.

## 2. Añade la base de datos
1. En el lienzo del proyecto: **+ Create → Database → MySQL**.
2. Espera a que quede en verde.

## 3. Variables del sitio
Clic en el servicio del sitio (el de tu repo) → **Variables** → **New Variable** (o *Raw Editor* y pega todo):

```
DATABASE_URL=${{MySQL.MYSQL_URL}}
NODE_ENV=production
JWT_SECRET=pega_aqui_un_secreto_largo
ADMIN_USER=admin
ADMIN_PASSWORD=una_clave_segura_de_10_o_mas
SEED_DEMO=true
```

- `JWT_SECRET`: genéralo en tu terminal con
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `SEED_DEMO=true` carga el contenido de ejemplo **solo la primera vez** (si la base está vacía). Quítalo si prefieres empezar en blanco.
- El administrador se crea solo en el primer arranque. Si luego cambias `ADMIN_PASSWORD`, **no** se cambia la clave existente (cámbiala desde tu computador o pídemelo).

## 4. Disco para las fotos y videos que subas
Clic derecho en el servicio del sitio → **Attach Volume** → *Mount path*: **`/app/uploads`**.
(Sin esto, los archivos subidos se borrarían en cada despliegue.)

## 5. Dirección pública
Servicio del sitio → **Settings → Networking → Generate Domain**.
Te da una URL tipo `https://dayoff-studios-web.up.railway.app`. Más adelante puedes conectar el dominio propio en **Custom Domain**.

## 6. Comprueba
1. Abre la URL: cuenta 3-2-1, logo y sitio.
2. Entra a `/admin` con `ADMIN_USER` / `ADMIN_PASSWORD`.
3. Sube una imagen de prueba en la biblioteca de medios.

## Qué pasa en cada despliegue (automático)
`npm run railway:start` → crea/verifica tablas → contenido de ejemplo y primer admin (solo si faltan) →
añade ajustes nuevos sin tocar los tuyos → arranca el sitio.

## Actualizar
Cada cambio de código: **Commit + Push** en GitHub Desktop → Railway vuelve a publicar solo (1–3 min).
Textos, proyectos y videos se editan en `/admin`.

## Opcional: Cloudinary para videos pesados
El disco de Railway en el plan Hobby es de 5 GB. Si vas a subir muchos videos, añade también
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` y las subidas irán a Cloudinary.

## Si algo falla
Servicio del sitio → **Deployments → View logs**.

| Mensaje | Causa |
|---|---|
| `JWT_SECRET` | Falta o tiene menos de 32 caracteres. |
| `ECONNREFUSED` / `ENOTFOUND mysql.railway.internal` | Falta `DATABASE_URL` o la base MySQL no ha terminado de arrancar (vuelve a desplegar). |
| `No hay administrador` | Falta `ADMIN_USER` o `ADMIN_PASSWORD`. |
