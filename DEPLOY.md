# Publicar DayOff Studios en producción (Vercel + Aiven + Cloudinary)

| Pieza | Servicio | Para qué |
|---|---|---|
| Sitio + API + panel | **Vercel** | Hosting. Cada `git push` publica una versión nueva. |
| Base de datos MySQL | **Aiven for MySQL** (plan Free) | Vercel no tiene MySQL. |
| Imágenes y videos subidos | **Cloudinary** (plan Free) | Vercel no guarda archivos en disco y limita cada petición a 4,5 MB. El panel sube directo a Cloudinary. |

> En local nada cambia: sin las variables `CLOUDINARY_*` las subidas van a la carpeta `uploads/`.

---

## 1. Sube el proyecto a GitHub

1. Instala **GitHub Desktop** (desktop.github.com) e inicia sesión.
2. *File → Add local repository* → elige la carpeta `dayoff-studio` → "create a repository".
3. Revisa que en la lista de cambios **NO** aparezcan `.env`, `.env.production`, `ca.pem` ni `uploads/` (el `.gitignore` los excluye).
4. *Commit to main* → **Publish repository** (deja marcado "Keep this code private").

## 2. Base de datos en Aiven

1. Crea una cuenta en **aiven.io** (plan gratuito, sin tarjeta).
2. *Create service* → **MySQL** → plan **Free** → elige una región cercana (p. ej. us-east) → *Create*.
3. Espera a que el estado sea **Running**.
4. En *Overview → Connection information* copia: **Host, Port, User, Password, Database** (`defaultdb`).
5. Descarga el **CA certificate** y guárdalo como `ca.pem` en la raíz del proyecto (al lado de `package.json`).

> El plan gratuito puede apagarse tras un tiempo sin uso (Aiven avisa antes). Para el sitio final del cliente conviene un plan de pago.

## 3. Prepara la base de datos desde tu computador

1. Copia `.env.production.example` como **`.env.production`** y rellena:
   - `JWT_SECRET` → genera uno **nuevo**:
     `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=defaultdb`, `DB_SSL=true`, `DB_SSL_CA_FILE=ca.pem`
   - `ADMIN_USER` y `ADMIN_PASSWORD` (una clave distinta a la de local)
2. En la terminal:
   ```bash
   npm run prod:db:init         # crea las tablas
   npm run prod:db:seed         # (opcional) carga el contenido demo en inglés
   npm run prod:admin:create    # crea tu usuario administrador
   ```

## 4. Cloudinary

1. Crea una cuenta gratuita en **cloudinary.com**.
2. *Dashboard → API Keys*: copia **Cloud name**, **API Key** y **API Secret**.
3. Ponlos en `.env.production` (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`).

## 5. Publica en Vercel

1. Crea una cuenta en **vercel.com** con tu GitHub.
2. *Add New → Project* → importa el repositorio `dayoff-studio`. Vercel detecta Express solo.
3. Abre **Environment Variables** y añade (copiando de `.env.production`):

   | Variable | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | el secreto nuevo |
   | `DB_HOST` · `DB_PORT` · `DB_USER` · `DB_PASSWORD` · `DB_NAME` | los de Aiven |
   | `DB_SSL` | `true` |
   | `DB_SSL_CA` | **el contenido completo** de `ca.pem` (desde `-----BEGIN CERTIFICATE-----` hasta `-----END CERTIFICATE-----`) |
   | `CLOUDINARY_CLOUD_NAME` · `CLOUDINARY_API_KEY` · `CLOUDINARY_API_SECRET` | los de Cloudinary |

   > En Vercel **no** uses `DB_SSL_CA_FILE` (el `ca.pem` no se sube): usa `DB_SSL_CA` con el contenido.
4. **Deploy**. En 1–2 minutos tendrás una URL tipo `https://dayoff-studio.vercel.app`.

## 6. Comprueba que todo funciona

1. Abre la URL: debe verse el preloader, el logo y el sitio.
2. Entra a `/admin` con el usuario que creaste en el paso 3.
3. *Biblioteca de medios* → sube una imagen. Si aparece en la biblioteca, Cloudinary funciona.
4. *Textos del sitio → Portada* → sube tus clips de video → **Guardar**.
5. Abre un proyecto y prueba el tráiler.

## Actualizar el sitio después

Cada cambio que hagas en el código: *commit* + *push* en GitHub Desktop → Vercel publica solo.
El contenido (textos, proyectos, videos) se edita desde `/admin` y no requiere publicar.

## Si algo falla

Vercel → tu proyecto → **Logs** (o *Deployments → … → Functions*) muestra el error exacto.

| Error | Causa |
|---|---|
| `JWT_SECRET` | Falta la variable o tiene menos de 32 caracteres. |
| `ER_ACCESS_DENIED_ERROR` | Usuario o contraseña de Aiven mal copiados. |
| `self-signed certificate` / `certificate` | `DB_SSL_CA` vacío o incompleto: pega el certificado entero. |
| `ETIMEDOUT` / `ECONNREFUSED` | Host o puerto mal copiados, o el servicio de Aiven está apagado. |
| "Configura Cloudinary" al subir | Faltan las variables `CLOUDINARY_*` en Vercel. |

Tras cambiar variables en Vercel: *Deployments → … → Redeploy*.

## Notas

- Los archivos que subiste en local (carpeta `uploads/`) no existen en producción: vuelve a subirlos desde el panel publicado.
- Los videos demo de la portada (`public/media`) sí funcionan en producción.
- Para tráileres largos, mejor YouTube o Vimeo (se pegan como enlace en la ficha).
- El plan Hobby de Vercel es para uso personal/no comercial; para el sitio final de un cliente, Vercel pide el plan Pro.
