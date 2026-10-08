# 🎬 DayOff Studio — Sitio web + Panel de administración

Sitio cinematográfico para la productora **DayOff Studio**, con panel de administración para gestionar categorías, proyectos, créditos, biografías, imágenes, videos y todos los textos del sitio.

---

## 1. Arquitectura

```
Navegador ──► Express (Node.js) ──► MySQL / MariaDB
               │
               ├── /                 Sitio público (HTML + CSS + JS vanilla + GSAP)
               ├── /proyecto/:slug   Ficha de proyecto con URL propia (compartible)
               ├── /admin            Panel de administración (SPA en JS vanilla)
               ├── /uploads          Imágenes y videos subidos desde el panel
               └── /api/...          API REST (pública de solo lectura + admin protegida)
```

| Capa | Tecnología | Por qué |
|---|---|---|
| Animaciones | **GSAP 3 + ScrollTrigger** (CDN) | Estándar de la industria para animación web: timelines, scroll fijado, parallax |
| Front-end | HTML/CSS/JS sin framework | Carga instantánea, sin build, fácil de mantener y alojar |
| Back-end | **Node.js + Express** | API ligera, sirve también los archivos estáticos |
| Base de datos | **MySQL 8 / MariaDB 10.5+** | Disponible en casi cualquier hosting |
| Seguridad | bcrypt, JWT en cookie httpOnly, Helmet (CSP), rate-limit | Ver sección 7 |
| Subidas | Multer | Validación de tipo y tamaño, nombres aleatorios |

### Estructura de archivos

```
dayoff-studio/
├── server/
│   ├── server.js            ← servidor Express (punto de entrada)
│   ├── db.js                ← pool de conexiones MySQL
│   ├── utils.js             ← slugify, helpers
│   ├── schema.sql           ← tablas de la base de datos
│   ├── middleware/auth.js   ← verificación de sesión JWT
│   ├── routes/
│   │   ├── public.js        ← GET /api/site, /api/projects/:slug
│   │   ├── auth.js          ← login, logout, cambio de contraseña
│   │   └── admin.js         ← CRUD completo + subida de archivos
│   └── scripts/
│       ├── init-db.js       ← crea las tablas
│       ├── seed.js          ← contenido de demostración
│       └── create-admin.js  ← crea/actualiza el administrador
├── public/                  ← SITIO PÚBLICO
│   ├── index.html
│   ├── css/site.css
│   ├── js/site.js           ← render + todas las animaciones
│   ├── js/logo.js           ← logo vectorial (compartido con el panel)
│   └── img/favicon.svg
├── public/admin/            ← PANEL (dentro de public/ para que Vercel lo sirva)
│   ├── index.html
│   ├── css/admin.css
│   └── js/admin.js
├── uploads/                 ← archivos subidos (no se versiona)
├── .env.example
├── Dockerfile / docker-compose.yml
└── package.json
```

### Modelo de datos

- **settings** — textos editables (eslogan, hero, estudio, contacto, redes, logo).
- **categories** — Largometrajes, Cortometrajes, Series, Comerciales, Documentales… (orden configurable).
- **projects** — título, año, duración, género, director, sinopsis, póster, imagen panorámica, tráiler, destacado/publicado.
- **people** — actores, artistas y equipo con biografía y foto.
- **credits** — créditos de cada proyecto (reparto / artistas / equipo técnico), enlazados opcionalmente a una persona para mostrar su biografía.
- **media** — galería de imágenes y videos de cada proyecto.
- **uploads** — biblioteca de archivos subidos.
- **admins** — usuarios del panel (contraseña con hash bcrypt).

---

## 2. Lo que incluye el sitio

**Experiencia visual**
- Preloader tipo *film leader* (cuenta regresiva 3-2-1 con barrido) que termina dibujando el logo.
- Hero a pantalla completa con **showreel de videos en bucle infinito** (fundido cruzado entre clips, zoom lento, barras de progreso; salta automáticamente los clips que no cargan y se pausa fuera de pantalla), o imagen con efecto Ken Burns si no hay videos, franjas *letterbox* que se abren, título revelado palabra por palabra, *timecode* en vivo y HUD de cámara.
- Grano de película animado y viñeta en todo el sitio.
- Marquesina infinita con eslogan y categorías.
- "En cartelera": proyectos destacados con scroll horizontal fijado y parallax interno.
- Lista de categorías con imagen flotante que sigue al cursor.
- Galería filtrable por categoría (indicador animado, reveal escalonado, hover de blanco y negro a color con barrido de luz de proyector).
- Sección "Estudio" con parallax, reveal de imagen y contadores animados.
- Cursor personalizado con etiqueta contextual ("Ver ficha", "Reproducir", "Cerrar"…), botones magnéticos, header que se oculta al bajar.
- Cortina con el logo como transición entre la portada y las fichas.

**Ficha de proyecto** (`/proyecto/nombre-del-proyecto`)
- Portada con póster, título animado, frase, categoría y año.
- Ficha técnica: dirección, año, duración, género.
- Sinopsis con letra capitular.
- Tráiler (YouTube, Vimeo o .mp4) que solo se carga al pulsar "play".
- Créditos por departamento; los nombres enlazados abren la **biografía con foto**.
- Galería en mosaico con visor (flechas del teclado, Esc) y videos que se reproducen al pasar el ratón.
- Enlace "Siguiente proyecto". Botón atrás del navegador y Esc funcionan.

**Accesibilidad y rendimiento**: respeta `prefers-reduced-motion`, navegación por teclado, imágenes *lazy*, y si GSAP no carga el sitio funciona sin animaciones.

## 3. Lo que incluye el panel (`/admin`)

- **Login seguro** (usuario + contraseña con hash bcrypt, máx. 5 intentos fallidos / 15 min por IP).
- **Resumen** con estadísticas y últimos proyectos.
- **Textos del sitio**: nombre, eslogan, logo, **videos de portada** (subir, añadir de la biblioteca o por URL, reordenar arrastrando, segundos por clip), imagen de respaldo, estudio, cifras, contacto, redes, pie. En títulos, `*palabra*` se muestra en cursiva dorada.
- **Categorías**: crear, editar, ordenar, eliminar, imagen de portada.
- **Proyectos**: crear, editar, eliminar, publicar/ocultar, destacar; pestañas de **Créditos** (añadir, reordenar arrastrando, enlazar personas) y **Galería** (subir varios archivos, elegir de la biblioteca o pegar URL, pies de foto, reordenar).
- **Actores y artistas**: biografías y fotos.
- **Biblioteca de medios**: arrastrar y soltar, barra de progreso, copiar URL, borrar del servidor.
- **Cuenta**: cambio de contraseña.

---

## 4. Instalación local paso a paso

### Requisitos
- **Node.js 18 o superior** → `node -v`
- **MySQL 8** o **MariaDB 10.5+** (en Windows/Mac puedes usar XAMPP, MAMP, Laragon o MySQL Installer)

### Paso 1 — Instalar dependencias
```bash
cd dayoff-studio
npm install
```

### Paso 2 — Crear la base de datos y su usuario
Entra a MySQL (`mysql -u root -p`, o desde phpMyAdmin → SQL) y ejecuta:
```sql
CREATE DATABASE dayoff_studio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'dayoff'@'localhost' IDENTIFIED BY 'una_clave_segura';
GRANT ALL PRIVILEGES ON dayoff_studio.* TO 'dayoff'@'localhost';
FLUSH PRIVILEGES;
```

### Paso 3 — Configurar variables de entorno
```bash
cp .env.example .env
```
Edita `.env`:
- `DB_PASSWORD` → la clave del paso 2.
- `JWT_SECRET` → genera uno con:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `ADMIN_USER` / `ADMIN_PASSWORD` → credenciales del primer administrador (mín. 10 caracteres).

### Paso 4 — Crear tablas, contenido demo y administrador
```bash
npm run db:init        # crea las tablas
npm run db:seed        # (opcional) 5 categorías, 10 proyectos, 8 personas de ejemplo
npm run admin:create   # crea el administrador definido en .env
```
> Si ya tenías la base creada con una versión anterior, ejecuta `npm run db:update`: añade los ajustes nuevos (videos de portada) sin borrar nada.
>
> ⚠ `db:seed` borra el contenido existente (no los administradores ni los archivos). Úsalo solo al empezar.

### Paso 5 — Arrancar
```bash
npm run dev     # desarrollo (se reinicia al guardar cambios)
# o
npm start       # producción
```
- Sitio: **http://localhost:3000**
- Panel: **http://localhost:3000/admin**

Tras entrar por primera vez, cambia la contraseña en **Cuenta** y borra `ADMIN_PASSWORD` del `.env`.

### Alternativa con Docker
```bash
cp .env.example .env    # ajusta las claves
docker compose up -d --build
docker compose exec app npm run db:seed      # opcional
docker compose exec app npm run admin:create
```

---

### Clips de demostración en 4K para la portada (solo local)

```bash
npm run demo:clips
```
Genera clips de **3 segundos en 4K** (y una versión 1080p que la portada usa sola en móviles) a partir de:
- **Películas abiertas de Blender** (licencia Creative Commons BY: libres de usar dando crédito; ver `public/media/CREDITS.txt`), leídas por internet sin descargar el archivo completo.
- **Cualquier video que pongas en la carpeta `media-sources/`** (cortos, material de la productora…).

Opciones: `-- --count 8` (número de clips) · `-- --local` (solo `media-sources/`) · `-- --url <enlace .mp4>` (otra fuente).
Los clips no se suben a GitHub ni a Vercel (`.gitignore`). En producción, sube el material real desde el panel.
> No uses fragmentos de tráileres de películas comerciales: tienen derechos de autor aunque sean pocos segundos.

---

## 5. Puesta en producción

> **Vercel:** sigue la guía paso a paso de [`DEPLOY.md`](DEPLOY.md) (Vercel + Aiven MySQL + Cloudinary).


### Opción A — VPS (DigitalOcean, Hetzner, Hostinger VPS, AWS Lightsail…) — recomendada
1. Instala Node 20, MySQL y Nginx en el servidor.
2. Sube el proyecto (git o SFTP), luego `npm ci --omit=dev`, y repite los pasos 2–4 con `NODE_ENV=production` en `.env`.
3. Mantén la app viva con **PM2**:
   ```bash
   npm i -g pm2
   pm2 start server/server.js --name dayoff
   pm2 save && pm2 startup
   ```
4. Nginx como proxy inverso (`/etc/nginx/sites-available/dayoff`):
   ```nginx
   server {
     server_name dayoffstudio.com www.dayoffstudio.com;
     client_max_body_size 200M;            # igual a MAX_UPLOAD_MB
     location /uploads/ {                   # Nginx sirve los medios directamente (más rápido)
       alias /var/www/dayoff-studio/uploads/;
       expires 30d; add_header Cache-Control "public, immutable";
     }
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
5. HTTPS gratis con Let's Encrypt: `sudo certbot --nginx -d dayoffstudio.com -d www.dayoffstudio.com`.
   Con `NODE_ENV=production` la cookie de sesión solo viaja por HTTPS.

### Opción B — PaaS (Railway, Render, Fly.io)
Funciona con el `Dockerfile` incluido y una base MySQL gestionada. **Importante**: en estas plataformas el disco suele ser efímero, así que las subidas deben ir a un almacenamiento externo (ver sección 6) o a un volumen persistente.

---

## 6. Recomendaciones para alojar videos e imágenes

El panel acepta **archivos subidos** y **URLs externas** en todos los campos de medios, así que puedes combinar ambos.

**Videos (lo más importante)**
| Uso | Recomendación |
|---|---|
| Tráileres | **Vimeo** (Plus/Pro: sin publicidad, sin logos, privacidad por dominio) o **YouTube** (gratis). Pega el enlace en "Tráiler"; el sitio lo convierte en reproductor. |
| Videos de portada (showreel) | Varios clips **MP4 (H.264)** cortos: 5–15 s cada uno, 1920×1080, sin audio, **4–6 Mbps, idealmente < 10 MB por clip**. Mientras se ve un clip se precarga solo el siguiente, así que el peso total no importa tanto como el de cada clip. |
| Catálogo grande de video propio | **Bunny Stream**, **Cloudflare Stream** o **Mux**: streaming adaptativo (HLS), CDN global y precio por uso. |

Comprimir el video del hero con FFmpeg:
```bash
ffmpeg -i hero_original.mov -ss 00:00:05 -t 8 -vf "scale=1920:-2,fps=24" -c:v libx264 -crf 26 -preset slow -an -movflags +faststart hero.mp4
```

**Imágenes**
- Formato **WebP** o **AVIF** (30–50 % más ligeras que JPG). Herramienta gratuita: [Squoosh](https://squoosh.app).
- Tamaños sugeridos: póster **1000×1500**, panorámica/galería **1920×1080**, fotos de personas **900×1200**. Calidad 75–80.
- Para muchas imágenes, usa un CDN: **Cloudflare** delante del dominio (gratis), o **Bunny CDN / Cloudinary / ImageKit** si quieres redimensionado automático. Sube allí y pega la URL en el panel.

**Almacenamiento escalable**: si el volumen crece, mueve `/uploads` a **Cloudflare R2**, **Bunny Storage** o **AWS S3 + CloudFront** (el cambio se concentra en la ruta de subida de `server/routes/admin.js`).

---

## 7. Seguridad implementada

- Contraseñas con **bcrypt (coste 12)**; nunca se guardan en texto plano.
- Sesión con **JWT en cookie httpOnly + SameSite=Strict** (inaccesible para JavaScript; protege contra XSS y CSRF), `Secure` en producción, caduca en 8 h.
- **Límite de intentos de login** (5 fallidos / 15 min por IP) y respuesta de tiempo constante.
- **Helmet** con Content-Security-Policy restrictiva.
- Todas las consultas SQL **parametrizadas** (sin inyección SQL); los campos que se pueden escribir están en listas blancas.
- Subidas: solo JPG, PNG, WebP, AVIF, GIF, MP4, WebM, MOV (**SVG bloqueado** por riesgo de scripts), tamaño máximo configurable, nombres aleatorios.
- Todo el texto del panel se **escapa** antes de mostrarse en el sitio; las URLs se validan (`http(s)://` o `/`).
- El panel lleva `noindex` para que no aparezca en Google.

**Antes de publicar**: cambia la contraseña del admin, usa un `JWT_SECRET` largo y único, activa HTTPS y haz copias de seguridad periódicas de la base de datos (`mysqldump`) y de la carpeta `uploads/`.

---

## 8. Personalización rápida

- **Colores y tipografías** → variables al inicio de `public/css/site.css` (`--accent`, `--bg`, `--f-display`…).
- **Logo** → súbelo desde *Textos del sitio → Logo* (PNG/WebP con fondo transparente), o edita el SVG en `public/js/logo.js`.
- **Velocidad de animaciones** → duraciones en `public/js/site.js` (funciones `heroIntro`, `scrollAnimations`, `preloader`).
- **Nuevas secciones de texto** → añade un elemento con `data-setting="mi_clave"` en `index.html` y el campo en `SETTINGS_GROUPS` de `admin/js/admin.js`.

## 9. Referencia de la API

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/site` | — | Textos, categorías y proyectos publicados |
| GET | `/api/projects/:slug` | — | Ficha completa |
| POST | `/api/auth/login` · `/logout` | — | Sesión |
| POST | `/api/auth/password` | ✔ | Cambiar contraseña |
| GET/PUT | `/api/admin/settings` | ✔ | Textos del sitio |
| GET/POST/PUT/DELETE | `/api/admin/categories[/:id]` | ✔ | Categorías |
| GET/POST/PUT/DELETE | `/api/admin/projects[/:id]` | ✔ | Proyectos |
| PUT | `/api/admin/projects/:id/credits` | ✔ | Reemplaza créditos |
| PUT | `/api/admin/projects/:id/media` | ✔ | Reemplaza galería |
| GET/POST/PUT/DELETE | `/api/admin/people[/:id]` | ✔ | Personas |
| GET/POST/DELETE | `/api/admin/uploads[/:id]` | ✔ | Biblioteca de archivos |

---

*Las imágenes del contenido demo son marcadores de posición de picsum.photos y el tráiler de ejemplo es "Big Buck Bunny" (Blender Foundation, licencia libre). Reemplázalos desde el panel con el material real de DayOff Studio.*
