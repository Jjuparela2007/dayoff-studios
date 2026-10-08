/**
 * Traducciones al inglés del contenido de DEMOSTRACIÓN.
 * Las usan:
 *   - translate-en.js → convierte una base de datos existente (solo los textos demo que sigan en español)
 *   - seed.js         → carga la demo directamente en inglés
 * Formato: [español, inglés]
 */

const SETTINGS = {
  slogan: ['Historias que no se toman el día libre.', 'Stories that never take a day off.'],
  hero_kicker: ['Productora audiovisual · Desde 2014', 'Film production company · Since 2014'],
  hero_title: ['Hacemos cine que se queda contigo', 'We make films that stay with you'],
  about_title: ['El estudio', 'The studio'],
  about_text: [
    'DayOff Studio nace del día en que decidimos dejar de esperar el momento perfecto para contar historias. Somos un equipo de directores, productores y artistas que cree en el cine como un acto de atención: mirar despacio, escuchar a los personajes y encontrar belleza en lo cotidiano.\n\nDesarrollamos proyectos propios y acompañamos a marcas y plataformas desde la idea hasta la sala de proyección.',
    'DayOff Studios was born the day we stopped waiting for the perfect moment to tell stories. We are a team of directors, producers and artists who believe cinema is an act of attention: looking slowly, listening to characters and finding beauty in the everyday.\n\nWe develop our own projects and partner with brands and platforms from the first idea to the screening room.'
  ],
  stat_1_label: ['Producciones', 'Productions'],
  stat_2_label: ['Festivales', 'Festivals'],
  stat_3_label: ['Años rodando', 'Years shooting'],
  contact_title: ['¿Tienes una historia?', 'Got a story?'],
  contact_text: ['Escríbenos. Leemos cada guion, cada idea y cada locura.', 'Write to us. We read every script, every idea and every wild dream.'],
  footer_text: ['DayOff Studios. Todos los derechos reservados.', 'DayOff Studios. All rights reserved.']
};
// Variantes antiguas del pie de página que también se traducen
const FOOTER_OLD = ['© DayOff Studio. Todos los derechos reservados.', 'DayOff Studio. Todos los derechos reservados.'];

// slug antiguo → [nombre, slug nuevo, descripción en inglés, descripción en español]
const CATEGORIES = {
  largometrajes: ['Feature Films', 'feature-films', 'Long-form stories for the big screen.', 'Historias de largo aliento para la gran pantalla.'],
  cortometrajes: ['Short Films', 'short-films', 'Short formats, intense ideas.', 'Formatos breves, ideas intensas.'],
  series: ['Series', 'series', 'Episodic fiction for streaming and television.', 'Ficción episódica para plataformas y televisión.'],
  comerciales: ['Commercials', 'commercials', 'Advertising with a cinematic language.', 'Publicidad con lenguaje cinematográfico.'],
  documentales: ['Documentaries', 'documentaries', 'Real life, seen up close.', 'Lo real, mirado de cerca.']
};
const CATEGORY_NAMES_ES = { Largometrajes: 'largometrajes', Cortometrajes: 'cortometrajes', Series: 'series', Comerciales: 'comerciales', Documentales: 'documentales' };

// título en español → { title, tagline: [es, en], synopsis: [es, en] }
const PROJECTS = {
  'La Última Luz': { title: 'The Last Light', tagline: ['Algunas despedidas duran toda la vida.', 'Some goodbyes last a lifetime.'],
    synopsis: ['En un pueblo de montaña a punto de quedar bajo las aguas de una represa, una fotógrafa regresa para retratar a quienes se niegan a partir. Entre ellos está su padre, con quien no habla hace veinte años.',
      'In a mountain town about to disappear beneath the waters of a dam, a photographer returns to portray those who refuse to leave. Among them is her father, whom she hasn’t spoken to in twenty years.'] },
  'Ciudad de Vidrio': { title: 'Glass City', tagline: ['Todo se ve. Nada se dice.', 'Everything is seen. Nothing is said.'],
    synopsis: ['Un vigilante nocturno de un rascacielos descubre, a través de los ventanales, una rutina que se repite cada noche a la misma hora. Hasta que una noche no ocurre.',
      'A night guard in a skyscraper notices, through its windows, a routine that repeats every night at the same time. Until one night it doesn’t.'] },
  'Domingo': { title: 'Sunday', tagline: ['El día más largo de la semana.', 'The longest day of the week.'],
    synopsis: ['Una abuela y su nieto pasan un domingo cualquiera. Ninguno sabe que es el último.',
      'A grandmother and her grandson spend an ordinary Sunday together. Neither of them knows it is their last.'] },
  'Ruido Blanco': { title: 'White Noise',
    synopsis: ['Una técnica de sonido capta en sus grabaciones una voz que parece venir del futuro.',
      'A sound technician picks up a voice in her recordings that seems to come from the future.'] },
  'Los Invisibles': { title: 'The Invisibles', tagline: ['Temporada 1 · 8 episodios', 'Season 1 · 8 episodes'],
    synopsis: ['Cuatro trabajadores nocturnos de una ciudad que nunca duerme descubren que comparten un secreto que podría derribar a los poderosos.',
      'Four night-shift workers in a city that never sleeps discover they share a secret that could bring down the powerful.'] },
  'Casa Abierta': { title: 'Open House',
    synopsis: ['Una familia convierte su casona en hostal para pagar deudas. Los huéspedes traen más problemas que dinero.',
      'A family turns their old mansion into a guesthouse to pay off their debts. The guests bring more trouble than money.'] },
  'Café de Origen — "Madrugada"': { title: 'Origin Coffee — "Daybreak"',
    synopsis: ['Campaña para una marca de café colombiano que sigue a una caficultora desde las 4 a. m.',
      'Campaign for a Colombian coffee brand that follows a coffee grower from 4 a.m.'] },
  'Aerolínea Sur — "Volver"': { title: 'South Airlines — "Coming Home"',
    synopsis: ['Spot navideño sobre el reencuentro de familias separadas por la distancia.',
      'Christmas spot about families reunited after years apart.'] },
  'Río Adentro': { title: 'Upriver', tagline: ['Un viaje de 1.500 kilómetros.', 'A 1,500-kilometer journey.'],
    synopsis: ['Siguiendo el curso del río Magdalena, el documental retrata a pescadores, bogas y cantadoras que mantienen viva la memoria del agua.',
      'Following the course of the Magdalena River, the documentary portrays fishermen, boatmen and traditional singers who keep the memory of the water alive.'] },
  'Las Manos que Tejen': { title: 'Weaving Hands',
    synopsis: ['Tres generaciones de tejedoras wayuu y el valor de lo que se hace despacio.',
      'Three generations of Wayuu weavers and the value of what is made slowly.'] }
};

const GENRES = {
  'Ciencia ficción': 'Science fiction', 'Drama criminal': 'Crime drama', 'Comedia': 'Comedy',
  'Publicidad': 'Advertising', 'Documental': 'Documentary', 'Suspenso': 'Thriller', 'Terror': 'Horror',
  'Animación': 'Animation', 'Romance': 'Romance', 'Acción': 'Action', 'Aventura': 'Adventure', 'Fantasía': 'Fantasy'
};

// nombre de la persona → [bio en español, bio en inglés]
const BIOS = {
  'Valentina Ríos': ['Directora y guionista. Su ópera prima recorrió más de diez festivales internacionales. Le interesan los personajes en tránsito y los silencios.',
    'Director and screenwriter. Her debut feature screened at more than ten international festivals. She is drawn to characters in transit and to silence.'],
  'Mateo Salgado': ['Director de fotografía formado en Buenos Aires. Trabaja con luz natural y lentes vintage.',
    'Cinematographer trained in Buenos Aires. He works with natural light and vintage lenses.'],
  'Lucía Ferrer': ['Actriz de teatro y cine. Ganadora del premio a mejor interpretación en el Festival de Cine de Cartagena.',
    'Stage and screen actress. Winner of Best Performance at the Cartagena Film Festival.'],
  'Andrés Peña': ['Actor con formación en el Teatro Libre. Ha participado en series de plataformas internacionales.',
    'Actor trained at Teatro Libre. He has appeared in series for international streaming platforms.'],
  'Camila Ortega': ['Actriz y bailarina. Debutó en cine con DayOff Studio.', 'Actress and dancer. She made her film debut with DayOff Studios.'],
  'Simón Arango': ['Compositor de bandas sonoras. Mezcla orquesta de cámara con sintetizadores analógicos.',
    'Film composer. He blends chamber orchestra with analog synthesizers.'],
  'Isabel Mora': ['Directora de arte y diseñadora de producción.', 'Art director and production designer.'],
  'Tomás Vélez': ['Montajista. Más de 30 títulos editados entre ficción y documental.', 'Film editor. More than 30 titles cut across fiction and documentary.']
};

const ROLES = {
  'Protagonista': 'Lead', 'Coprotagonista': 'Co-lead', 'Reparto': 'Supporting cast',
  'Música original': 'Original score', 'Dirección de arte': 'Art direction', 'Dirección': 'Director',
  'Guion': 'Screenplay', 'Dirección de fotografía': 'Cinematography', 'Montaje': 'Editing',
  'Producción ejecutiva': 'Executive producer', 'Sonido directo': 'Production sound', 'Producción': 'Producer',
  'Diseño de producción': 'Production design', 'Vestuario': 'Costume design', 'Maquillaje': 'Makeup',
  'Efectos visuales': 'Visual effects', 'Colorización': 'Color grading', 'Mezcla de sonido': 'Sound mixing'
};

module.exports = { SETTINGS, FOOTER_OLD, CATEGORIES, CATEGORY_NAMES_ES, PROJECTS, GENRES, BIOS, ROLES };
