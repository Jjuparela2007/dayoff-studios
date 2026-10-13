/**
 * DayOff Studio — Panel de administración (SPA en JavaScript puro).
 *
 * Vistas: resumen, textos, categorías, proyectos (info + créditos + galería),
 * personas (biografías), biblioteca de medios y cuenta.
 * Toda la comunicación es con /api/admin/* usando la cookie de sesión httpOnly.
 */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const view = $('#view');
  const cache = { categories: [], people: [] };

  /* ───────────── API ───────────── */
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });
    if (res.status === 401 && !path.includes('/auth/login')) { showLogin(); throw new Error('Sesión expirada'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  /** Subida de archivos con barra de progreso (XHR permite medir el avance). */
  /* Formatos permitidos (igual que en el servidor). SVG excluido a propósito. */
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
  let uploadMode = null; // 'local' (carpeta /uploads) o 'cloudinary' (producción)

  /** Envía un formulario con XHR para poder medir el progreso. */
  function xhrPost(url, fd, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* vacío */ }
        xhr.status < 300 ? resolve(data) : reject(new Error(data.error?.message || data.error || 'Error al subir'));
      };
      xhr.onerror = () => reject(new Error('Error de red'));
      xhr.send(fd);
    });
  }

  /**
   * Sube archivos y devuelve [{ id, url, mime, original_name }].
   * - Local: al servidor (carpeta /uploads).
   * - Producción: directo del navegador a Cloudinary con una firma del servidor, y luego se registra en la biblioteca.
   */
  async function uploadFiles(files, onProgress) {
    files = [...files];
    const bad = files.find((f) => !ALLOWED_TYPES.includes(f.type));
    if (bad) throw new Error(`Formato no permitido: ${bad.name}`);
    if (!uploadMode) uploadMode = (await api('/api/admin/uploads/config')).mode;

    if (uploadMode !== 'cloudinary') {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      return xhrPost('/api/admin/uploads', fd, onProgress);
    }

    // Progreso total: suma de bytes de todos los archivos
    const total = files.reduce((n, f) => n + f.size, 0) || 1;
    let done = 0;
    const saved = [];
    for (const f of files) {
      const sig = await api('/api/admin/uploads/signature');
      const fd = new FormData();
      fd.append('file', f);
      fd.append('api_key', sig.apiKey);
      fd.append('timestamp', sig.timestamp);
      fd.append('folder', sig.folder);
      fd.append('signature', sig.signature);
      const up = await xhrPost(sig.uploadUrl, fd, (p) => onProgress && onProgress((done + p * f.size) / total));
      done += f.size;
      saved.push(await api('/api/admin/uploads/register', {
        method: 'POST',
        body: { url: up.secure_url, public_id: up.public_id, resource_type: up.resource_type, format: up.format, bytes: up.bytes, original_name: f.name }
      }));
    }
    return saved;
  }

  function toast(msg, error = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('is-error', error);
    t.classList.add('is-show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('is-show'), 2600);
  }

  /** Ejecuta una acción mostrando éxito o error y deshabilitando el botón mientras tanto. */
  async function run(btn, fn, okMsg = 'Guardado') {
    if (btn) btn.disabled = true;
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }

  const formData = (form) => {
    const o = {};
    $$('input, textarea, select', form).forEach((el) => {
      if (!el.name) return;
      o[el.name] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value.trim();
    });
    return o;
  };

  const isVideo = (url) => /\.(mp4|webm|mov)(\?|$)/i.test(url || '');
  const thumb = (url, cls = 'thumb') => url
    ? (isVideo(url) ? `<video class="${cls}" src="${esc(url)}" muted></video>` : `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">`)
    : `<span class="${cls}"></span>`;

  /** Campo de URL con miniatura + botón para elegir de la biblioteca. */
  const urlField = (name, label, value, hint = '') => `
    <label class="span-all">${label}
      <div class="url-field">
        ${thumb(value, 'thumb')}
        <input name="${name}" value="${esc(value)}" placeholder="/uploads/... o https://...">
        <button type="button" class="btn btn--ghost btn--sm" data-pick="${name}">Biblioteca</button>
      </div>
      ${hint ? `<span class="hint">${hint}</span>` : ''}
    </label>`;

  // Delegación: botones "Biblioteca" de cualquier formulario
  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const input = b.parentElement.querySelector('input');
    const url = await pickMedia();
    if (url) { input.value = url; input.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  // Actualiza la miniatura al cambiar la URL
  view.addEventListener('input', (e) => {
    const wrap = e.target.closest('.url-field');
    if (!wrap) return;
    const old = wrap.querySelector('.thumb');
    old.outerHTML = thumb(e.target.value, 'thumb');
  });

  /* ───────────── Selector de medios ───────────── */
  const picker = $('#picker');
  let pickResolve = null;
  async function pickMedia() {
    await renderPickerGrid();
    picker.showModal();
    return new Promise((r) => { pickResolve = r; });
  }
  async function renderPickerGrid() {
    const items = await api('/api/admin/uploads');
    $('#picker-grid').innerHTML = items.length
      ? items.map((m) => `<div class="media-item" data-url="${esc(m.url)}">${thumb(m.url, '')}<div class="media-item__info">${esc(m.original_name)}</div></div>`).join('')
      : '<p class="empty">Aún no hay archivos. Sube el primero.</p>';
  }
  $('#picker-grid').addEventListener('click', (e) => {
    const it = e.target.closest('[data-url]');
    if (!it) return;
    picker.close();
    pickResolve && pickResolve(it.dataset.url);
    pickResolve = null;
  });
  $('[data-close]', picker).addEventListener('click', () => { picker.close(); pickResolve && pickResolve(null); pickResolve = null; });
  $('input[type=file]', picker).addEventListener('change', async (e) => {
    await run(null, () => uploadFiles(e.target.files), 'Archivo subido');
    e.target.value = '';
    renderPickerGrid();
  });

  /* ───────────── Login / sesión ───────────── */
  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; setPasswordVisible(false); $('#login input').focus(); }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; route(); }

  $('#login form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target);
    const err = $('.login__error');
    err.textContent = '';
    btn.disabled = true;
    try {
      await api('/api/auth/login', { method: 'POST', body: formData(e.target) });
      e.target.reset();
      setPasswordVisible(false);
      showApp();
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; }
  });

  /** Ojito del login: alterna el campo de contraseña entre oculto y visible. */
  function setPasswordVisible(show) {
    const input = $('#login input[name=password]');
    const btn = $('#login .pw__toggle');
    const label = show ? 'Ocultar contraseña' : 'Mostrar contraseña';
    input.type = show ? 'text' : 'password';
    $('.pw__eye', btn).hidden = show;
    $('.pw__eye-off', btn).hidden = !show;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.setAttribute('aria-pressed', String(show));
  }
  $('#login .pw__toggle').addEventListener('click', () => {
    const input = $('#login input[name=password]');
    setPasswordVisible(input.type === 'password');
    input.focus();
  });

  $('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); showLogin(); });

  /* ───────────── Enrutado por hash ───────────── */
  const views = {};
  async function route() {
    const name = (location.hash.slice(1).split('/')[0]) || 'dashboard';
    const arg = location.hash.split('/')[1];
    $$('.side__nav a').forEach((a) => a.classList.toggle('is-active', a.dataset.view === name));
    view.innerHTML = '<p class="empty">Cargando…</p>';
    try { await (views[name] || views.dashboard)(arg); }
    catch (e) { view.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
    scrollTo(0, 0);
  }
  addEventListener('hashchange', () => { if (!$('#app').hidden) route(); });

  /* ═════════════ VISTA: Resumen ═════════════ */
  views.dashboard = async () => {
    const [projects, categories, people, uploads, settings, disk] = await Promise.all([
      api('/api/admin/projects'), api('/api/admin/categories'), api('/api/admin/people'), api('/api/admin/uploads'), api('/api/admin/settings'),
      api('/api/admin/storage').catch(() => null)
    ]);
    view.innerHTML = `
      <div class="page-head"><div><h1>Bienvenido</h1><p>Gestiona el contenido de DayOff Studio.</p></div>
        <a class="btn btn--primary" href="#proyectos/nuevo">+ Nuevo proyecto</a></div>
      <div class="stats">
        <div class="stat"><b>${projects.length}</b><span class="mono">Proyectos</span></div>
        <div class="stat"><b>${categories.length}</b><span class="mono">Categorías</span></div>
        <div class="stat"><b>${people.length}</b><span class="mono">Personas</span></div>
        <div class="stat"><b>${uploads.length}</b><span class="mono">Archivos</span></div>
      </div>
      <div class="panel"><div class="panel__head"><h2>Últimos proyectos</h2><a class="btn btn--ghost btn--sm" href="#proyectos">Ver todos</a></div>
        ${projectTable(projects.slice(0, 6), settings.spotlight_project_id)}</div>
      ${disk ? diskPanel(disk) : ''}
      <div class="panel"><div class="panel__head"><h2>Respaldo</h2></div>
        <p class="hint" style="margin:0 0 14px">Descarga una copia de todo lo del panel para guardarla en tu computador o en Drive. Recomendado una vez al mes o antes de cambios grandes.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn btn--primary btn--sm" href="/api/admin/backup?files=1" download data-backup>Descargar respaldo completo (.zip)</a>
          <a class="btn btn--ghost btn--sm" href="/api/admin/backup" download>Solo textos y contenido (.json)</a>
        </div>
        <p class="hint" style="margin:12px 0 0">El completo incluye todas las imágenes y videos subidos${disk ? ` (~${bytes(disk.used)})` : ''}, así que puede tardar varios minutos en descargarse. El .json pesa muy poco: textos, proyectos, créditos, categorías, news y galerías (sin las contraseñas).</p>
      </div>`;
    const b = view.querySelector('[data-backup]');
    if (b) b.addEventListener('click', () => toast('Preparando el respaldo… la descarga empieza en unos segundos'));
  };

  const bytes = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
  function diskPanel(d) {
    const pct = Math.min(100, (d.total / d.limit) * 100);
    const level = pct >= 90 ? 'is-danger' : pct >= 75 ? 'is-warn' : '';
    return `<div class="panel disk ${level}"><div class="panel__head"><h2>Espacio en disco</h2>
        <span class="mono">${bytes(d.total)} de ${bytes(d.limit)} · ${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%</span></div>
      <div class="disk__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct.toFixed(2)}%"></span></div>
      <p class="hint" style="margin:10px 0 0">${d.files} archivos subidos (${bytes(d.used)})${d.cache ? ` + ${bytes(d.cache)} de imágenes optimizadas automáticas` : ''}. Quedan <b>${bytes(Math.max(0, d.limit - d.total))}</b> libres.
        ${pct >= 75 ? ' Te estás quedando sin espacio: borra en la Biblioteca los videos que ya no uses, o amplía el volumen en Railway.' : ''}</p>
      ${d.biggest.length ? `<h3 class="mono" style="margin:18px 0 8px">Los que más pesan</h3>
        <ul class="disk__list">${d.biggest.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a><span class="mono">${bytes(f.size)}</span></li>`).join('')}</ul>` : ''}
    </div>`;
  }

  /* ═════════════ VISTA: Textos del sitio ═════════════ */
  const SETTINGS_GROUPS = [
    ['Marca', [['site_name', 'Nombre del sitio'], ['slogan', 'Eslogan'], ['preloader_tagline', 'Frase bajo el logo en la pantalla de carga (ej. SHOW YOURSELF)'],
      ['logo_url', 'Logo en imagen (opcional; si está vacío se usa el logo vectorial, que es el que hace la animación de máscara)', 'url']]],
    ['Google y redes sociales (cómo se ve el sitio en los resultados de búsqueda y al compartir el link)', [
      ['seo_title', 'Título para Google y la pestaña del navegador (~60 caracteres, en inglés; ej. DAY OFF Studios | video and photography production company | New York, NY, USA). Si lo dejas vacío se usa "Nombre del sitio — Eslogan"'],
      ['seo_description', 'Descripción para Google (1–2 frases, ~150 caracteres, en inglés; ej. "DayOff Studios is a New York film production company…"). Si la dejas vacía se usa el texto de "Estudio"', 'textarea'],
      ['seo_image_url', 'Imagen al compartir el link de la portada en WhatsApp, Instagram, LinkedIn… (horizontal 1200×630). Si la dejas vacía se usa la imagen de respaldo del hero', 'url']]],
    ['Último estreno (Latest release) — texto que aparece antes de la animación del estreno', [
      ['latest_intro_kicker', 'Antetítulo pequeño (ej. Latest release)'],
      ['latest_intro', 'Descripción (si la dejas vacía no se muestra; deja una línea en blanco para separar párrafos)', 'textarea']]],
    ['Portada (hero)', [['hero_kicker', 'Antetítulo'], ['hero_title', 'Título principal — usa *palabra* para resaltarla en dorado'],
      ['hero_mode', 'Fondo de la portada', 'select', [['reel', 'Showreel — clips de video (MP4) en bucle con fundido'], ['embed', 'Un video de YouTube o Vimeo']]],
      ['hero_embed_url', 'Link de YouTube o Vimeo (se reproduce de fondo, sin sonido y en bucle). Si el video no permite insertarse en otras páginas, se verá la imagen de respaldo'],
      ['hero_videos', 'Videos de portada (showreel en bucle infinito)', 'videos'],
      ['hero_clip_seconds', 'Segundos por clip (ej. 7; si el video es más corto, se ve completo)'],
      ['hero_image_url', 'Imagen de respaldo (se ve mientras carga el primer video o si no hay videos)', 'url']]],
    ['Galería de videos (sección "Featured Work")', [
      ['onset_title', 'Título de la sección (ej. Featured Work; si lo dejas vacío no se muestra la franja del título)'],
      ['onset_nav', 'Nombre en el menú de arriba (ej. Featured Work)'],
      ['meter_left', 'Rollo de cámara — texto de la izquierda (ej. 1\\400  ISO 400; vacío = se oculta)'],
      ['meter_right', 'Rollo de cámara — texto de la derecha (ej. AWB  FPS 24  f1.8; vacío = se oculta)']]],
    ['Estudio', [['about_title', 'Título'], ['about_text', 'Texto (deja una línea en blanco entre párrafos)', 'textarea'], ['about_image_url', 'Imagen', 'url'],
      ['stat_1_value', 'Cifra 1'], ['stat_1_label', 'Etiqueta 1'], ['stat_2_value', 'Cifra 2'], ['stat_2_label', 'Etiqueta 2'], ['stat_3_value', 'Cifra 3'], ['stat_3_label', 'Etiqueta 3']]],
    ['Fundador / creador (aparece en "The studio" y tiene su propia página)', [
      ['founder_name', 'Nombre (su filmografía se arma sola con los proyectos donde figure como director o en los créditos con este mismo nombre)'], ['founder_role', 'Cargo (ej. Founder & Creative Director)'],
      ['founder_disciplines', 'Oficios, separados por comas (ej. Director, Screenwriter, Producer)'],
      ['founder_photo_url', 'Foto principal (portada de su página y sección del estudio; vertical, idealmente en blanco y negro)', 'url'],
      ['founder_photo2_url', 'Segunda foto (junto a la biografía en su página; si la dejas vacía se repite la principal)', 'url'],
      ['founder_quote', 'Frase / cita destacada'],
      ['founder_teaser', 'Texto corto para la sección del estudio', 'textarea'],
      ['founder_bio', 'Biografía completa para su página (deja una línea en blanco entre párrafos)', 'textarea'],
      ['founder_milestones', 'Trayectoria: una línea por hito con el formato  Año | Descripción  (ej. 2014 | Funda DayOff Studios)', 'textarea']]],
    ['Contacto', [['contact_title', 'Título — usa *palabra* para resaltarla en dorado'], ['contact_text', 'Texto', 'textarea'], ['contact_email', 'Email'], ['contact_phone', 'Teléfono'], ['contact_address', 'Dirección']]],
    ['Redes y pie (deja vacío el enlace de una red para ocultar su ícono)', [
      ['facebook_url', 'Facebook'], ['instagram_url', 'Instagram'], ['linkedin_url', 'LinkedIn'], ['x_url', 'X (Twitter)'],
      ['youtube_url', 'YouTube'], ['vimeo_url', 'Vimeo'], ['tiktok_url', 'TikTok'],
      ['extra_socials', 'Otras redes (IMDb, Spotify, WhatsApp, Threads, Behance, Pinterest, Letterboxd…)', 'socials'],
      ['footer_text', 'Copyright (el año se añade solo: "DayOff Studios. Todos los derechos reservados.")']]]
  ];

  /* ── Lista de videos del hero (se guarda como JSON en el ajuste hero_videos) ── */
  function videoListField(name, label, value) {
    return `<div class="span-all video-list" data-name="${name}">
      <label>${label}</label>
      <p class="hint">Se reproducen en orden, con fundido entre uno y otro, y vuelven a empezar al terminar. Usa clips MP4 cortos (5–15 s, sin audio, idealmente &lt; 10 MB cada uno).
</p>
      <input type="hidden" name="${name}" value="${esc(value || '[]')}">
      <div class="rows" style="margin:12px 0"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <label class="btn btn--ghost btn--sm">Subir videos<input type="file" multiple hidden accept="video/mp4,video/webm,video/quicktime" data-vupload></label>
        <button type="button" class="btn btn--ghost btn--sm" data-vadd-lib>+ Desde biblioteca</button>
        <button type="button" class="btn btn--ghost btn--sm" data-vadd-url>+ Pegar URL</button>
      </div>
      <div class="progress" hidden><span></span></div>
    </div>`;
  }
  const videoRow = (url) => `<div class="row row--video" draggable="true">
    <span class="handle">⋮⋮</span>
    <video class="preview" src="${esc(url)}" muted preload="metadata"></video>
    <input data-k="url" value="${esc(url)}" placeholder="/uploads/clip.mp4 o https://...">
    <button type="button" class="btn btn--danger btn--sm" data-remove>×</button>
  </div>`;
  function bindVideoList() {
    $$('.video-list').forEach((box) => {
      const rows = $('.rows', box);
      let list = [];
      try { list = JSON.parse($('input[type=hidden]', box).value || '[]'); } catch { list = []; }
      const empty = '<p class="empty" style="padding:14px">Sin videos: la portada mostrará la imagen de respaldo.</p>';
      const add = (url) => { $('.empty', rows)?.remove(); rows.insertAdjacentHTML('beforeend', videoRow(url)); };
      rows.innerHTML = list.length ? '' : empty;
      list.forEach(add);
      rows.addEventListener('click', (e) => { if (e.target.closest('[data-remove]')) { e.target.closest('.row').remove(); if (!rows.children.length) rows.innerHTML = empty; } });
      rows.addEventListener('input', (e) => { if (e.target.dataset.k === 'url') e.target.closest('.row').querySelector('.preview').src = e.target.value; });
      enableDragSort(rows);
      $('[data-vadd-lib]', box).addEventListener('click', async () => { const u = await pickMedia(); if (u) add(u); });
      $('[data-vadd-url]', box).addEventListener('click', () => { const u = prompt('URL del video (.mp4 / .webm):'); if (u) add(u.trim()); });
      $('[data-vupload]', box).addEventListener('change', async (e) => {
        const bar = $('.progress', box); bar.hidden = false;
        const saved = await run(null, () => uploadFiles(e.target.files, (f) => { bar.firstElementChild.style.width = f * 100 + '%'; }), 'Videos subidos — recuerda guardar');
        bar.hidden = true; e.target.value = '';
        (saved || []).forEach((f) => add(f.url));
      });
    });
  }
  function serializeVideoList() {
    $$('.video-list').forEach((box) => {
      const urls = $$('.row [data-k=url]', box).map((i) => i.value.trim()).filter(Boolean);
      $('input[type=hidden]', box).value = JSON.stringify(urls);
    });
  }

  /* ── Otras redes (se guarda como JSON en el ajuste extra_socials: [{ name, url }]) ── */
  function socialListField(name, label, value) {
    return `<div class="span-all social-list" data-name="${name}">
      <label>${label}</label>
      <p class="hint">Agrega las que quieras: nombre y enlace completo (https://…). El ícono se elige solo según el enlace; si la red no se reconoce, se muestra un ícono de enlace.</p>
      <input type="hidden" name="${name}" value="${esc(value || '[]')}">
      <div class="rows" style="margin:12px 0"></div>
      <button type="button" class="btn btn--ghost btn--sm" data-sadd>+ Agregar red</button>
    </div>`;
  }
  const socialRow = (m = {}) => `<div class="row row--social" draggable="true">
    <span class="handle">⋮⋮</span>
    <input data-k="name" value="${esc(m.name)}" placeholder="Nombre (ej. IMDb)">
    <input data-k="url" value="${esc(m.url)}" placeholder="https://www.imdb.com/…">
    <button type="button" class="btn btn--danger btn--sm" data-remove>×</button>
  </div>`;
  function bindSocialList() {
    $$('.social-list').forEach((box) => {
      const rows = $('.rows', box);
      let list = [];
      try { list = JSON.parse($('input[type=hidden]', box).value || '[]'); } catch { list = []; }
      list.forEach((m) => rows.insertAdjacentHTML('beforeend', socialRow(m)));
      $('[data-sadd]', box).addEventListener('click', () => { rows.insertAdjacentHTML('beforeend', socialRow()); $('.row:last-child [data-k=name]', rows).focus(); });
      rows.addEventListener('click', (e) => { if (e.target.closest('[data-remove]')) e.target.closest('.row').remove(); });
      enableDragSort(rows);
    });
  }
  function serializeSocialList() {
    $$('.social-list').forEach((box) => {
      const list = $$('.row', box).map((r) => ({ name: $('[data-k=name]', r).value.trim(), url: $('[data-k=url]', r).value.trim() }))
        .filter((m) => /^https?:\/\//i.test(m.url));
      $('input[type=hidden]', box).value = JSON.stringify(list);
    });
  }

  views.textos = async () => {
    const s = await api('/api/admin/settings');
    view.innerHTML = `
      <div class="page-head"><div><h1>Textos del sitio</h1><p>Eslogan, portada, sección del estudio, contacto y redes.</p></div></div>
      <form id="settings-form">
        ${SETTINGS_GROUPS.map(([title, fields]) => `
          <div class="panel"><h2>${title}</h2><div class="form-grid">
            ${fields.map(([k, label, type, opts]) => type === 'videos' ? videoListField(k, label, s[k])
              : type === 'socials' ? socialListField(k, label, s[k])
              : type === 'select' ? `<label class="span-all" data-field="${k}">${label}<select name="${k}">${opts.map(([v, l]) => `<option value="${v}" ${(s[k] || opts[0][0]) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`
              : type === 'url' ? urlField(k, label, s[k])
              : type === 'textarea' ? `<label class="span-all">${label}<textarea name="${k}" rows="6">${esc(s[k])}</textarea></label>`
              : `<label data-field="${k}"${k === 'hero_embed_url' ? ' class="span-all"' : ''}>${label}<input name="${k}" value="${esc(s[k])}"></label>`).join('')}
          </div></div>`).join('')}
        <div class="savebar"><a class="btn btn--ghost" href="/" target="_blank">Ver sitio ↗</a><button class="btn btn--primary">Guardar cambios</button></div>
      </form>`;
    bindVideoList();
    bindSocialList();
    // Portada: según el tipo elegido, se muestran los campos del showreel o el del link de YouTube/Vimeo
    const modeSel = $('[name=hero_mode]');
    if (modeSel) {
      // Si nunca se eligió, se adivina por lo que hay guardado (antes un link de YouTube podía ir primero en la lista)
      if (!s.hero_mode) {
        let list = []; try { list = JSON.parse(s.hero_videos || '[]'); } catch { /* vacío */ }
        if (/(youtube\.com|youtu\.be|vimeo\.com)\//i.test(list[0] || '')) {
          modeSel.value = 'embed';
          const emb = $('[name=hero_embed_url]'); if (emb && !emb.value) emb.value = list[0];
        }
      }
      const reelOnly = [$('.video-list[data-name=hero_videos]'), $('[data-field=hero_clip_seconds]')];
      const embedOnly = [$('[data-field=hero_embed_url]')];
      const sync = () => {
        const embed = modeSel.value === 'embed';
        reelOnly.forEach((el) => { if (el) el.hidden = embed; });
        embedOnly.forEach((el) => { if (el) el.hidden = !embed; });
      };
      modeSel.addEventListener('change', sync); sync();
    }
    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      serializeVideoList();
      serializeSocialList();
      run($('.savebar .btn--primary'), () => api('/api/admin/settings', { method: 'PUT', body: formData(e.target) }));
    });
  };

  /* ═════════════ VISTA: Categorías ═════════════ */
  views.categorias = async (id) => {
    const cats = await api('/api/admin/categories');
    cache.categories = cats;
    const editing = id === 'nueva' ? {} : cats.find((c) => String(c.id) === id);

    view.innerHTML = `
      <div class="page-head"><div><h1>Categorías</h1><p>Largometrajes, series, comerciales… El orden define cómo aparecen en el sitio.</p></div>
        <a class="btn btn--primary" href="#categorias/nueva">+ Nueva categoría</a></div>
      ${editing ? `
        <form class="panel" id="cat-form">
          <h2>${editing.id ? 'Editar' : 'Nueva'} categoría</h2>
          <div class="form-grid">
            <label>Nombre<input name="name" required value="${esc(editing.name)}"></label>
            <label>Slug (URL)<input name="slug" value="${esc(editing.slug)}" placeholder="se genera solo"></label>
            <label>Orden<input name="sort_order" type="number" value="${esc(editing.sort_order ?? 0)}"></label>
            <label class="span-all">Descripción<textarea name="description" rows="3">${esc(editing.description)}</textarea></label>
            ${urlField('cover_url', 'Imagen o video de la franja en "Work" (ancho completo, horizontal: .jpg de ~2000 px o .mp4 corto sin sonido). Si lo dejas vacío se usa la imagen panorámica de su primer proyecto (o la primera foto, si es galería)', editing.cover_url)}
            <label class="check span-all"><input type="checkbox" name="is_gallery" ${+editing.is_gallery ? 'checked' : ''}>
              Galería de fotos (ej. Photography): al hacer clic en la categoría se abre una galería con sus fotos, en vez de una lista de proyectos</label>
          </div>
          <div class="savebar"><a class="btn btn--ghost" href="#categorias">Cancelar</a><button class="btn btn--primary">Guardar</button></div>
        </form>
        ${editing.id ? `
        <div class="panel" id="catphotos" ${+editing.is_gallery ? '' : 'hidden'}>
          <div class="panel__head"><h2>Fotos de la galería <small class="hint" id="catphoto-count"></small></h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <label class="btn btn--primary btn--sm">Subir fotos<input type="file" id="catphotos-upload" multiple hidden accept="image/jpeg,image/png,image/webp,image/avif"></label>
              <button class="btn btn--ghost btn--sm" id="catphotos-add">+ Desde biblioteca</button></div></div>
          <p class="hint">Puedes elegir muchas fotos a la vez; se guardan solas al subirlas. Arrastra ⋮⋮ para ordenar (las primeras salen arriba).
            JPG o WebP de unos 2000 px por el lado largo; verticales y horizontales se acomodan solas en la galería.</p>
          <div class="progress" id="catphotos-progress" hidden><span></span></div>
          <div class="rows" id="catphoto-rows" style="margin-top:14px"></div>
          <div class="savebar"><button class="btn btn--primary" id="catphotos-save">Guardar fotos</button></div>
        </div>` : ''}` : ''}
      <div class="panel table-wrap"><table class="table">
        <thead><tr><th></th><th>Nombre</th><th>Contenido</th><th>Orden</th><th></th></tr></thead>
        <tbody>${cats.map((c) => `<tr>
          <td>${thumb(c.cover_url, 'thumb thumb--wide')}</td>
          <td><b>${esc(c.name)}</b><div class="hint">/${esc(c.slug)}</div></td>
          <td>${+c.is_gallery ? `${c.photo_count} fotos <span class="tag">Galería</span>` : `${c.project_count} proyectos`}</td><td>${c.sort_order}</td>
          <td><div class="actions"><a class="btn btn--ghost btn--sm" href="#categorias/${c.id}">Editar</a>
            <button class="btn btn--danger btn--sm" data-del="${c.id}">Eliminar</button></div></td></tr>`).join('')
          || '<tr><td colspan="5" class="empty">Sin categorías</td></tr>'}</tbody></table></div>`;

    const form = $('#cat-form');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = await run($('.btn--primary', form), () => editing.id
        ? api(`/api/admin/categories/${editing.id}`, { method: 'PUT', body: formData(form) })
        : api('/api/admin/categories', { method: 'POST', body: formData(form) }));
      if (ok) location.hash = 'categorias';
    });
    // Galería de fotos de la categoría
    const box = $('#catphotos');
    if (box) {
      $('[name=is_gallery]', form).addEventListener('change', (e) => { box.hidden = !e.target.checked; });
      const rows = $('#catphoto-rows');
      const row = (m = {}) => `<div class="row row--photo" draggable="true">
        <span class="handle" title="Arrastrar">⋮⋮</span>
        <img class="preview" src="${esc(m.url)}" alt="">
        <input data-k="url" placeholder="URL de la foto" value="${esc(m.url)}">
        <input data-k="caption" placeholder="Pie de foto en inglés (opcional)" value="${esc(m.caption)}">
        <button class="btn btn--danger btn--sm" data-remove title="Quitar">×</button>
      </div>`;
      const count = () => {
        const n = $$('.row', rows).length;
        $('#catphoto-count').textContent = n ? `· ${n}` : '';
        if (!n && !$('.empty', rows)) rows.innerHTML = '<p class="empty">Aún no hay fotos. Pulsa "Subir fotos".</p>';
      };
      const append = (m) => { $('.empty', rows)?.remove(); rows.insertAdjacentHTML('beforeend', row(m)); count(); };
      const collect = () => $$('.row', rows).map((r) => ({ url: $('[data-k=url]', r).value.trim(), caption: $('[data-k=caption]', r).value.trim() })).filter((m) => m.url);
      const save = (btn, msg = 'Fotos guardadas') => run(btn, () => api(`/api/admin/categories/${editing.id}/photos`, { method: 'PUT', body: collect() }), msg);
      (await api(`/api/admin/categories/${editing.id}/photos`)).forEach(append); count();
      $('#catphotos-add').addEventListener('click', async () => { const url = await pickMedia(); if (url && !isVideo(url)) append({ url }); });
      $('#catphotos-upload').addEventListener('change', async (e) => {
        const bar = $('#catphotos-progress'); bar.hidden = false;
        const saved = await run(null, () => uploadFiles(e.target.files, (f) => { bar.firstElementChild.style.width = f * 100 + '%'; }), null);
        bar.hidden = true; bar.firstElementChild.style.width = 0; e.target.value = '';
        if (!saved || !saved.length) return;
        saved.forEach((f) => append({ url: f.url }));
        save(null, `${saved.length} foto${saved.length > 1 ? 's' : ''} subida${saved.length > 1 ? 's' : ''} y guardada${saved.length > 1 ? 's' : ''}`);
      });
      rows.addEventListener('input', (e) => { if (e.target.dataset.k === 'url') e.target.closest('.row').querySelector('.preview').src = e.target.value; });
      rows.addEventListener('click', (e) => { if (e.target.closest('[data-remove]')) { e.target.closest('.row').remove(); count(); } });
      enableDragSort(rows);
      $('#catphotos-save').addEventListener('click', (e) => save(e.target));
    }
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta categoría? Sus proyectos quedarán sin categoría (no se borran).')) return;
      await run(b, () => api(`/api/admin/categories/${b.dataset.del}`, { method: 'DELETE' }), 'Categoría eliminada');
      location.hash = 'categorias'; route();
    }));
  };

  /* ═════════════ VISTA: News (prensa, premios, festivales, videos) ═════════════ */
  const NEWS_KINDS = [
    ['press', 'Prensa / artículo', 'Una nota o artículo donde mencionan a DayOff (pon el enlace a la nota)'],
    ['award', 'Premio', 'Un premio ganado — se muestra con laurel, como en los pósters de cine'],
    ['festival', 'Selección oficial / festival', 'Selección o nominación en un festival — también con laurel'],
    ['video', 'Video / entrevista', 'Reportaje, entrevista o noticia en video (YouTube, Vimeo o archivo): se reproduce en el sitio']
  ];
  const kindName = (k) => (NEWS_KINDS.find((x) => x[0] === k) || NEWS_KINDS[0])[1];

  views.news = async (id) => {
    const [list, projects] = await Promise.all([api('/api/admin/news'), api('/api/admin/projects')]);
    const editing = id === 'nueva' ? { kind: 'press', published: 1 } : list.find((n) => String(n.id) === id);

    view.innerHTML = `
      <div class="page-head"><div><h1>News</h1><p>Prensa, premios, festivales y videos donde aparece la marca. La sección "News" del sitio solo se muestra cuando hay al menos una publicada.</p></div>
        <a class="btn btn--primary" href="#news/nueva">+ Nueva noticia</a></div>
      ${editing ? `
        <form class="panel" id="news-form">
          <h2>${editing.id ? 'Editar' : 'Nueva'} noticia</h2>
          <div class="form-grid">
            <label>Tipo<select name="kind" id="news-kind">${NEWS_KINDS.map(([v, l]) => `<option value="${v}" ${editing.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <span class="hint" id="news-kind-hint"></span></label>
            <label>Fecha<input type="date" name="published_at" value="${esc(editing.published_at || '')}"></label>
            <label class="span-all">Título — titular de la nota, nombre del premio (ej. "Best Short Film") o del video<input name="title" required value="${esc(editing.title)}"></label>
            <label>Medio / festival / quien lo otorga (ej. "Variety", "Bogoshorts")<input name="outlet" value="${esc(editing.outlet)}"></label>
            <label>Proyecto relacionado (opcional)<select name="project_id"><option value="">— Ninguno —</option>
              ${projects.map((p) => `<option value="${p.id}" ${String(editing.project_id) === String(p.id) ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
            <label class="span-all">Resumen / cita corta (opcional)<textarea name="excerpt" rows="3">${esc(editing.excerpt)}</textarea></label>
            <label class="span-all">Enlace a la nota o al premio (opcional)<input name="url" type="url" placeholder="https://…" value="${esc(editing.url)}"></label>
            <label class="span-all">Video (YouTube, Vimeo o archivo .mp4) — para entrevistas o reportajes<input name="video_url" placeholder="https://www.youtube.com/watch?v=…" value="${esc(editing.video_url)}"></label>
            ${urlField('image_url', 'Imagen (foto de la nota, del premio o del evento; para videos de YouTube se usa la miniatura si la dejas vacía)', editing.image_url)}
            <label>Orden (si hay varias con la misma fecha)<input name="sort_order" type="number" value="${esc(editing.sort_order ?? 0)}"></label>
            <label class="check"><input type="checkbox" name="published" ${+editing.published ? 'checked' : ''}> Publicada (visible en el sitio)</label>
            <label class="check"><input type="checkbox" name="featured" ${+editing.featured ? 'checked' : ''}> Destacada (aparece primero y en grande)</label>
          </div>
          <div class="savebar"><a class="btn btn--ghost" href="#news">Cancelar</a><button class="btn btn--primary">Guardar</button></div>
        </form>` : ''}
      <div class="panel table-wrap"><table class="table">
        <thead><tr><th></th><th>Título</th><th>Tipo</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
        <tbody>${list.map((n) => `<tr>
          <td>${thumb(n.image_url, 'thumb thumb--wide')}</td>
          <td><b>${esc(n.title)}</b><div class="hint">${esc(n.outlet || '')}${n.project_title ? ` · ${esc(n.project_title)}` : ''}</div></td>
          <td>${esc(kindName(n.kind))}</td><td>${esc(n.published_at || '—')}</td>
          <td>${+n.published ? '<span class="tag tag--ok">Publicada</span>' : '<span class="tag">Borrador</span>'}
              ${+n.featured ? '<span class="tag tag--accent">Destacada</span>' : ''}</td>
          <td><div class="actions"><a class="btn btn--ghost btn--sm" href="#news/${n.id}">Editar</a>
            <button class="btn btn--danger btn--sm" data-del-news="${n.id}">Eliminar</button></div></td></tr>`).join('')
          || '<tr><td colspan="6" class="empty">Aún no hay noticias. Agrega la primera con "+ Nueva noticia".</td></tr>'}</tbody></table></div>`;

    const form = $('#news-form');
    if (form) {
      const kindSel = $('#news-kind'), hint = $('#news-kind-hint');
      const showHint = () => { hint.textContent = (NEWS_KINDS.find((k) => k[0] === kindSel.value) || [])[2] || ''; };
      kindSel.addEventListener('change', showHint); showHint();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await run($('.btn--primary', form), () => editing.id
          ? api(`/api/admin/news/${editing.id}`, { method: 'PUT', body: formData(form) })
          : api('/api/admin/news', { method: 'POST', body: formData(form) }), 'Noticia guardada');
        if (ok) location.hash = 'news';
      });
    }
    $$('[data-del-news]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta noticia?')) return;
      await run(b, () => api(`/api/admin/news/${b.dataset.delNews}`, { method: 'DELETE' }), 'Noticia eliminada');
      location.hash = 'news'; route();
    }));
  };

  /* ═════════════ VISTA: Galería del estudio ("On set" en el sitio): videos ═════════════ */
  const ytIdOf = (u) => (String(u || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/) || [])[1];
  const isEmbedUrl = (u) => /(youtube\.com|youtu\.be|vimeo\.com)\//i.test(u || '');
  /** Miniatura de la fila: el video propio, la portada, o la miniatura de YouTube. */
  const clipPreview = (url, poster) => {
    if (poster) return `<img class="preview" src="${esc(poster)}" alt="">`;
    if (isVideo(url)) return `<video class="preview" src="${esc(url)}#t=0.5" muted preload="metadata"></video>`;
    const yt = ytIdOf(url);
    if (yt) return `<img class="preview" src="https://i.ytimg.com/vi/${yt}/mqdefault.jpg" alt="">`;
    if (isEmbedUrl(url)) return '<span class="preview preview--label">Vimeo</span>';
    return url ? `<img class="preview" src="${esc(url)}" alt="">` : '<span class="preview"></span>';
  };

  views.galeria = async () => {
    const list = await api('/api/admin/studio-photos');
    view.innerHTML = `
      <div class="page-head"><div><h1>Featured Work · videos y fotos</h1>
        <p>Videos y fotos de rodaje y detrás de cámaras. Aparecen en el sitio en la sección "Featured Work":
           los videos se reproducen solos y sin sonido mientras se ven; videos y fotos se abren en grande al hacer clic.
           Puedes mezclarlos en el orden que quieras. Si no hay ninguno publicado, la sección no se muestra.</p></div></div>
      <div class="panel">
        <div class="panel__head"><h2>Videos y fotos <small class="hint" id="clip-count"></small></h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <label class="btn btn--primary btn--sm">Subir videos o fotos<input type="file" id="clips-upload" multiple hidden accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp,image/avif"></label>
            <button class="btn btn--ghost btn--sm" id="clips-link">+ Link de YouTube / Vimeo</button>
            <button class="btn btn--ghost btn--sm" id="clips-add">+ Desde biblioteca</button></div></div>
        <p class="hint">
          <b>Fotos:</b> JPG o WebP de unos 2000 px de ancho (horizontales o verticales; el sitio las encuadra solo).<br>
          <b>Clips cortos (10 a 60 s):</b> súbelos como archivo MP4 (H.264), máximo 200 MB; mejor si pesan menos de 30 MB (en HandBrake: preset "Fast 1080p30").<br>
          <b>Videos largos (making of, entrevistas):</b> súbelos a YouTube o Vimeo y pega el link aquí: cargan más rápido y no ocupan espacio.<br>
          Arrastra ⋮⋮ para ordenar: los primeros salen arriba.</p>
        <div class="progress" id="clips-progress" hidden><span></span></div>
        <div class="rows" id="clip-rows" style="margin-top:14px"></div>
      </div>
      <div class="savebar"><button class="btn btn--primary" id="clips-save">Guardar galería</button></div>`;

    const rows = $('#clip-rows');
    const clipRow = (m = {}) => `<div class="row row--clip" draggable="true">
      <span class="handle" title="Arrastrar">⋮⋮</span>
      <span class="clip-prev">${clipPreview(m.url)}</span>
      <div class="clip-fields">
        <div class="clip-url"><input data-k="url" placeholder="Foto, archivo de video o link de YouTube / Vimeo" value="${esc(m.url)}">
          <button type="button" class="btn btn--ghost btn--sm" data-pick-row="url">Biblioteca</button></div>
        <input data-k="caption" placeholder="Pie en inglés (opcional, ej. Behind the scenes — TITO, 2024)" value="${esc(m.caption)}">
      </div>
      <label class="check"><input type="checkbox" data-k="published" ${m.published === undefined || +m.published ? 'checked' : ''}> Publicado</label>
      <button class="btn btn--danger btn--sm" data-remove title="Quitar">×</button>
    </div>`;
    const count = () => {
      const n = $$('.row', rows).length;
      $('#clip-count').textContent = n ? `· ${n}` : '';
      if (!n && !$('.empty', rows)) rows.innerHTML = '<p class="empty">Aún no hay nada. Pulsa "Subir videos o fotos" o "+ Link de YouTube / Vimeo".</p>';
    };
    const append = (m) => { $('.empty', rows)?.remove(); rows.insertAdjacentHTML('beforeend', clipRow(m)); count(); return rows.lastElementChild; };
    const refreshPrev = (row) => { $('.clip-prev', row).innerHTML = clipPreview($('[data-k=url]', row).value.trim()); };
    const collect = () => $$('.row', rows).map((r) => ({
      url: $('[data-k=url]', r).value.trim(),
      caption: $('[data-k=caption]', r).value.trim(), published: $('[data-k=published]', r).checked ? 1 : 0
    })).filter((m) => m.url);
    const save = (btn, msg = 'Galería guardada') => run(btn, () => api('/api/admin/studio-photos', { method: 'PUT', body: collect() }), msg);

    list.forEach(append); count();

    $('#clips-add').addEventListener('click', async () => { const url = await pickMedia(); if (url) append({ url }); });
    $('#clips-link').addEventListener('click', () => { const r = append({}); $('[data-k=url]', r).focus(); });
    // Al subir, los videos se añaden y la galería se guarda sola
    $('#clips-upload').addEventListener('change', async (e) => {
      const big = [...e.target.files].find((f) => f.size > 200 * 1024 * 1024);
      if (big) { toast(`"${big.name}" pesa ${Math.round(big.size / 1048576)} MB (máximo 200 MB). Comprímelo o súbelo a YouTube/Vimeo y pega el link.`, true); e.target.value = ''; return; }
      const bar = $('#clips-progress'); bar.hidden = false;
      const saved = await run(null, () => uploadFiles(e.target.files, (f) => { bar.firstElementChild.style.width = f * 100 + '%'; }), null);
      bar.hidden = true; bar.firstElementChild.style.width = 0; e.target.value = '';
      if (!saved || !saved.length) return;
      saved.forEach((f) => append({ url: f.url }));
      save(null, `${saved.length} archivo${saved.length > 1 ? 's' : ''} subido${saved.length > 1 ? 's' : ''} y guardado${saved.length > 1 ? 's' : ''}`);
    });
    rows.addEventListener('click', async (e) => {
      if (e.target.closest('[data-remove]')) { e.target.closest('.row').remove(); count(); return; }
      const pick = e.target.closest('[data-pick-row]');
      if (pick) {
        const url = await pickMedia();
        if (!url) return;
        const row = pick.closest('.row');
        $(`[data-k=${pick.dataset.pickRow}]`, row).value = url;
        refreshPrev(row);
      }
    });
    rows.addEventListener('change', (e) => { if (e.target.dataset.k === 'url') refreshPrev(e.target.closest('.row')); });
    enableDragSort(rows);
    $('#clips-save').addEventListener('click', (e) => save(e.target));
  };

  /* ═════════════ VISTA: Proyectos ═════════════ */
  function projectTable(list, spotlightId) {
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th></th><th>Título</th><th>Categoría</th><th>Año</th><th>Estado</th><th></th></tr></thead>
      <tbody>${list.map((p) => `<tr>
        <td>${thumb(p.poster_url)}</td>
        <td><b>${esc(p.title)}</b><div class="hint">/project/${esc(p.slug)}</div></td>
        <td>${esc(p.category_name || '—')}</td><td>${esc(p.year || '')}</td>
        <td>${+p.published ? '<span class="tag tag--ok">Publicado</span>' : '<span class="tag">Borrador</span>'}
            ${+p.featured ? '<span class="tag tag--accent">Destacado</span>' : ''}
            ${String(p.id) === String(spotlightId) ? '<span class="tag tag--release">★ Estreno</span>' : ''}</td>
        <td><div class="actions">
          <a class="btn btn--ghost btn--sm" href="/project/${esc(p.slug)}" target="_blank">Ver</a>
          <a class="btn btn--ghost btn--sm" href="#proyectos/${p.id}">Editar</a>
          <button class="btn btn--danger btn--sm" data-del-project="${p.id}">Eliminar</button></div></td></tr>`).join('')
        || '<tr><td colspan="6" class="empty">Aún no hay proyectos</td></tr>'}</tbody></table></div>`;
  }

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-project]');
    if (!b) return;
    if (!confirm('¿Eliminar este proyecto con sus créditos y galería? Esta acción no se puede deshacer.')) return;
    await run(b, () => api(`/api/admin/projects/${b.dataset.delProject}`, { method: 'DELETE' }), 'Proyecto eliminado');
    location.hash = 'proyectos'; route();
  });

  views.proyectos = async (id) => {
    if (id) return projectEditor(id);
    const [list, settings] = await Promise.all([api('/api/admin/projects'), api('/api/admin/settings')]);
    view.innerHTML = `
      <div class="page-head"><div><h1>Proyectos</h1><p>Películas, series, comerciales y documentales.</p></div>
        <a class="btn btn--primary" href="#proyectos/nuevo">+ Nuevo proyecto</a></div>
      <p class="hint" style="margin:-14px 0 18px">★ Estreno = el proyecto que aparece a pantalla completa justo después de la portada. Se elige dentro de cada proyecto (pestaña Información → Publicación). Si no marcas ninguno, se muestra automáticamente el más reciente.</p>
      <div class="panel">${projectTable(list, settings.spotlight_project_id)}</div>`;
  };

  async function projectEditor(id) {
    const isNew = id === 'nuevo';
    const [p, cats, people, settings] = await Promise.all([
      isNew ? Promise.resolve({ published: 1, credits: [], media: [] }) : api(`/api/admin/projects/${id}`),
      api('/api/admin/categories'), api('/api/admin/people'), api('/api/admin/settings')
    ]);
    const isSpotlight = !isNew && String(settings.spotlight_project_id) === String(p.id);
    cache.people = people;

    view.innerHTML = `
      <div class="page-head"><div><a href="#proyectos" class="hint">← Proyectos</a><h1>${isNew ? 'Nuevo proyecto' : esc(p.title)}</h1></div>
        ${isNew ? '' : `<a class="btn btn--ghost" href="/project/${esc(p.slug)}" target="_blank">Ver en el sitio ↗</a>`}</div>
      <div class="tabs">
        <button class="is-active" data-tab="info">Información</button>
        <button data-tab="credits" ${isNew ? 'disabled title="Guarda primero el proyecto"' : ''}>Créditos (${p.credits.length})</button>
        <button data-tab="media" ${isNew ? 'disabled title="Guarda primero el proyecto"' : ''}>Galería (${p.media.length})</button>
      </div>

      <!-- Información general -->
      <form class="tab" data-pane="info" id="project-form">
        <div class="panel"><h2>Ficha</h2><div class="form-grid">
          <label>Título<input name="title" required value="${esc(p.title)}"></label>
          <label>Categoría<select name="category_id"><option value="">— Sin categoría —</option>
            ${cats.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>Año<input name="year" type="number" min="1900" max="2100" value="${esc(p.year)}"></label>
          <label>Director/a<input name="director" value="${esc(p.director)}"></label>
          <label>Duración<input name="duration" value="${esc(p.duration)}" placeholder="98 min · 8 × 45 min"></label>
          <label>Género<input name="genre" value="${esc(p.genre)}"></label>
          <label class="span-all">Frase / tagline<input name="tagline" value="${esc(p.tagline)}"></label>
          <label class="span-all">Sinopsis<textarea name="synopsis" rows="6">${esc(p.synopsis)}</textarea></label>
        </div></div>
        <div class="panel"><h2>Imágenes y tráiler</h2><div class="form-grid">
          ${urlField('poster_url', 'Póster (vertical 2:3, ej. 1000×1500)', p.poster_url)}
          ${urlField('backdrop_url', 'Imagen panorámica (16:9, ej. 1920×1080)', p.backdrop_url)}
          ${urlField('trailer_url', 'Tráiler', p.trailer_url, 'Pega un enlace de YouTube o Vimeo (recomendado) o elige un .mp4 de la biblioteca.')}
        </div></div>
        <div class="panel"><h2>Publicación</h2><div class="form-grid">
          <label class="check"><input type="checkbox" name="published" ${+p.published ? 'checked' : ''}> Publicado (visible en el sitio)</label>
          <label class="check"><input type="checkbox" name="featured" ${+p.featured ? 'checked' : ''}> Destacado ("Now Showing")</label>
          <label class="check span-all"><input type="checkbox" id="spotlight-check" ${isSpotlight ? 'checked' : ''}>
            <span><b>★ Estreno en portada</b> — aparece a pantalla completa justo después del video de inicio (solo un proyecto a la vez; si no hay ninguno marcado, se usa el más reciente)</span></label>
          <label>Orden<input name="sort_order" type="number" value="${esc(p.sort_order ?? 0)}"></label>
          <label>Slug (URL)<input name="slug" value="${esc(p.slug)}" placeholder="se genera del título"></label>
        </div></div>
        <div class="savebar">
          ${isNew ? '' : '<button type="button" class="btn btn--danger" data-del-project="' + p.id + '">Eliminar</button>'}
          <button class="btn btn--primary">${isNew ? 'Crear proyecto' : 'Guardar ficha'}</button></div>
      </form>

      <!-- Créditos -->
      <div class="tab" data-pane="credits" hidden>
        <div class="panel">
          <div class="panel__head"><h2>Créditos</h2><button class="btn btn--ghost btn--sm" id="add-credit">+ Añadir crédito</button></div>
          <p class="hint" style="margin-bottom:14px">Elige una persona de la lista para enlazar su biografía, o escribe el nombre libremente. Arrastra ⋮⋮ para reordenar.
            Las biografías se editan en <a href="#personas">Actores y artistas</a>.</p>
          <datalist id="people-list">${people.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>
          <div class="rows" id="credit-rows"></div>
        </div>
        <div class="savebar"><button class="btn btn--primary" id="save-credits">Guardar créditos</button></div>
      </div>

      <!-- Galería -->
      <div class="tab" data-pane="media" hidden>
        <div class="panel">
          <div class="panel__head"><h2>Galería</h2>
            <div style="display:flex;gap:8px">
              <label class="btn btn--ghost btn--sm">Subir archivos<input type="file" id="gallery-upload" multiple hidden accept="image/*,video/mp4,video/webm,video/quicktime"></label>
              <button class="btn btn--ghost btn--sm" id="add-media">+ Desde biblioteca / URL</button></div></div>
          <div class="progress" id="gallery-progress" hidden><span></span></div>
          <div class="rows" id="media-rows" style="margin-top:14px"></div>
        </div>
        <div class="savebar"><button class="btn btn--primary" id="save-media">Guardar galería</button></div>
      </div>`;

    // Pestañas
    $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
      $$('.tabs button').forEach((x) => x.classList.toggle('is-active', x === b));
      $$('.tab').forEach((t) => { t.hidden = t.dataset.pane !== b.dataset.tab; });
    }));

    // Guardar ficha
    $('#project-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      const r = await run($('#project-form .btn--primary'), () => isNew
        ? api('/api/admin/projects', { method: 'POST', body })
        : api(`/api/admin/projects/${p.id}`, { method: 'PUT', body }), isNew ? 'Proyecto creado' : 'Ficha guardada');
      // Estreno en portada: se guarda como ajuste del sitio (solo un proyecto a la vez)
      if (r) {
        const pid = isNew ? r.id : p.id;
        const want = $('#spotlight-check').checked;
        if (want && String(settings.spotlight_project_id) !== String(pid)) {
          await api('/api/admin/settings', { method: 'PUT', body: { spotlight_project_id: String(pid) } });
          settings.spotlight_project_id = String(pid);
        } else if (!want && String(settings.spotlight_project_id) === String(pid)) {
          await api('/api/admin/settings', { method: 'PUT', body: { spotlight_project_id: '' } });
          settings.spotlight_project_id = '';
        }
      }
      if (r && isNew) location.hash = `proyectos/${r.id}`;
      // Refresca el encabezado, el slug y el enlace "Ver en el sitio" con lo recién guardado
      if (r && !isNew) {
        p.title = body.title; p.slug = r.slug || p.slug;
        $('.page-head h1').textContent = p.title;
        $('#project-form [name=slug]').value = p.slug;
        const ver = $('.page-head a[target=_blank]');
        if (ver) ver.href = `/project/${p.slug}`;
        // El director se copia solo al crédito de dirección: la pestaña Créditos se refresca con lo guardado
        if (r.credits) setCredits(r.credits);
      }
    });

    // Slug automático: mientras no lo hayas escrito a mano, sigue al título (Avatar: Fire and Ash → avatar-fire-and-ash)
    const toSlug = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const titleIn = $('#project-form [name=title]'), slugIn = $('#project-form [name=slug]');
    let slugAuto = !slugIn.value || slugIn.value === toSlug(titleIn.value) || slugIn.value.replace(/-\d+$/, '') === toSlug(titleIn.value);
    titleIn.addEventListener('input', () => { if (slugAuto) slugIn.value = toSlug(titleIn.value); });
    slugIn.addEventListener('input', () => { slugAuto = !slugIn.value; });
    if (isNew) return;

    /* ── Créditos ── */
    const creditRow = (c = {}) => {
      const person = people.find((x) => x.id === c.person_id);
      return `<div class="row row--credit" draggable="true">
        <span class="handle" title="Arrastrar">⋮⋮</span>
        <select data-k="department">
          ${[['reparto', 'Reparto'], ['artistas', 'Artistas'], ['equipo', 'Equipo técnico']].map(([v, l]) => `<option value="${v}" ${c.department === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <input data-k="name" list="people-list" placeholder="Nombre" value="${esc(person ? person.name : c.name)}">
        <input data-k="role" placeholder="Rol (ej. Protagonista, Montaje)" value="${esc(c.role)}">
        <button class="btn btn--danger btn--sm" data-remove>×</button>
      </div>`;
    };
    const creditRows = $('#credit-rows');
    function setCredits(list) {
      p.credits = list;
      creditRows.innerHTML = list.map(creditRow).join('');
      const tab = $('.tabs [data-tab=credits]');
      if (tab) tab.textContent = `Créditos (${list.length})`;
    }
    setCredits(p.credits);
    $('#add-credit').addEventListener('click', () => creditRows.insertAdjacentHTML('beforeend', creditRow({ department: 'reparto' })));
    $('#save-credits').addEventListener('click', (e) => {
      const list = $$('.row', creditRows).map((r) => {
        const name = $('[data-k=name]', r).value.trim();
        const person = people.find((x) => x.name.toLowerCase() === name.toLowerCase());
        return { department: $('[data-k=department]', r).value, role: $('[data-k=role]', r).value.trim(), name, person_id: person ? person.id : null };
      }).filter((c) => c.name || c.role);
      run(e.target, () => api(`/api/admin/projects/${p.id}/credits`, { method: 'PUT', body: list }), 'Créditos guardados').then((r) => {
        if (!r) return;
        if (r.credits) setCredits(r.credits);
        // …y al revés: el crédito de dirección actualiza el campo Director/a de la ficha
        if (r.director) { p.director = r.director; const d = $('#project-form [name=director]'); if (d) d.value = r.director; }
      });
    });

    /* ── Galería ── */
    const mediaRow = (m = {}) => `<div class="row row--media" draggable="true">
      <span class="handle">⋮⋮</span>
      ${isVideo(m.url) || m.type === 'video' ? `<video class="preview" src="${esc(m.url)}" muted></video>` : `<img class="preview" src="${esc(m.url)}" alt="">`}
      <select data-k="type"><option value="image" ${m.type !== 'video' ? 'selected' : ''}>Imagen</option><option value="video" ${m.type === 'video' ? 'selected' : ''}>Video</option></select>
      <input data-k="url" placeholder="URL" value="${esc(m.url)}">
      <input data-k="caption" placeholder="Pie de foto" value="${esc(m.caption)}">
      <button class="btn btn--danger btn--sm" data-remove>×</button>
    </div>`;
    const mediaRows = $('#media-rows');
    const renderMedia = (list) => { mediaRows.innerHTML = list.length ? list.map(mediaRow).join('') : '<p class="empty">Sin imágenes todavía.</p>'; };
    renderMedia(p.media);
    const appendMedia = (m) => { $('.empty', mediaRows)?.remove(); mediaRows.insertAdjacentHTML('beforeend', mediaRow(m)); };

    $('#add-media').addEventListener('click', async () => { const url = await pickMedia(); if (url) appendMedia({ url, type: isVideo(url) ? 'video' : 'image' }); });
    $('#gallery-upload').addEventListener('change', async (e) => {
      const bar = $('#gallery-progress'); bar.hidden = false;
      const saved = await run(null, () => uploadFiles(e.target.files, (f) => { bar.firstElementChild.style.width = f * 100 + '%'; }), 'Archivos subidos — recuerda guardar la galería');
      bar.hidden = true; bar.firstElementChild.style.width = 0; e.target.value = '';
      (saved || []).forEach((f) => appendMedia({ url: f.url, type: f.mime.startsWith('video') ? 'video' : 'image' }));
    });
    mediaRows.addEventListener('input', (e) => {
      if (e.target.dataset.k !== 'url') return;
      const prev = e.target.closest('.row').querySelector('.preview');
      if (prev) prev.src = e.target.value;
    });
    $('#save-media').addEventListener('click', (e) => {
      const list = $$('.row', mediaRows).map((r) => ({ type: $('[data-k=type]', r).value, url: $('[data-k=url]', r).value.trim(), caption: $('[data-k=caption]', r).value.trim() }));
      run(e.target, () => api(`/api/admin/projects/${p.id}/media`, { method: 'PUT', body: list }), 'Galería guardada');
    });

    // Quitar filas + reordenar arrastrando (créditos y galería)
    [creditRows, mediaRows].forEach((container) => {
      container.addEventListener('click', (e) => { if (e.target.closest('[data-remove]')) e.target.closest('.row').remove(); });
      enableDragSort(container);
    });
  }

  /** Reordenar filas con drag & drop nativo. */
  function enableDragSort(container) {
    let dragged = null;
    container.addEventListener('dragstart', (e) => {
      // Solo se arrastra desde el asa, para no interferir con los inputs
      if (!e.target.classList?.contains('row')) return;
      dragged = e.target; dragged.classList.add('is-dragging');
    });
    container.addEventListener('dragend', () => { dragged && dragged.classList.remove('is-dragging'); dragged = null; });
    container.addEventListener('dragover', (e) => {
      if (!dragged) return;
      e.preventDefault();
      const after = [...container.querySelectorAll('.row:not(.is-dragging)')]
        .find((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
      after ? container.insertBefore(dragged, after) : container.appendChild(dragged);
    });
  }

  /* ═════════════ VISTA: Personas ═════════════ */
  views.personas = async (id) => {
    const people = await api('/api/admin/people');
    const editing = id === 'nueva' ? { kind: 'actor' } : people.find((x) => String(x.id) === id);
    const kinds = { actor: 'Actor / actriz', artista: 'Artista', equipo: 'Equipo técnico' };
    view.innerHTML = `
      <div class="page-head"><div><h1>Actores y artistas</h1><p>Biografías y fotos que aparecen al pulsar un nombre en los créditos.</p></div>
        <a class="btn btn--primary" href="#personas/nueva">+ Nueva persona</a></div>
      ${editing ? `
        <form class="panel" id="person-form">
          <h2>${editing.id ? 'Editar' : 'Nueva'} persona</h2>
          <div class="form-grid">
            <label>Nombre<input name="name" required value="${esc(editing.name)}"></label>
            <label>Tipo<select name="kind">${Object.entries(kinds).map(([k, l]) => `<option value="${k}" ${editing.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="span-all">Biografía<textarea name="bio" rows="7">${esc(editing.bio)}</textarea></label>
            ${urlField('photo_url', 'Foto (vertical 3:4)', editing.photo_url)}
          </div>
          <div class="savebar"><a class="btn btn--ghost" href="#personas">Cancelar</a><button class="btn btn--primary">Guardar</button></div>
        </form>` : ''}
      <div class="panel table-wrap"><table class="table">
        <thead><tr><th></th><th>Nombre</th><th>Tipo</th><th>Biografía</th><th></th></tr></thead>
        <tbody>${people.map((x) => `<tr>
          <td>${thumb(x.photo_url, 'thumb thumb--round')}</td><td><b>${esc(x.name)}</b></td>
          <td><span class="tag">${kinds[x.kind] || x.kind}</span></td>
          <td class="hint">${esc((x.bio || '').slice(0, 90))}${(x.bio || '').length > 90 ? '…' : ''}</td>
          <td><div class="actions"><a class="btn btn--ghost btn--sm" href="#personas/${x.id}">Editar</a>
            <button class="btn btn--danger btn--sm" data-del-person="${x.id}">Eliminar</button></div></td></tr>`).join('')
          || '<tr><td colspan="5" class="empty">Sin personas</td></tr>'}</tbody></table></div>`;

    const form = $('#person-form');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = await run($('.btn--primary', form), () => editing.id
        ? api(`/api/admin/people/${editing.id}`, { method: 'PUT', body: formData(form) })
        : api('/api/admin/people', { method: 'POST', body: formData(form) }));
      if (ok) location.hash = 'personas';
    });
    $$('[data-del-person]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta persona? Sus créditos se conservarán sin biografía.')) return;
      await run(b, () => api(`/api/admin/people/${b.dataset.delPerson}`, { method: 'DELETE' }), 'Eliminado');
      route();
    }));
  };

  /* ═════════════ VISTA: Biblioteca de medios ═════════════ */
  views.medios = async () => {
    const items = await api('/api/admin/uploads');
    const size = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
    view.innerHTML = `
      <div class="page-head"><div><h1>Biblioteca de medios</h1><p>Imágenes (JPG, PNG, WebP, AVIF) y videos (MP4, WebM, MOV).</p></div></div>
      <label class="dropzone" id="dropzone">
        <input type="file" multiple hidden accept="image/*,video/mp4,video/webm,video/quicktime">
        <b>Arrastra archivos aquí</b> o haz clic para elegir.<br>
        <span class="hint">Consejo: para tráileres y videos largos usa Vimeo/YouTube o un CDN de video (ver README).</span>
        <div class="progress" hidden><span></span></div>
      </label>
      <div class="media-grid">${items.map((m) => `
        <div class="media-item">${thumb(m.url, '')}
          <div class="media-item__info" title="${esc(m.original_name)}">${esc(m.original_name)} · ${size(m.size_bytes)}</div>
          <div class="media-item__actions">
            <button class="btn btn--ghost" data-copy="${esc(m.url)}">Copiar URL</button>
            <button class="btn btn--danger" data-del-upload="${m.id}">Borrar</button></div>
        </div>`).join('') || '<p class="empty">La biblioteca está vacía.</p>'}</div>`;

    const dz = $('#dropzone'), input = $('input', dz), bar = $('.progress', dz);
    const send = async (files) => {
      if (!files.length) return;
      bar.hidden = false;
      await run(null, () => uploadFiles(files, (f) => { bar.firstElementChild.style.width = f * 100 + '%'; }), `${files.length} archivo(s) subido(s)`);
      route();
    };
    input.addEventListener('change', () => send(input.files));
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
    dz.addEventListener('drop', (e) => send(e.dataTransfer.files));

    $$('[data-copy]').forEach((b) => b.addEventListener('click', () => {
      navigator.clipboard.writeText(location.origin + b.dataset.copy).then(() => toast('URL copiada'));
    }));
    $$('[data-del-upload]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Borrar el archivo del servidor? Si se usa en algún proyecto, dejará de verse.')) return;
      await run(b, () => api(`/api/admin/uploads/${b.dataset.delUpload}`, { method: 'DELETE' }), 'Archivo borrado');
      route();
    }));
  };

  /* ═════════════ VISTA: Cuenta ═════════════ */
  views.cuenta = async () => {
    const me = await api('/api/auth/me');
    view.innerHTML = `
      <div class="page-head"><div><h1>Cuenta</h1><p>Sesión iniciada como <b>${esc(me.username)}</b>.</p></div></div>
      <form class="panel" id="pass-form" style="max-width:520px">
        <h2>Cambiar contraseña</h2>
        <div class="form-grid" style="grid-template-columns:1fr">
          ${pwField('Contraseña actual', 'current', 'current-password')}
          ${pwField('Nueva contraseña (mín. 10 caracteres)', 'next', 'new-password', 'minlength="10"')}
          ${pwField('Repite la nueva contraseña', 'repeat', 'new-password')}
        </div>
        <div class="savebar"><button class="btn btn--primary">Actualizar contraseña</button></div>
      </form>`;
    $('#pass-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      if (d.next !== d.repeat) return toast('Las contraseñas no coinciden', true);
      const ok = await run($('.btn--primary', e.target), () => api('/api/auth/password', { method: 'POST', body: d }), 'Contraseña actualizada');
      if (ok) { e.target.reset(); $$('.pw', e.target).forEach((w) => togglePw(w, false)); }
    });
  };

  /** Campo de contraseña con ojito para mostrarla u ocultarla (igual que en el inicio de sesión). */
  const EYE = '<svg class="pw__eye" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg class="pw__eye-off" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 4.06-5.06M9.9 4.24A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12A3 3 0 1 1 9.88 9.88"/><path d="M1 1l22 22"/></svg>';
  function pwField(label, name, autocomplete, extra = '') {
    return `<label>${label}
      <span class="pw">
        <input type="password" name="${name}" autocomplete="${autocomplete}" ${extra} required>
        <button class="pw__toggle" type="button" aria-label="Mostrar contraseña" aria-pressed="false" title="Mostrar contraseña">${EYE}${EYE_OFF}</button>
      </span></label>`;
  }
  function togglePw(wrap, show) {
    const input = $('input', wrap), btn = $('.pw__toggle', wrap);
    const label = show ? 'Ocultar contraseña' : 'Mostrar contraseña';
    input.type = show ? 'text' : 'password';
    $('.pw__eye', btn).hidden = show;
    $('.pw__eye-off', btn).hidden = !show;
    btn.setAttribute('aria-label', label); btn.title = label; btn.setAttribute('aria-pressed', String(show));
  }
  // Delegación: cualquier ojito dentro del panel (Cuenta…)
  view.addEventListener('click', (e) => {
    const b = e.target.closest('.pw__toggle');
    if (!b) return;
    const wrap = b.closest('.pw');
    togglePw(wrap, $('input', wrap).type === 'password');
    $('input', wrap).focus();
  });

  /* ───────────── Arranque: ¿hay sesión? ───────────── */
  fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => (r.ok ? showApp() : showLogin())).catch(showLogin);
})();