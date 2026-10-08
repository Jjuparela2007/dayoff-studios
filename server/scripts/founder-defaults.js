/**
 * Textos iniciales del perfil del fundador (sección "The studio" + página /director/...).
 * Son de EJEMPLO: cámbialos en el panel → Textos del sitio → "Fundador / creador".
 * Los usan db:seed (base nueva) y db:update (base existente, solo si faltan).
 */
module.exports = {
  founder_name: 'Rigoberto Mendoza',
  founder_role: 'Founder & Creative Director',
  founder_disciplines: 'Director, Screenwriter, Producer',
  founder_photo_url: 'https://picsum.photos/seed/dayoff-founder/900/1200',
  founder_photo2_url: '',   // segunda foto (biografía en su página); vacía = se usa la principal
  founder_quote: 'Every frame is a decision. I just try to make the honest one.',
  founder_teaser: 'Rigoberto founded DayOff Studios with one idea: stories that never take a day off. He leads every project from the first page of the script to the last frame of the grade.',
  founder_bio: 'Rigoberto Mendoza is the founder and creative director of DayOff Studios.\n\nHe started out behind the camera on short films and commercials, learning every role on set before building a studio of his own. Today he leads a team of directors, producers and artists, guiding each project from development through post-production.\n\nHis work is driven by intimate characters, natural light and an obsession with sound.',
  founder_milestones: 'The beginning | First short films and commercials, learning every role on set\nDayOff Studios | Founds the studio with a team of directors, producers and artists\nToday | Leads every DayOff production from script to final grade'
};