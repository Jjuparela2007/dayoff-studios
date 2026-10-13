/**
 * SEO del lado del servidor.
 *
 * 1) Cada página llega a Google / WhatsApp / Instagram con SU título, descripción, imagen y dirección oficial
 *    (antes todas llegaban con los mismos datos, porque el contenido se arma con JavaScript en el navegador):
 *      /                  → nombre de la marca + eslogan
 *      /project/<slug>    → "TITO (2024) — Short Film | DayOff Studios", su sinopsis y su póster
 *      /director/<slug>   → el fundador, su biografía y su foto
 *    Además se agregan "datos estructurados" (JSON-LD): la productora (Organization), sus redes y fundador,
 *    y cada película (Movie). Es lo que Google usa para el recuadro de la marca y para relacionar las películas.
 *
 * 2) Redirecciones del sitio anterior (dayoffstudios.net en Wix): /mythomania, /selva, /photo… → su página nueva,
 *    con un 301 (permanente) para que Google pase lo que ya tenía de las páginas viejas a las nuevas.
 */
const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const { slugify } = require('./utils');

const FOUNDER_DEFAULTS = require('./scripts/founder-defaults');
const INDEX = path.join(__dirname, '..', 'public', 'index.html');
const PROD = process.env.NODE_ENV === 'production';
let indexCache = null;
const readIndex = () => (PROD && indexCache) || (indexCache = fs.readFileSync(INDEX, 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const abs = (req, u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `${baseUrl(req)}${u.startsWith('/') ? '' : '/'}${u}`);
// JSON dentro de <script>: se escapa "<" para que ningún texto pueda cerrar la etiqueta
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

async function settings() {
  const rows = await query('SELECT setting_key, setting_value FROM settings').catch(() => []);
  const s = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  for (const [k, v] of Object.entries(FOUNDER_DEFAULTS)) if (s[k] == null) s[k] = v;
  return s;
}
const socials = (s) => {
  let extra = [];
  try { extra = JSON.parse(s.extra_socials || '[]').map((m) => m && m.url); } catch { extra = []; }
  return [...['instagram_url', 'facebook_url', 'linkedin_url', 'x_url', 'tiktok_url', 'youtube_url', 'vimeo_url'].map((k) => s[k]), ...extra]
    .map((u) => String(u || '').trim()).filter((u) => /^https:\/\/[^/]+\/.+/i.test(u));   // solo perfiles reales (no "https://facebook.com/")
};

function organization(req, s) {
  const site = s.site_name || 'DayOff Studios';
  const org = {
    '@context': 'https://schema.org', '@type': 'Organization', '@id': `${baseUrl(req)}/#organization`,
    name: site, url: `${baseUrl(req)}/`,
    logo: abs(req, s.logo_url || '/img/favicon.svg'),
    description: clip(s.about_text || s.slogan, 300)
  };
  const same = socials(s);
  if (same.length) org.sameAs = same;
  if (s.founder_name) org.founder = { '@type': 'Person', name: s.founder_name, jobTitle: s.founder_role || undefined };
  if (s.contact_email) org.email = s.contact_email;
  return org;
}

/** Inserta título, descripción, imagen, canonical y JSON-LD en index.html */
function render(req, res, { title, description, image, url, type = 'website', jsonld = [] }) {
  const tags = [
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="${esc(type)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
    ...jsonld.map(ld)
  ].filter(Boolean).join('\n  ');
  const html = readIndex()
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`)
    .replace('</head>', `  ${tags}\n</head>`);
  res.set('Cache-Control', 'no-cache').type('html').send(html);
}

async function home(req, res, next) {
  try {
    const s = await settings();
    const site = s.site_name || 'DayOff Studios';
    const [p] = await query('SELECT backdrop_url, poster_url FROM projects WHERE published = 1 ORDER BY featured DESC, sort_order LIMIT 1').catch(() => []);
    render(req, res, {
      title: `${site} — ${s.slogan || 'Film Production Company'}`,
      description: clip(s.seo_description || s.about_text || `${site}: film production company — feature films, short films, series, commercials and documentaries.`),
      image: abs(req, s.seo_image_url || s.hero_image_url || p?.backdrop_url || p?.poster_url),
      url: `${baseUrl(req)}/`,
      jsonld: [organization(req, s), { '@context': 'https://schema.org', '@type': 'WebSite', name: site, url: `${baseUrl(req)}/` }]
    });
  } catch (e) { next(e); }
}

async function project(req, res, next) {
  try {
    const s = await settings();
    const site = s.site_name || 'DayOff Studios';
    const slug = req.params.slug;
    let [p] = await query(`SELECT p.*, c.name AS category_name FROM projects p LEFT JOIN categories c ON c.id = p.category_id
                            WHERE p.slug = ? AND p.published = 1`, [slug]).catch(() => []);
    if (!p) {   // slug antiguo (se cambió el título) → redirección permanente al actual
      const [old] = await query('SELECT p.slug FROM project_slugs ps JOIN projects p ON p.id = ps.project_id WHERE ps.slug = ? AND p.published = 1', [slug]).catch(() => []);
      if (old) return res.redirect(301, `/project/${encodeURIComponent(old.slug)}`);
      res.status(404);              // no existe: se muestra la portada, pero Google recibe "404" (no la indexa como página)
      return home(req, res, next);
    }
    const url = `${baseUrl(req)}/project/${encodeURIComponent(p.slug)}`;
    const image = abs(req, p.poster_url || p.backdrop_url);          // póster para Google (Movie)
    const share = abs(req, p.backdrop_url || p.poster_url);          // horizontal para WhatsApp / redes
    const kind = (p.category_name || '').replace(/s$/i, '');
    const movie = {
      '@context': 'https://schema.org', '@type': 'Movie', name: p.title, url,
      image: image || undefined, description: clip(p.synopsis || p.tagline, 300) || undefined,
      dateCreated: p.year ? String(p.year) : undefined, genre: p.genre || undefined,
      director: p.director ? p.director.split(/\s*(?:,|&| y | and )\s*/).filter(Boolean).map((name) => ({ '@type': 'Person', name })) : undefined,
      productionCompany: { '@type': 'Organization', name: site, '@id': `${baseUrl(req)}/#organization` }
    };
    render(req, res, {
      title: `${p.title}${p.year ? ` (${p.year})` : ''}${kind ? ` — ${kind}` : ''} | ${site}`,
      description: clip(p.synopsis || p.tagline || `${p.title}, a production by ${site}.`),
      image: share, url, type: 'video.movie',
      jsonld: [movie, organization(req, s)]
    });
  } catch (e) { next(e); }
}

async function director(req, res, next) {
  try {
    const s = await settings();
    const site = s.site_name || 'DayOff Studios';
    const name = s.founder_name || 'Founder';
    const url = `${baseUrl(req)}/director/${encodeURIComponent(slugify(name))}`;
    render(req, res, {
      title: `${name} — ${s.founder_role || 'Director'} | ${site}`,
      description: clip(s.founder_bio || s.founder_teaser || `${name}, ${s.founder_role || 'director'} at ${site}.`),
      image: abs(req, s.founder_photo_url), url, type: 'profile',
      jsonld: [{ '@context': 'https://schema.org', '@type': 'Person', name, jobTitle: s.founder_role || undefined, url,
        image: abs(req, s.founder_photo_url) || undefined, worksFor: { '@type': 'Organization', name: site, '@id': `${baseUrl(req)}/#organization` } }]
    });
  } catch (e) { next(e); }
}

/* ─── Páginas del sitio anterior (Wix) → su equivalente nuevo ───
   "project:<nombre>" busca el proyecto por slug o por título; si no existe, va a la sección indicada después del "|". */
const LEGACY = {
  home: '/',
  bio: 'director',
  'about-9': '/#studio', equipo: '/#studio',
  narrativa: '/#work', narra: '/#work', portfolio: '/#work', 'portfolio-collections': '/#work',
  photo: '/#work', 'photo-g1': '/#work',
  reels: '/#onset',
  mythomania: 'project:mythomania|/#work', 'copia-de-mythomania-1': 'project:mythomania|/#work',
  'copia-de-mythomania': 'project:simple-days|/#work',
  'copia-de-alucinosis': 'project:alucinosis|/#work', 'copia-de-mythomania-2': 'project:alucinosis|/#work',
  relentless: 'project:relentless|/#work', selva: 'project:selva|/#work',
  blog: '/#news', 'event-list': '/#news',
  'book-online': '/#contact', 'product-page': '/', 'politica-de-privacidad': '/', 'terminos-y-condiciones': '/'
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

async function legacy(req, res, next) {
  if (req.method !== 'GET' || /\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
  let first;
  try { first = norm(decodeURIComponent(req.path.split('/')[1] || '')); } catch { return next(); }
  const target = LEGACY[first];
  if (!target) return next();
  try {
    let to = target;
    if (target === 'director') {
      const [r] = await query("SELECT setting_value v FROM settings WHERE setting_key = 'founder_name'").catch(() => []);
      to = `/director/${encodeURIComponent(slugify(r?.v || FOUNDER_DEFAULTS.founder_name || 'founder'))}`;
    } else if (target.startsWith('project:')) {
      const [want, fallback] = target.slice(8).split('|');
      const rows = await query('SELECT slug, title FROM projects WHERE published = 1').catch(() => []);
      const hit = rows.find((p) => p.slug === want) || rows.find((p) => p.slug.startsWith(want))
        || rows.find((p) => slugify(p.title).includes(want));
      to = hit ? `/project/${encodeURIComponent(hit.slug)}` : fallback;
    }
    res.redirect(301, to);
  } catch (e) { next(e); }
}

module.exports = { home, project, director, legacy };