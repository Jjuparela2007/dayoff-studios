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
  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; $('#login input').focus(); }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; route(); }

  $('#login form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target);
    const err = $('.login__error');
    err.textContent = '';
    btn.disabled = true;
    try {
      await api('/api/auth/login', { method: 'POST', body: formData(e.target) });
      e.target.reset();
      showApp();
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; }
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
    const [projects, categories, people, uploads, settings] = await Promise.all([
      api('/api/admin/projects'), api('/api/admin/categories'), api('/api/admin/people'), api('/api/admin/uploads'), api('/api/admin/settings')
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
        ${projectTable(projects.slice(0, 6), settings.spotlight_project_id)}</div>`;
  };

  /* ═════════════ VISTA: Textos del sitio ═════════════ */
  const SETTINGS_GROUPS = [
    ['Marca', [['site_name', 'Nombre del sitio'], ['slogan', 'Eslogan'], ['preloader_tagline', 'Frase bajo el logo en la pantalla de carga (ej. SHOW YOURSELF)'],
      ['logo_url', 'Logo en imagen (opcional; si está vacío se usa el logo vectorial, que es el que hace la animación de máscara)', 'url']]],
    ['Portada (hero)', [['hero_kicker', 'Antetítulo'], ['hero_title', 'Título principal — usa *palabra* para resaltarla en dorado'],
      ['hero_videos', 'Videos de portada (showreel en bucle infinito)', 'videos'],
      ['hero_clip_seconds', 'Segundos por clip (ej. 7; si el video es más corto, se ve completo)'],
      ['hero_image_url', 'Imagen de respaldo (se ve mientras carga el primer video o si no hay videos)', 'url']]],
    ['Estudio', [['about_title', 'Título'], ['about_text', 'Texto (deja una línea en blanco entre párrafos)', 'textarea'], ['about_image_url', 'Imagen', 'url'],
      ['stat_1_value', 'Cifra 1'], ['stat_1_label', 'Etiqueta 1'], ['stat_2_value', 'Cifra 2'], ['stat_2_label', 'Etiqueta 2'], ['stat_3_value', 'Cifra 3'], ['stat_3_label', 'Etiqueta 3']]],
    ['Fundador / creador (aparece en "The studio" y tiene su propia página)', [
      ['founder_name', 'Nombre (su filmografía se arma sola con los proyectos donde figure como director o en los créditos con este mismo nombre)'], ['founder_role', 'Cargo (ej. Founder & Creative Director)'],
      ['founder_disciplines', 'Oficios, separados por comas (ej. Director, Screenwriter, Producer)'],
      ['founder_photo_url', 'Foto (vertical, idealmente en blanco y negro)', 'url'],
      ['founder_quote', 'Frase / cita destacada'],
      ['founder_teaser', 'Texto corto para la sección del estudio', 'textarea'],
      ['founder_bio', 'Biografía completa para su página (deja una línea en blanco entre párrafos)', 'textarea'],
      ['founder_milestones', 'Trayectoria: una línea por hito con el formato  Año | Descripción  (ej. 2014 | Funda DayOff Studios)', 'textarea']]],
    ['Contacto', [['contact_title', 'Título — usa *palabra* para resaltarla en dorado'], ['contact_text', 'Texto', 'textarea'], ['contact_email', 'Email'], ['contact_phone', 'Teléfono'], ['contact_address', 'Dirección']]],
    ['Redes y pie (deja vacío el enlace de una red para ocultar su ícono)', [
      ['facebook_url', 'Facebook'], ['instagram_url', 'Instagram'], ['linkedin_url', 'LinkedIn'], ['x_url', 'X (Twitter)'],
      ['youtube_url', 'YouTube'], ['vimeo_url', 'Vimeo'], ['tiktok_url', 'TikTok'],
      ['footer_text', 'Copyright (el año se añade solo: "DayOff Studios. Todos los derechos reservados.")']]]
  ];

  /* ── Lista de videos del hero (se guarda como JSON en el ajuste hero_videos) ── */
  function videoListField(name, label, value) {
    return `<div class="span-all video-list" data-name="${name}">
      <label>${label}</label>
      <p class="hint">Se reproducen en orden, con fundido entre uno y otro, y vuelven a empezar al terminar. Usa clips MP4 cortos (5–15 s, sin audio, idealmente &lt; 10 MB cada uno).</p>
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

  views.textos = async () => {
    const s = await api('/api/admin/settings');
    view.innerHTML = `
      <div class="page-head"><div><h1>Textos del sitio</h1><p>Eslogan, portada, sección del estudio, contacto y redes.</p></div></div>
      <form id="settings-form">
        ${SETTINGS_GROUPS.map(([title, fields]) => `
          <div class="panel"><h2>${title}</h2><div class="form-grid">
            ${fields.map(([k, label, type]) => type === 'videos' ? videoListField(k, label, s[k])
              : type === 'url' ? urlField(k, label, s[k])
              : type === 'textarea' ? `<label class="span-all">${label}<textarea name="${k}" rows="6">${esc(s[k])}</textarea></label>`
              : `<label>${label}<input name="${k}" value="${esc(s[k])}"></label>`).join('')}
          </div></div>`).join('')}
        <div class="savebar"><a class="btn btn--ghost" href="/" target="_blank">Ver sitio ↗</a><button class="btn btn--primary">Guardar cambios</button></div>
      </form>`;
    bindVideoList();
    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      serializeVideoList();
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
            ${urlField('cover_url', 'Imagen de portada (aparece al pasar el ratón)', editing.cover_url)}
          </div>
          <div class="savebar"><a class="btn btn--ghost" href="#categorias">Cancelar</a><button class="btn btn--primary">Guardar</button></div>
        </form>` : ''}
      <div class="panel table-wrap"><table class="table">
        <thead><tr><th></th><th>Nombre</th><th>Proyectos</th><th>Orden</th><th></th></tr></thead>
        <tbody>${cats.map((c) => `<tr>
          <td>${thumb(c.cover_url, 'thumb thumb--wide')}</td>
          <td><b>${esc(c.name)}</b><div class="hint">/${esc(c.slug)}</div></td>
          <td>${c.project_count}</td><td>${c.sort_order}</td>
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
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta categoría? Sus proyectos quedarán sin categoría (no se borran).')) return;
      await run(b, () => api(`/api/admin/categories/${b.dataset.del}`, { method: 'DELETE' }), 'Categoría eliminada');
      location.hash = 'categorias'; route();
    }));
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
    });
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
    creditRows.innerHTML = p.credits.map(creditRow).join('');
    $('#add-credit').addEventListener('click', () => creditRows.insertAdjacentHTML('beforeend', creditRow({ department: 'reparto' })));
    $('#save-credits').addEventListener('click', (e) => {
      const list = $$('.row', creditRows).map((r) => {
        const name = $('[data-k=name]', r).value.trim();
        const person = people.find((x) => x.name.toLowerCase() === name.toLowerCase());
        return { department: $('[data-k=department]', r).value, role: $('[data-k=role]', r).value.trim(), name, person_id: person ? person.id : null };
      }).filter((c) => c.name || c.role);
      run(e.target, () => api(`/api/admin/projects/${p.id}/credits`, { method: 'PUT', body: list }), 'Créditos guardados');
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
          <label>Contraseña actual<input type="password" name="current" autocomplete="current-password" required></label>
          <label>Nueva contraseña (mín. 10 caracteres)<input type="password" name="next" autocomplete="new-password" minlength="10" required></label>
          <label>Repite la nueva contraseña<input type="password" name="repeat" autocomplete="new-password" required></label>
        </div>
        <div class="savebar"><button class="btn btn--primary">Actualizar contraseña</button></div>
      </form>`;
    $('#pass-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      if (d.next !== d.repeat) return toast('Las contraseñas no coinciden', true);
      const ok = await run($('.btn--primary', e.target), () => api('/api/auth/password', { method: 'POST', body: d }), 'Contraseña actualizada');
      if (ok) e.target.reset();
    });
  };

  /* ───────────── Arranque: ¿hay sesión? ───────────── */
  fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => (r.ok ? showApp() : showLogin())).catch(showLogin);
})();