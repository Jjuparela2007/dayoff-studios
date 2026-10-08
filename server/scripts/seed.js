/**
 * Carga contenido de DEMOSTRACIÓN (textos, categorías, proyectos, personas, créditos, galerías).
 * Las imágenes son de picsum.photos (placeholders) — reemplázalas desde el panel.
 * ⚠ Borra el contenido actual (no toca a los administradores).
 * Uso: npm run db:seed
 */
require('../env');
const { pool, query } = require('../db');
const T = require('./translations-en'); // la demo se carga en INGLÉS

const img = (seed, w = 800, h = 1200) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
// Tráiler de ejemplo: "Big Buck Bunny" (Blender Foundation, licencia libre)
const DEMO_TRAILER = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
// Clips de ejemplo para el showreel de portada: incluidos en el proyecto (public/media).
// Reemplázalos desde el panel por los clips reales de DayOff Studio.
const DEMO_REEL = [1, 2, 3, 4].map((n) => `/media/reel-${n}.mp4`);

const settings = {
  site_name: 'DayOff Studios',
  slogan: 'Historias que no se toman el día libre.',
  preloader_tagline: 'SHOW YOURSELF',
  hero_kicker: 'Productora audiovisual · Desde 2014',
  hero_title: 'Hacemos cine que se queda contigo',
  hero_videos: JSON.stringify(DEMO_REEL),
  hero_clip_seconds: '7',
  hero_image_url: img('dayoff-hero', 1920, 1080),
  about_title: 'El estudio',
  about_text: 'DayOff Studio nace del día en que decidimos dejar de esperar el momento perfecto para contar historias. Somos un equipo de directores, productores y artistas que cree en el cine como un acto de atención: mirar despacio, escuchar a los personajes y encontrar belleza en lo cotidiano.\n\nDesarrollamos proyectos propios y acompañamos a marcas y plataformas desde la idea hasta la sala de proyección.',
  stat_1_value: '48', stat_1_label: 'Producciones',
  stat_2_value: '17', stat_2_label: 'Festivales',
  stat_3_value: '12', stat_3_label: 'Años rodando',
  contact_title: '¿Tienes una historia?',
  contact_text: 'Escríbenos. Leemos cada guion, cada idea y cada locura.',
  contact_email: 'hello@dayoffstudios.com',
  contact_phone: '+57 300 000 0000',
  contact_address: 'New York City · USA',
  facebook_url: 'https://facebook.com/',
  instagram_url: 'https://www.instagram.com/dayoffstudios/',
  linkedin_url: 'https://linkedin.com/',
  x_url: 'https://x.com/',
  tiktok_url: 'https://tiktok.com/',
  vimeo_url: 'https://vimeo.com/',
  youtube_url: 'https://youtube.com/',
  footer_text: 'DayOff Studios. All rights reserved.',
  logo_url: ''
};

const categories = [
  ['Largometrajes', 'largometrajes', 'Historias de largo aliento para la gran pantalla.'],
  ['Cortometrajes', 'cortometrajes', 'Formatos breves, ideas intensas.'],
  ['Series', 'series', 'Ficción episódica para plataformas y televisión.'],
  ['Comerciales', 'comerciales', 'Publicidad con lenguaje cinematográfico.'],
  ['Documentales', 'documentales', 'Lo real, mirado de cerca.']
];

const people = [
  ['Valentina Ríos', 'equipo', 'Directora y guionista. Su ópera prima recorrió más de diez festivales internacionales. Le interesan los personajes en tránsito y los silencios.'],
  ['Mateo Salgado', 'equipo', 'Director de fotografía formado en Buenos Aires. Trabaja con luz natural y lentes vintage.'],
  ['Lucía Ferrer', 'actor', 'Actriz de teatro y cine. Ganadora del premio a mejor interpretación en el Festival de Cine de Cartagena.'],
  ['Andrés Peña', 'actor', 'Actor con formación en el Teatro Libre. Ha participado en series de plataformas internacionales.'],
  ['Camila Ortega', 'actor', 'Actriz y bailarina. Debutó en cine con DayOff Studio.'],
  ['Simón Arango', 'artista', 'Compositor de bandas sonoras. Mezcla orquesta de cámara con sintetizadores analógicos.'],
  ['Isabel Mora', 'artista', 'Directora de arte y diseñadora de producción.'],
  ['Tomás Vélez', 'equipo', 'Montajista. Más de 30 títulos editados entre ficción y documental.']
];

// [categoría, título, tagline, año, duración, género, director, sinopsis, destacado]
const projects = [
  ['largometrajes', 'La Última Luz', 'Algunas despedidas duran toda la vida.', 2025, '112 min', 'Drama', 'Valentina Ríos',
    'En un pueblo de montaña a punto de quedar bajo las aguas de una represa, una fotógrafa regresa para retratar a quienes se niegan a partir. Entre ellos está su padre, con quien no habla hace veinte años.', 1],
  ['largometrajes', 'Ciudad de Vidrio', 'Todo se ve. Nada se dice.', 2023, '98 min', 'Thriller', 'Valentina Ríos',
    'Un vigilante nocturno de un rascacielos descubre, a través de los ventanales, una rutina que se repite cada noche a la misma hora. Hasta que una noche no ocurre.', 1],
  ['cortometrajes', 'Domingo', 'El día más largo de la semana.', 2024, '14 min', 'Drama', 'Mateo Salgado',
    'Una abuela y su nieto pasan un domingo cualquiera. Ninguno sabe que es el último.', 0],
  ['cortometrajes', 'Ruido Blanco', null, 2022, '18 min', 'Ciencia ficción', 'Valentina Ríos',
    'Una técnica de sonido capta en sus grabaciones una voz que parece venir del futuro.', 0],
  ['series', 'Los Invisibles', 'Temporada 1 · 8 episodios', 2025, '8 × 45 min', 'Drama criminal', 'Valentina Ríos',
    'Cuatro trabajadores nocturnos de una ciudad que nunca duerme descubren que comparten un secreto que podría derribar a los poderosos.', 1],
  ['series', 'Casa Abierta', null, 2023, '6 × 30 min', 'Comedia', 'Mateo Salgado',
    'Una familia convierte su casona en hostal para pagar deudas. Los huéspedes traen más problemas que dinero.', 0],
  ['comerciales', 'Café de Origen — "Madrugada"', null, 2025, '60 s', 'Publicidad', 'Mateo Salgado',
    'Campaña para una marca de café colombiano que sigue a una caficultora desde las 4 a. m.', 0],
  ['comerciales', 'Aerolínea Sur — "Volver"', null, 2024, '90 s', 'Publicidad', 'Valentina Ríos',
    'Spot navideño sobre el reencuentro de familias separadas por la distancia.', 0],
  ['documentales', 'Río Adentro', 'Un viaje de 1.500 kilómetros.', 2024, '84 min', 'Documental', 'Valentina Ríos',
    'Siguiendo el curso del río Magdalena, el documental retrata a pescadores, bogas y cantadoras que mantienen viva la memoria del agua.', 1],
  ['documentales', 'Las Manos que Tejen', null, 2022, '52 min', 'Documental', 'Mateo Salgado',
    'Tres generaciones de tejedoras wayuu y el valor de lo que se hace despacio.', 0]
];

// ── Pasar los datos de demo al inglés (traducciones en translations-en.js) ──
for (const [k, [, en]] of Object.entries(T.SETTINGS)) settings[k] = en;
categories.forEach((c) => { const t = T.CATEGORIES[c[1]]; c[0] = t[0]; c[2] = t[2]; c[1] = t[1]; });
people.forEach((p) => { p[2] = T.BIOS[p[0]][1]; });
projects.forEach((p) => {
  const t = T.PROJECTS[p[1]];
  p[0] = T.CATEGORIES[p[0]][1];
  if (t.tagline) p[2] = t.tagline[1];
  p[5] = T.GENRES[p[5]] || p[5];
  p[7] = t.synopsis[1];
  p[1] = t.title;
});
const role = (es) => T.ROLES[es] || es;

(async () => {
  console.log('… cargando contenido de demostración (en inglés)');
  for (const t of ['media', 'credits', 'projects', 'people', 'categories', 'settings']) await query(`DELETE FROM ${t}`);

  for (const [k, v] of Object.entries({ ...require('./founder-defaults'), ...settings })) {
    await query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)', [k, v]);
  }

  const catIds = {};
  for (const [i, [name, slug, description]] of categories.entries()) {
    const r = await query('INSERT INTO categories (name, slug, description, cover_url, sort_order) VALUES (?,?,?,?,?)',
      [name, slug, description, img(`cat-${slug}`, 1600, 900), i]);
    catIds[slug] = r.insertId;
  }

  const personIds = [];
  for (const [name, kind, bio] of people) {
    const r = await query('INSERT INTO people (name, kind, bio, photo_url) VALUES (?,?,?,?)',
      [name, kind, bio, img(`person-${personIds.length + 1}`, 600, 800)]);
    personIds.push(r.insertId);
  }
  const [valentina, mateo, lucia, andres, camila, simon, isabel, tomas] = personIds;

  for (const [i, [cat, title, tagline, year, duration, genre, director, synopsis, featured]] of projects.entries()) {
    const slug = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const r = await query(
      `INSERT INTO projects (category_id, title, slug, tagline, year, duration, genre, synopsis, director,
                             poster_url, backdrop_url, trailer_url, featured, published, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
      [catIds[cat], title, slug, tagline, year, duration, genre, synopsis, director,
        img(`poster-${slug}`), img(`backdrop-${slug}`, 1920, 1080), DEMO_TRAILER, featured, i]);
    const pid = r.insertId;

    const dirId = director.startsWith('Valentina') ? valentina : mateo;
    const credits = [
      [lucia, null, 'Protagonista', 'reparto'], [andres, null, 'Coprotagonista', 'reparto'], [camila, null, 'Reparto', 'reparto'],
      [null, 'Jorge Lemus', 'Reparto', 'reparto'],
      [simon, null, 'Música original', 'artistas'], [isabel, null, 'Dirección de arte', 'artistas'],
      [dirId, null, 'Dirección', 'equipo'], [valentina, null, 'Guion', 'equipo'], [mateo, null, 'Dirección de fotografía', 'equipo'],
      [tomas, null, 'Montaje', 'equipo'], [null, 'Paula Restrepo', 'Producción ejecutiva', 'equipo'],
      [null, 'Diego Cárdenas', 'Sonido directo', 'equipo']
    ];
    for (const [j, [personId, name, roleEs, dept]] of credits.entries()) {
      await query('INSERT INTO credits (project_id, person_id, name, role, department, sort_order) VALUES (?,?,?,?,?,?)',
        [pid, personId, name, role(roleEs), dept, j]);
    }
    for (let j = 1; j <= 6; j++) {
      await query('INSERT INTO media (project_id, type, url, caption, sort_order) VALUES (?,?,?,?,?)',
        [pid, 'image', img(`still-${slug}-${j}`, 1600, 900), `Still ${j}`, j]);
    }
  }
  console.log(`✔ Demo cargada: ${categories.length} categorías, ${projects.length} proyectos, ${people.length} personas`);
  await pool.end();
})().catch(async (e) => { console.error('✖', e.message); await pool.end(); process.exit(1); });