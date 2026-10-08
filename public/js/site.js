/**
 * DayOff Studio — lógica y animaciones del sitio público.
 *
 * Flujo:
 *  1. Genera el grano de película y arranca el preloader (cuenta regresiva 3-2-1 + logo).
 *  2. Pide /api/site (textos + categorías + proyectos) y pinta todas las secciones.
 *  3. Cuando todo está listo, el preloader se retira y entra el hero (zoom del video + títulos).
 *  4. Animaciones de scroll: reveals, parallax, scroll horizontal fijado, contadores.
 *  5. Fichas de proyecto: cortina de transición → vista de detalle con URL propia (/proyecto/slug).
 *
 * Si GSAP no carga (sin internet, bloqueador…), todo funciona igual sin animaciones.
 */
(() => {
  'use strict';

  /* ───────────────────────── Utilidades ───────────────────────── */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const gsap = window.gsap;
  const ST = window.ScrollTrigger;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ANIM = !!gsap && !REDUCED;
  if (gsap && ST) gsap.registerPlugin(ST);

  /** Escapa HTML: todo texto que viene del panel pasa por aquí antes de insertarse. */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Permite *palabra* → <em>palabra</em> (cursiva en ámbar) en títulos editables. */
  const rich = (s) => esc(s).replace(/\*(.+?)\*/g, '<em>$1</em>');
  /** Solo URLs http(s) o rutas locales; bloquea javascript: y similares. */
  const safeUrl = (u) => (/^(https?:\/\/|\/)/i.test(String(u || '').trim()) ? String(u).trim() : '');

  const state = { settings: {}, categories: [], projects: [], filter: 'all', detailOpen: false };

  // Al recargar, el navegador intenta volver a la posición donde estabas (p. ej. abajo del todo).
  // Con la intro y las animaciones ligadas al scroll eso descuadra el inicio (hero sin título, zonas negras),
  // así que la página siempre arranca arriba, como una película desde el primer plano.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);
  const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>';

  /* ───────────────────────── Grano de película ───────────────────────── */
  (function makeGrain() {
    const c = document.createElement('canvas');
    c.width = c.height = 180;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    $('.grain').style.backgroundImage = `url(${c.toDataURL('image/png')})`;
  })();

  /* ───────────────────────── Preloader ───────────────────────── */
  const preloader = {
    progress: 0,
    tl: null,
    start() {
      if (!ANIM) return;
      // Cuenta regresiva estilo "film leader": el anillo barre y el número baja 3→2→1
      const count = $('.preloader__count');
      const sweep = $('.ring-sweep');
      this.tl = gsap.timeline({ repeat: -1 });
      [3, 2, 1].forEach((n) => {
        this.tl.call(() => { count.textContent = n; })
          .fromTo(sweep, { strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: .7, ease: 'none' })
          .fromTo(count, { scale: 1.15, opacity: .4 }, { scale: 1, opacity: 1, duration: .7, ease: 'power2.out' }, '<');
      });
    },
    /* Órdenes de un set de rodaje, en el orden real antes de cada toma.
       Cada una aparece cuando la carga llega a su porcentaje; "Action!" coincide con la revelación.
       Versión en español de set: ['¡Silencio, se rueda!', 'Sonido', 'Corre sonido', 'Cámara', 'Rueda', 'Claqueta', '¡Acción!'] */
    CALLS: [[0, 'Quiet on set'], [12, 'Roll sound'], [28, 'Speed'], [45, 'Roll camera'], [62, 'Rolling'], [80, 'Marker'], [100, 'Action!']],
    callIdx: 0,
    callTarget: 0,
    set(p) {
      this.progress = Math.max(this.progress, p);
      const pct = Math.round(this.progress * 100);
      $('.preloader__progress span').style.width = pct + '%';
      $('.preloader__pct').textContent = String(pct).padStart(3, '0') + '%';
      // Hasta qué orden debería ir según el progreso ("Action!" se reserva para el final)
      this.callTarget = Math.max(this.callTarget, this.CALLS.reduce((acc, [at], i) => (pct >= at && i < this.CALLS.length - 1 ? i : acc), 0));
      this.runCalls();
    },
    /** Avanza las órdenes de una en una (mín. ~0,3 s cada una, así caben en una sola cuenta 3-2-1). */
    runCalls() {
      if (this.callTimer || this.callIdx >= this.callTarget) return;
      this.callTimer = setTimeout(() => {
        this.callTimer = null;
        this.showCall(this.callIdx + 1);
        this.runCalls();
      }, 300);
    },
    showCall(i) {
      this.callIdx = i;
      const wrap = $('.preloader__call');
      if (!wrap) return;                                        // el preloader ya se retiró
      const label = $('b', wrap);
      label.textContent = this.CALLS[i][1];
      wrap.classList.toggle('is-rolling', i >= 4);              // desde "Rolling": luz roja de grabación
      wrap.classList.toggle('is-action', i === this.CALLS.length - 1);
      if (ANIM) gsap.fromTo(label, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .25, ease: 'power2.out' });
    },
    /**
     * Revelado con MÁSCARA DEL LOGO y retiro del preloader. Devuelve una promesa.
     *  1. Termina la cuenta regresiva.
     *  2. Aparece una capa negra con el logo recortado: por el recorte ya se ve el video del hero.
     *  3. El logo crece hacia su parte más gruesa (trazo de la "y") hasta que el recorte
     *     cubre toda la pantalla y el sitio queda a la vista.
     * onShow: se llama cuando aparece el logo (arranca el video y prepara la entrada del hero).
     */
    finish(onShow = () => {}) {
      this.set(1);
      const el = $('.preloader');
      const done = () => { clearTimeout(this.callTimer); this.callTimer = null; this.callIdx = this.callTarget = this.CALLS.length; el.remove(); document.body.classList.remove('is-loading'); };
      if (!ANIM || !window.DAYOFF_LOGO_PATH) { done(); onShow(0); return Promise.resolve(); }
      return new Promise((resolve) => {
        // Se revela SIEMPRE justo al terminar el "1" de la cuenta regresiva (final de la vuelta actual)
        // y cuando las órdenes del set ya llegaron a "Marker" (la siguiente es "Action!").
        // Si la carga tardó y la cuenta volvió a empezar, se espera a que llegue otra vez al 1: nunca se abre en el 3.
        const waitCycle = () => (this.tl.progress() > .93 && this.callIdx >= this.CALLS.length - 2
          ? go() : requestAnimationFrame(waitCycle));
        const go = () => {
          this.tl.kill();
          $('.preloader__count').textContent = '1';
          const W = innerWidth, H = innerHeight;
          const VB = window.DAYOFF_LOGO_VIEWBOX, F = window.DAYOFF_LOGO_FOCUS;

          // Tamaño y posición inicial del logo (centrado)
          const s0 = Math.min(W * .62, 760) / VB.w;
          const lx = (W - VB.w * s0) / 2, ly = (H - VB.h * s0) / 2 - H * .03;
          const fx = lx + F.x * s0, fy = ly + F.y * s0;          // punto de foco en pantalla
          // Escala final: el trazo en el foco (~20 unidades de grosor) debe cubrir hasta la esquina más lejana
          const far = Math.max(Math.hypot(fx, fy), Math.hypot(W - fx, fy), Math.hypot(fx, H - fy), Math.hypot(W - fx, H - fy));
          const s1 = (far / 20) * 1.2;

          // Capa: rectángulo negro con un "agujero" con forma de logo (máscara SVG)
          const svg = $('.preloader__mask');
          svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
          svg.innerHTML = `<defs><mask id="dayoff-hole" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
              <rect width="${W}" height="${H}" fill="#fff"/>
              <path class="hole" d="${window.DAYOFF_LOGO_PATH}" fill="#000" fill-rule="evenodd" fill-opacity="0"/>
            </mask></defs>
            <rect width="${W}" height="${H}" fill="#0a0908" mask="url(#dayoff-hole)"/>
            <path class="outline" d="${window.DAYOFF_LOGO_PATH}" fill="none" stroke="#ffffff" stroke-width="1" vector-effect="non-scaling-stroke" fill-rule="evenodd"/>`;
          // "outline": contorno fino del logo, para que se lea aunque el video sea oscuro
          const hole = svg.querySelector('.hole'), outline = svg.querySelector('.outline');
          const st = { s: s0 * .9, o: 0, line: 0 };
          const paint = () => {
            const t = `translate(${fx - F.x * st.s} ${fy - F.y * st.s}) scale(${st.s})`;
            hole.setAttribute('transform', t);
            outline.setAttribute('transform', t);
            hole.setAttribute('fill-opacity', st.o);
            outline.setAttribute('stroke-opacity', st.line);
          };
          paint();
          const tag = $('.preloader__tagline');
          tag.style.top = `${ly + VB.h * s0 + Math.max(24, H * .04)}px`;

          // ZOOM_AT: segundos desde que aparece el logo hasta que empieza el zoom (logo 1.1 → texto hasta 1.4 → pausa .7 → salida .35)
          const ZOOM_AT = 2.45, ZOOM_DUR = 1.5;
          const tl = gsap.timeline({ onComplete: () => { done(); resolve(); } });
          clearTimeout(this.callTimer);
          tl.to({}, { duration: .45 })                                // se lee "Marker"…
            .call(() => this.showCall(this.CALLS.length - 1))         // …y ¡Action!
            .to({}, { duration: .55 })
            .to('.preloader__leader, .preloader__progress, .preloader__meta', { opacity: 0, scale: .96, duration: .5, ease: 'power2.in' })
            .call(() => el.classList.add('is-masking'))
            .call(() => onShow(ZOOM_AT + ZOOM_DUR * .75))          // el video empieza a verse dentro del logo
            .to(st, { o: 1, line: .55, s: s0, duration: 1.1, ease: 'power3.out', onUpdate: paint })
            .fromTo(tag, { opacity: 0, letterSpacing: '1.1em' }, { opacity: tag.textContent.trim() ? .9 : 0, letterSpacing: '.6em', duration: 1, ease: 'power3.out' }, '-=.7')
            .to({}, { duration: .7 })                                // pausa: se aprecia el logo con el video
            .to(tag, { opacity: 0, duration: .35 })
            .addLabel('zoom')
            .to(st, { s: s1, duration: ZOOM_DUR, ease: 'expo.in', onUpdate: paint }, 'zoom')
            .to(st, { line: 0, duration: .5, ease: 'power1.in', onUpdate: paint }, 'zoom');
        };
        waitCycle();
      });
    }
  };
  preloader.start();

  /* ───────────────────────── Carga de datos ───────────────────────── */
  async function loadSite() {
    preloader.set(.15);
    const res = await fetch('/api/site');
    if (!res.ok) throw new Error('Could not load content');
    const data = await res.json();
    Object.assign(state, data);
    preloader.set(.45);
  }

  /** Precarga imágenes clave (hero + primeros pósters) para que la entrada sea limpia. */
  function preloadImages(urls) {
    const list = urls.filter(Boolean);
    let done = 0;
    return Promise.all(list.map((u) => new Promise((r) => {
      const i = new Image();
      i.onload = i.onerror = () => { done++; preloader.set(.45 + .5 * (done / list.length)); r(); };
      i.src = u;
    })));
  }

  /**
   * Elige la resolución del video según la pantalla, para no descargar 4K en un móvil.
   * - Clips de demo (public/media/showreel-NN.mp4): usa showreel-NN.1080.mp4 en pantallas pequeñas.
   * - Cloudinary (producción): pide el ancho adecuado y calidad automática (w_1920 / w_3840, q_auto).
   * Pantallas grandes o de alta densidad (≥ 2.500 px reales de ancho) reciben el 4K.
   */
  function responsiveVideo(url, { max1080 = false } = {}) {
    const px = Math.round(screen.width * (window.devicePixelRatio || 1));
    const big = !max1080 && px >= 2500 && !navigator.connection?.saveData;
    if (/\/media\/showreel-\d+\.mp4$/.test(url)) return big ? url : url.replace(/\.mp4$/, '.1080.mp4');
    if (/^https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\//.test(url) && !/\/upload\/[^/]*w_\d/.test(url)) {
      return url.replace('/video/upload/', `/video/upload/${big ? 'w_3840' : 'w_1920'},q_auto/`);
    }
    return url;
  }

  /* ───────────────────────── Hero: showreel de videos infinito ─────────────────────────
     Dos <video> superpuestos (A/B): mientras uno se ve, el siguiente se precarga.
     Al llegar al final del clip (o a "segundos por clip") se hace un fundido cruzado
     al siguiente; tras el último vuelve al primero, sin fin.
     - Un solo video → se repite en bucle.
     - Si un video falla, se salta. Si fallan todos, queda la imagen de respaldo.
     - Se pausa cuando el hero no está a la vista o la pestaña está oculta (ahorra batería/datos). */
  const heroReel = {
    FADE: 1.2,          // segundos de fundido entre clips (se acorta con clips cortos, ver start())
    start(urls, poster, clipSeconds) {
      const media = $('.hero__media');
      this.urls = urls.map(responsiveVideo); this.clip = clipSeconds; this.idx = 0; this.failed = 0; this.switching = false;
      this.FADE = Math.min(1.2, Math.max(.5, clipSeconds * .25));   // clips de 3 s → fundido de 0,75 s
      this.started = false; // no se reproduce nada hasta que termina el preloader (ver begin())
      this.poster = poster;
      // Sin videos → imagen fija con Ken Burns. Con videos → la imagen solo se usa si fallan todos.
      if (!urls.length) { this.showPoster(); this.readyP = Promise.resolve(); return; }
      media.innerHTML = '';
      media.classList.add('has-video');

      // Dos capas de video
      this.v = [0, 1].map(() => {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
        media.append(v);
        return v;
      });
      this.cur = 0;

      this.v.forEach((v) => {
        v.addEventListener('error', () => { v.dataset.failed = '1'; if (v === this.v[this.cur]) this.onError(); });
        v.addEventListener('ended', () => { if (v === this.v[this.cur]) this.next(); });
      });
      if (urls.length === 1) this.v[0].loop = true;

      // Se cargan ya (para que estén listos), pero se reproducen al llamar begin()
      this.load(this.v[0], 0);
      this.v[0].classList.add('is-active');
      if (ANIM) gsap.set(this.v, { scale: 1.12 });   // misma escala con la que empieza el zoom: sin saltos
      // El preloader espera a que el primer clip pueda reproducirse (máx. 6 s)
      const first = this.v[0];
      this.readyP = new Promise((res) => {
        if (first.readyState >= 3) return res();
        ['canplay', 'error'].forEach((ev) => first.addEventListener(ev, res, { once: true }));
        setTimeout(res, 6000);
      });
      if (urls.length > 1) this.load(this.v[1], 1);

      // Pausar fuera de pantalla / pestaña oculta
      this.visible = true;
      new IntersectionObserver(([en]) => { this.visible = en.isIntersecting; this.sync(); }, { threshold: .05 }).observe($('.hero'));
      document.addEventListener('visibilitychange', () => this.sync());
    },
    showPoster() {
      if (this.poster && !$('.hero__poster')) $('.hero__media').insertAdjacentHTML('afterbegin', `<img class="hero__poster" src="${esc(this.poster)}" alt="">`);
    },
    ready() { return this.readyP || Promise.resolve(); },
    /** Arranca el showreel desde el PRIMER clip. Se llama cuando la portada se revela. */
    begin() {
      if (!this.v || this.started) return;
      this.started = true;
      this.show(0, true);
      this.tick();
    },
    load(v, i) { delete v.dataset.failed; v.src = this.urls[i % this.urls.length]; v.load(); },
    play(v) { const p = v.play(); if (p) p.catch(() => {}); },
    sync() {
      const v = this.v?.[this.cur];
      if (!v || !this.started) return;
      (this.visible && !document.hidden) ? this.play(v) : v.pause();
    },
    /** Muestra la capa "layer" con el clip actual (fundido cruzado). */
    show(layer, first = false) {
      const inV = this.v[layer], outV = this.v[1 - layer];
      inV.currentTime = 0;
      this.play(inV);
      inV.classList.add('is-active');
      outV.classList.remove('is-active');
      // Zoom lento sobre cada clip (efecto cámara)
      if (ANIM) gsap.fromTo(inV, { scale: 1.12 }, { scale: 1.02, duration: this.clip + this.FADE, ease: 'none' });
      if (!first) setTimeout(() => outV.pause(), this.FADE * 1000);
      this.cur = layer;
      this.lastMove = performance.now(); this.lastT = -1;
    },
    next() {
      if (this.urls.length < 2 || this.switching) return;
      this.switching = true;
      this.idx = (this.idx + 1) % this.urls.length;
      this.show(1 - this.cur);
      // Precarga el clip siguiente en la capa que acaba de quedar libre
      setTimeout(() => { this.load(this.v[1 - this.cur], this.idx + 1); this.switching = false; }, this.FADE * 1000 + 50);
    },
    onError() {
      if (this.switching) return;
      this.failed++;
      if (this.failed >= this.urls.length) {           // ninguno carga → imagen fija
        this.v.forEach((v) => v.remove());
        $('.hero__media').classList.remove('has-video');
        this.showPoster();
        return;
      }
      this.switching = false;
      this.next();
    },
    /** Cada frame: cambia de clip al llegar al límite de segundos. */
    tick() {
      const v = this.v[this.cur];
      // Vigilante: si el clip activo no avanza en 8 s (no carga o se colgó), se salta
      if (v && this.visible && !document.hidden) {
        const now = performance.now();
        if (v.currentTime !== this.lastT) { this.lastT = v.currentTime; this.lastMove = now; if (v.currentTime > .5) this.failed = 0; }
        else if (now - this.lastMove > (v.dataset.failed ? 300 : 8000) && !this.switching) { this.lastMove = now; this.onError(); }
      }
      if (v && this.urls.length > 1 && !v.paused && v.duration) {
        const limit = Math.min(v.duration, this.clip);
        if (v.currentTime >= limit - this.FADE / 2) this.next();
      }
      requestAnimationFrame(() => this.tick());
    }
  };

  /* ───────────────────────── Render: textos ───────────────────────── */
  function applySettings() {
    const s = state.settings;
    document.title = `${s.site_name || 'DayOff Studios'} — ${s.slogan || 'Film Production Company'}`;

    $$('[data-setting]').forEach((el) => {
      const val = s[el.dataset.setting] ?? '';
      if (el.hasAttribute('data-multiline')) {
        el.innerHTML = val.split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
      } else if (el.hasAttribute('data-split')) {
        el.innerHTML = rich(val);
      } else {
        el.textContent = val;
      }
    });
    // Enlaces: data-setting-href="mailto:contact_email" o "instagram_url"
    $$('[data-setting-href]').forEach((el) => {
      const [prefix, key] = el.dataset.settingHref.includes(':') ? el.dataset.settingHref.split(':') : ['', el.dataset.settingHref];
      const v = s[key];
      if (!v) { el.hidden = true; return; }
      el.href = prefix ? `${prefix}:${v}` : safeUrl(v);
    });
    // Copyright con el año en curso: "© 2026 DayOff Studios. Todos los derechos reservados."
    const copy = String(s.footer_text || s.site_name || 'DayOff Studios').replace(/^\s*©\s*(\d{4}\s*)?/, '');
    $$('[data-copyright]').forEach((el) => { el.textContent = `© ${new Date().getFullYear()} ${copy}`; });

    // Logo subido por el admin → reemplaza el logo vectorial
    if (safeUrl(s.logo_url)) {
      $$('[data-logo]').forEach((el) => { el.innerHTML = `<img src="${esc(safeUrl(s.logo_url))}" alt="${esc(s.site_name)}">`; });
    }

    // Hero: secuencia de videos en bucle infinito (showreel). Si no hay videos → imagen con Ken Burns.
    const image = safeUrl(s.hero_image_url) || safeUrl(state.projects[0]?.backdrop_url);
    let videos = [];
    try { videos = JSON.parse(s.hero_videos || '[]'); } catch { videos = []; }
    if (!videos.length && s.hero_video_url) videos = [s.hero_video_url]; // compatibilidad con la versión anterior
    heroReel.start(videos.map(safeUrl).filter(Boolean), image, parseFloat(s.hero_clip_seconds) || 7);

    // Imagen de "Estudio"
    const aboutImg = safeUrl(s.about_image_url) || safeUrl(state.projects[1]?.backdrop_url) || image;
    $('.about__img img').src = aboutImg;

    // Marquesina: eslogan + categorías
    const sun = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>';
    const words = [`<b>${esc(s.slogan)}</b>`, ...state.categories.map((c) => esc(c.name))];
    const chunk = words.map((w) => `<span>${w}</span>${sun}`).join('');
    $('.marquee__track').innerHTML = chunk + chunk + chunk + chunk;
  }

  /* ───────────────────────── Render: destacados ───────────────────────── */
  /* ───────────────────────── Render: ESTRENO destacado ───────────────────────── */
  function renderSpotlight() {
    const p = state.spotlight;
    if (!p) return;
    const sec = $('#latest');
    const bg = safeUrl(p.backdrop_url) || safeUrl(p.poster_url);
    $('.spotlight__img', sec).src = bg;
    const poster = safeUrl(p.poster_url);
    const fig = $('.spotlight__poster', sec);
    fig.hidden = !poster;
    if (poster) { $('img', fig).src = poster; $('img', fig).alt = `${p.title} poster`; }
    $('.spotlight__year', sec).textContent = p.year || '';
    $('.spotlight__presents-kind', sec).textContent = [p.category_name, p.year].filter(Boolean).join(' · ');
    $('.spotlight__title', sec).textContent = p.title;
    $('.spotlight__title', sec).classList.toggle('is-long', p.title.length > 16);
    $('.spotlight__tagline', sec).textContent = p.tagline || '';
    $('.spotlight__tagline', sec).hidden = !p.tagline;
    $('.spotlight__meta', sec).innerHTML = [p.category_name, p.genre, p.duration]
      .filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');
    const syn = String(p.synopsis || '');
    $('.spotlight__synopsis', sec).textContent = syn.length > 240 ? syn.slice(0, syn.lastIndexOf(' ', 237)) + '…' : syn;
    $('.spotlight__billing', sec).innerHTML = billingBlock(p);

    const play = $('.spotlight__play', sec);
    play.hidden = !safeUrl(p.trailer_url);
    play.addEventListener('click', () => openTrailer(p.trailer_url));
    const more = $('.spotlight__more', sec);
    more.href = `/project/${p.slug}`;
    more.addEventListener('click', (e) => { e.preventDefault(); openProject(p.slug); });
    sec.hidden = false;

    // Accesos directos: píldora de la portada y enlace del menú
    const chip = $('.hero__release');
    $('.hero__release-title', chip).textContent = p.title;
    chip.hidden = false;
    $('.nav__latest').hidden = false;

    // El tráiler se reproduce de fondo (sin sonido) cuando la sección se acerca
    const io = new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) return;
      io.disconnect();
      backgroundTrailer($('.spotlight__media', sec), p.trailer_url);
    }, { rootMargin: '100% 0px' });
    io.observe(sec);
  }

  /** Créditos estilo póster: "Directed by X · Starring A · B · C · Cinematography Y …" */
  function billingBlock(p) {
    const cr = p.credits || [];
    const director = cr.find((c) => /^direct/i.test(c.role) && c.department === 'equipo')?.name || p.director;
    const cast = cr.filter((c) => c.department === 'reparto').slice(0, 4).map((c) => c.name);
    const crew = cr.filter((c) => c.department !== 'reparto' && !/^direct(or|ed)$/i.test(c.role) && c.name !== director).slice(0, 4);
    const item = (label, name) => `<span><small>${esc(label)}</small>${esc(name)}</span>`;
    return [
      director && item('Directed by', director),
      cast.length && item('Starring', cast.join(' · ')),
      ...crew.map((c) => item(c.role, c.name))
    ].filter(Boolean).join('');
  }

  /**
   * Tráiler de fondo en bucle y sin sonido (YouTube, Vimeo o archivo .mp4/.webm).
   * Seguridad visual: el video SOLO se muestra cuando el reproductor confirma que está reproduciendo.
   * Si YouTube/Vimeo no lo permiten (inserción desactivada, error, bloqueo), queda la imagen y nunca
   * aparece la pantalla de error del reproductor. No se carga con "ahorro de datos" ni movimiento reducido.
   */
  function backgroundTrailer(box, url) {
    url = safeUrl(url);
    if (!url || REDUCED || navigator.connection?.saveData) return;
    let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    const vimeo = !m && url.match(/vimeo\.com\/(?:video\/)?(\d+)/);

    if (!m && !vimeo) {                         // archivo de video propio
      const v = document.createElement('video');
      Object.assign(v, { src: url, muted: true, loop: true, autoplay: true, playsInline: true });
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
      v.style.cssText = 'opacity:0;transition:opacity 1.2s ease';
      v.addEventListener('playing', () => { v.style.opacity = 1; }, { once: true });
      v.addEventListener('error', () => v.remove(), { once: true });
      box.append(v);
      return;
    }

    const f = document.createElement('iframe');
    const origin = encodeURIComponent(location.origin);
    f.src = m
      ? `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&mute=1&controls=0&loop=1&playlist=${m[1]}&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&origin=${origin}`
      : `https://player.vimeo.com/video/${vimeo[1]}?background=1&autoplay=1&loop=1&muted=1`;
    f.title = 'Trailer (background)';
    f.setAttribute('tabindex', '-1');
    f.setAttribute('aria-hidden', 'true');
    f.setAttribute('allow', 'autoplay; encrypted-media');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

    const show = () => { if (!f.classList.contains('is-ready')) setTimeout(() => f.classList.add('is-ready'), 400); };
    const onMsg = (e) => {
      if (e.source !== f.contentWindow) return;
      let d = e.data;
      try { if (typeof d === 'string') d = JSON.parse(d); } catch { return; }
      if (!d || typeof d !== 'object') return;
      // YouTube: playerState 1 = reproduciendo · Vimeo: evento "play"
      const ytState = d.info && typeof d.info === 'object' ? d.info.playerState : undefined;
      if (ytState === 1 || d.event === 'play' || d.event === 'playProgress') show();
      // YouTube avisa errores (p. ej. inserción no permitida): se retira el reproductor
      if (d.event === 'onError' || (d.info && d.info.error)) { f.remove(); removeEventListener('message', onMsg); }
    };
    addEventListener('message', onMsg);
    // Al cargar, se pide al reproductor que informe de su estado
    f.addEventListener('load', () => {
      const send = (msg) => f.contentWindow && f.contentWindow.postMessage(JSON.stringify(msg), '*');
      if (m) {
        send({ event: 'listening', id: 'dayoff-bg', channel: 'widget' });
        send({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 'dayoff-bg', channel: 'widget' });
        send({ event: 'command', func: 'addEventListener', args: ['onError'], id: 'dayoff-bg', channel: 'widget' });
      } else {
        send({ method: 'addEventListener', value: 'play' });
        send({ method: 'addEventListener', value: 'playProgress' });
      }
    }, { once: true });
    box.append(f);
  }

  function renderFeatured() {
    let list = state.projects.filter((p) => +p.featured);
    if (!list.length) list = state.projects.slice(0, 4);
    const cat = (id) => state.categories.find((c) => c.id === id)?.name || '';
    $('.featured__track').innerHTML = list.map((p, i) => `
      <article class="feat" data-slug="${esc(p.slug)}" tabindex="0">
        <img src="${esc(safeUrl(p.backdrop_url) || safeUrl(p.poster_url))}" alt="${esc(p.title)}" loading="lazy">
        <div class="feat__info">
          <div>
            <span class="mono" style="color:var(--accent)">${esc(cat(p.category_id))} · ${esc(p.year || '')}</span>
            <h3 class="feat__title">${esc(p.title)}</h3>
            ${p.tagline ? `<p class="feat__tag">${esc(p.tagline)}</p>` : ''}
          </div>
          <span class="feat__idx">${String(i + 1).padStart(2, '0')}</span>
        </div>
      </article>`).join('');
    if (!list.length) $('#featured').hidden = true;
  }

  /* ───────────────────────── Render: categorías ───────────────────────── */
  function renderCategories() {
    const counts = {};
    state.projects.forEach((p) => { counts[p.category_id] = (counts[p.category_id] || 0) + 1; });
    $('.cat-list').innerHTML = state.categories.map((c, i) => `
      <li class="cat-item">
        <a href="#work" data-cat="${esc(c.slug)}" data-cover="${esc(safeUrl(c.cover_url))}">
          <span class="mono">${String(i + 1).padStart(2, '0')}</span>
          <h3>${esc(c.name)}<span class="cat-count">(${counts[c.id] || 0})</span></h3>
          <p>${esc(c.description || '')}</p>
        </a>
      </li>`).join('');

    // Imagen flotante que sigue al cursor al pasar por cada categoría
    const preview = $('.cat-preview');
    const pimg = preview.querySelector('img');
    const xTo = ANIM ? gsap.quickTo(preview, 'x', { duration: .6, ease: 'power3' }) : null;
    const yTo = ANIM ? gsap.quickTo(preview, 'y', { duration: .6, ease: 'power3' }) : null;
    let pointerInList = false, shown = false;
    // overwrite: true → cada orden cancela la anterior, así "ocultar" nunca pierde contra un "mostrar" a medias
    const show = (src) => {
      if (!ANIM || !src) return;
      if (pimg.getAttribute('src') !== src) pimg.src = src;
      shown = true;
      gsap.to(preview, { opacity: 1, scale: 1, rotate: gsap.utils.random(-6, 6), duration: .5, ease: 'power3.out', overwrite: true });
    };
    const hide = (fast) => {
      if (!ANIM || !shown) return;
      shown = false;
      gsap.to(preview, { opacity: 0, scale: .8, rotate: 0, duration: fast ? .2 : .4, ease: 'power2.out', overwrite: true });
    };
    const list = $('.cat-list');
    list.addEventListener('mousemove', (e) => {
      if (!xTo) return;
      const a = e.target.closest('.cat-item a');
      if (!pointerInList) {
        // Primer movimiento real del ratón: coloca la imagen bajo el cursor
        gsap.set(preview, { x: e.clientX, y: e.clientY });
        pointerInList = true;
      }
      if (a && !shown) show(a.dataset.cover);
      else if (!a) hide();
      xTo(e.clientX); yTo(e.clientY);
    });
    list.addEventListener('mouseleave', () => { pointerInList = false; hide(); });
    // Al hacer scroll (rueda, trackpad, teclado o un enlace) la imagen se oculta al instante;
    // vuelve a salir solo cuando el ratón se mueve otra vez sobre una categoría
    addEventListener('scroll', () => { pointerInList = false; hide(true); }, { passive: true });
    // Seguro extra: si la sección sale de la pantalla o el ratón sale de la ventana, se oculta
    new IntersectionObserver(([en]) => { if (!en.isIntersecting) { pointerInList = false; hide(true); } }).observe(list);
    document.addEventListener('mouseleave', () => { pointerInList = false; hide(true); });
    addEventListener('blur', () => hide(true));
    $$('.cat-item a').forEach((a) => {
      a.addEventListener('mouseenter', () => { if (pointerInList) show(a.dataset.cover); });
      a.addEventListener('click', (e) => {
        e.preventDefault();
        setFilter(a.dataset.cat);
        $('#work').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
      });
    });
  }

  /* ───────────────────────── Render: filtros + galería ───────────────────────── */
  function renderFilters() {
    const wrap = $('.filters');
    const btns = [{ slug: 'all', name: 'All' }, ...state.categories]
      .map((c) => `<button role="tab" data-filter="${esc(c.slug)}" aria-selected="${c.slug === state.filter}">${esc(c.name)}</button>`).join('');
    wrap.insertAdjacentHTML('beforeend', btns);
    wrap.addEventListener('click', (e) => { const b = e.target.closest('button[data-filter]'); if (b) setFilter(b.dataset.filter); });
    addEventListener('resize', moveInk);
  }

  function moveInk() {
    const active = $('.filters button[aria-selected="true"]');
    const ink = $('.filters__ink');
    if (!active) return;
    ink.style.width = active.offsetWidth + 'px';
    ink.style.height = active.offsetHeight + 'px';
    ink.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  }

  function setFilter(slug) {
    state.filter = slug;
    $$('.filters button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.filter === slug)));
    moveInk();
    const grid = $('.grid');
    if (ANIM && grid.children.length) {
      gsap.to(grid.children, { opacity: 0, y: 20, duration: .3, stagger: .02, ease: 'power2.in', onComplete: renderGrid });
    } else renderGrid();
  }

  function renderGrid() {
    const cat = state.categories.find((c) => c.slug === state.filter);
    const list = state.filter === 'all' ? state.projects : state.projects.filter((p) => cat && p.category_id === cat.id);
    const catName = (id) => state.categories.find((c) => c.id === id)?.name || '';
    $('.grid').innerHTML = list.length ? list.map((p) => `
      <article class="card" data-slug="${esc(p.slug)}" tabindex="0" role="button" aria-label="View ${esc(p.title)}">
        <div class="card__frame">
          <img src="${esc(safeUrl(p.poster_url))}" alt="${esc(p.title)} poster" loading="lazy" draggable="false">
          ${p.year ? `<span class="card__year mono">${esc(p.year)}</span>` : ''}
          <span class="card__play">${PLAY_ICON}</span>
        </div>
        <div class="card__meta">
          <h3 class="card__title">${esc(p.title)}</h3>
          <span class="card__cat mono">${esc(catName(p.category_id))}</span>
        </div>
      </article>`).join('') : '<p class="grid__empty">New work in this category coming soon.</p>';

    cardPreviews();
    if (ANIM) {
      gsap.fromTo('.grid > *', { opacity: 0, y: 60, clipPath: 'inset(0 0 100% 0)' },
        { opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)', duration: 1, stagger: .07, ease: 'power3.out', clearProps: 'clipPath' });
      ST && ST.refresh();
    }
  }

  /**
   * Vista previa al pasar el cursor por una obra: mientras el póster pasa a color, arranca
   * (sin sonido, en bucle) el primer video de su galería o, si no tiene, su tráiler (archivo, YouTube o Vimeo).
   * Espera un instante antes de cargar, para no descargar videos al cruzar la grilla con el ratón,
   * y al salir se detiene y se retira. En pantallas táctiles no se activa.
   */
  const HOVER = matchMedia('(hover: hover) and (pointer: fine)');
  function cardPreviews() {
    if (REDUCED || !HOVER.matches || navigator.connection?.saveData) return;
    $$('.grid .card').forEach((card) => {
      const p = state.projects.find((x) => x.slug === card.dataset.slug);
      const src = p && (safeUrl(p.preview_video) || safeUrl(p.trailer_url));
      if (!src) return;
      card.classList.add('has-preview');
      const frame = $('.card__frame', card);
      let timer = null, box = null;
      card.addEventListener('mouseenter', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (box) { box.classList.add('is-on'); $('video', box)?.play().catch(() => {}); return; }
          box = document.createElement('div');
          box.className = 'card__preview is-on';
          box.setAttribute('aria-hidden', 'true');
          frame.insertBefore(box, $('.card__year', frame) || null);
          backgroundTrailer(box, /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src) || /\/video\/upload\//.test(src) ? responsiveVideo(src, { max1080: true }) : src);
        }, 250);
      });
      card.addEventListener('mouseleave', () => {
        clearTimeout(timer);
        if (!box) return;
        box.classList.remove('is-on');
        const v = $('video', box);
        if (v) { v.pause(); return; }              // el video propio se conserva (vuelve a salir al instante)
        const old = box; box = null;               // YouTube/Vimeo: se retira para que deje de descargar
        setTimeout(() => old.remove(), 500);
      });
    });
  }

  /* ───────────────────────── Animaciones globales ───────────────────────── */

  /** Parte un texto en palabras envueltas para animarlas (mantiene <em>). */
  function splitWords(el) {
    if (el.dataset.splitDone) return $$('.split-word > span', el);
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((w) => {
            if (!w) return;
            if (/^\s+$/.test(w)) { frag.append(document.createTextNode(w)); return; }
            const outer = document.createElement('span'); outer.className = 'split-word';
            const inner = document.createElement('span'); inner.textContent = w;
            outer.append(inner); frag.append(outer);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(el);
    el.dataset.splitDone = '1';
    return $$('.split-word > span', el);
  }

  /** Entrada del hero tras el preloader: se abren las franjas negras y suben los títulos. */
  /** Entrada de menú y textos del hero. "at": segundos hasta que el zoom del logo descubre la pantalla. */
  function heroIntro(at = 0) {
    if (!ANIM) return;
    const words = splitWords($('.hero__title'));
    // Los estados iniciales (ocultos) se aplican ya; la animación arranca cuando el zoom termina de abrir
    gsap.timeline({ delay: Math.max(0, at - .8) })
      // (se animan los hijos del header, no el header: este ya tiene transición CSS para ocultarse al hacer scroll)
      .from('.header .brand, .header .nav, .header .theme-toggle, .header .menu-btn', { y: -40, opacity: 0, duration: 1, stagger: .1, ease: 'power3.out' }, .8)
      .from('.hero__kicker', { opacity: 0, y: 20, duration: .8 }, 1)
      .from(words, { yPercent: 110, rotate: 4, duration: 1.2, stagger: .07, ease: 'power4.out' }, 1)
      .from('.hero__slogan', { opacity: 0, y: 30, duration: 1, ease: 'power3.out' }, 1.5)
      .from('.hero .btn-ghost, .hero__release, .hero__hud, .hero__scroll', { opacity: 0, y: 20, duration: .8, stagger: .1 }, 1.7);
  }

  function scrollAnimations() {
    if (!ANIM || !ST) return;

    // Hero: parallax del fondo y fundido del contenido al bajar
    gsap.to('.hero__media', { yPercent: 18, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.fromTo('.hero__content', { yPercent: 0, opacity: 1 }, { yPercent: -25, opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.hero', start: 'center center', end: 'bottom top', scrub: true } });

    // Títulos de sección: reveal por palabras
    $$('[data-reveal]').forEach((el) => {
      gsap.from(splitWords(el), { yPercent: 110, duration: 1.1, stagger: .06, ease: 'power4.out', scrollTrigger: { trigger: el, start: 'top 85%' } });
    });
    $$('.section-head__num').forEach((el) => gsap.from(el, { opacity: 0, x: -20, duration: .8, scrollTrigger: { trigger: el, start: 'top 85%' } }));

    // Lista de categorías: líneas que se dibujan + entrada escalonada
    gsap.from('.cat-item', { opacity: 0, y: 50, duration: 1, stagger: .1, ease: 'power3.out', scrollTrigger: { trigger: '.cat-list', start: 'top 80%' } });

    // Estudio: parallax de imagen, reveal de párrafos, contadores
    $$('[data-parallax] img').forEach((img) => gsap.fromTo(img, { yPercent: -12 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: img.parentElement, scrub: true } }));
    gsap.from('.about__img', { clipPath: 'inset(100% 0 0 0)', duration: 1.6, ease: 'power4.inOut', scrollTrigger: { trigger: '.about', start: 'top 70%' } });
    gsap.from('[data-reveal-lines] p', { opacity: 0, y: 30, duration: 1, stagger: .15, scrollTrigger: { trigger: '.about__text', start: 'top 80%' } });
    $$('[data-count]').forEach((el) => {
      const target = parseFloat(el.textContent) || 0;
      const obj = { v: 0 };
      gsap.to(obj, { v: target, duration: 2, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 90%' }, onUpdate: () => { el.textContent = Math.round(obj.v); } });
    });

    // ESTRENO — escena principal.
    // Escritorio: la sección se fija; al hacer scroll aparece "DayOff Studios presents", el cuadro del
    // tráiler se expande desde el centro a pantalla completa y entran título, ficha, póster y créditos.
    // Móvil: entrada sencilla sin fijar (fijar en móvil se siente brusco).
    if (state.spotlight) {
      ST.matchMedia({
        '(min-width: 861px)': () => {
          const words = splitWords($('.spotlight__title'));
          const tl = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: { trigger: '#latest', start: 'top top', end: '+=150%', pin: '.spotlight__stage', scrub: 1, anticipatePin: 1 }
          });
          tl.fromTo('.spotlight__frame', { clipPath: 'inset(22% 30% 22% 30% round 8px)' }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', duration: 1, ease: 'power2.inOut' }, 0)
            .fromTo('.spotlight__media', { scale: 1.3 }, { scale: 1, duration: 1, ease: 'power2.inOut' }, 0)
            .fromTo('.spotlight__shade', { opacity: .55 }, { opacity: 1, duration: .55 }, .35)
            .to('.spotlight__presents', { opacity: 0, y: -80, duration: .35, ease: 'power2.in' }, .1)
            .fromTo('.spotlight__ghost', { opacity: 0 }, { opacity: 1, duration: .4 }, .6)
            .from(words, { yPercent: 115, duration: .45, stagger: .04, ease: 'power3.out' }, .55)
            .from('.spotlight__badge, .spotlight__tagline, .spotlight__meta, .spotlight__synopsis, .spotlight__actions > *',
              { opacity: 0, y: 34, duration: .35, stagger: .04, ease: 'power2.out' }, .72)
            .from('.spotlight__poster', { yPercent: 45, rotate: 14, opacity: 0, duration: .55, ease: 'power3.out' }, .62)
            .from('.spotlight__billing', { opacity: 0, y: 24, duration: .35 }, .95)
            .to({}, { duration: .35 });   // pausa al final: la escena se aprecia completa antes de seguir
          state.spotlightST = tl.scrollTrigger;
        },
        '(max-width: 860px)': () => {
          const st = { trigger: '#latest', start: 'top 70%' };
          gsap.from(splitWords($('.spotlight__title')), { yPercent: 110, duration: 1.1, stagger: .06, ease: 'power4.out', scrollTrigger: st });
          gsap.from('.spotlight__badge, .spotlight__tagline, .spotlight__meta, .spotlight__synopsis, .spotlight__actions > *, .spotlight__billing',
            { opacity: 0, y: 26, duration: .9, stagger: .07, ease: 'power3.out', scrollTrigger: st });
          gsap.from('.spotlight__poster', { y: 80, rotate: -10, opacity: 0, duration: 1.3, ease: 'power4.out', scrollTrigger: st });
          state.spotlightST = null;
        }
      });

      // Los enlaces a #latest llevan al final de la escena (ya expandida); el scroll suave la reproduce
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href="#latest"]');
        if (!a) return;
        e.preventDefault();
        const t = state.spotlightST;
        const top = t ? t.end - 2 : $('#latest').getBoundingClientRect().top + scrollY;
        window.scrollTo({ top, behavior: REDUCED ? 'auto' : 'smooth' });
      });
    }

    // Fundador en "The studio": retrato que se revela, nombre que sube línea por línea, cita y enlace
    if ($('.founder') && !$('.founder').hidden) {
      const st = { trigger: '.founder', start: 'top 72%' };
      gsap.fromTo('.founder__portrait img', { clipPath: 'inset(100% 0 0 0)', scale: 1.25 }, { clipPath: 'inset(0% 0 0 0)', scale: 1, duration: 1.6, ease: 'power4.inOut', scrollTrigger: st });
      gsap.from('.founder__ring', { scale: 0, opacity: 0, duration: 1.2, ease: 'back.out(1.6)', delay: .8, scrollTrigger: st });
      gsap.from('.founder__name .w > span', { yPercent: 110, duration: 1.2, stagger: .12, ease: 'power4.out', delay: .3, scrollTrigger: st });
      gsap.from('.founder__kicker i', { scaleX: 0, transformOrigin: 'left', duration: 1, ease: 'power3.out', scrollTrigger: st });
      gsap.from('.founder__kicker span, .founder__quote, .founder__teaser, .founder__link', { opacity: 0, y: 26, duration: 1, stagger: .1, ease: 'power3.out', delay: .55, scrollTrigger: st });
      gsap.to('.founder__portrait', { yPercent: -6, ease: 'none', scrollTrigger: { trigger: '.founder', start: 'top bottom', end: 'bottom top', scrub: true } });
    }

    // Contacto y footer
    gsap.from(splitWords($('.contact__title')), { yPercent: 110, duration: 1.2, stagger: .06, ease: 'power4.out', scrollTrigger: { trigger: '.contact', start: 'top 70%' } });
    gsap.from('.footer__brand, .footer__social', { y: 24, opacity: 0, duration: 1, stagger: .1, ease: 'power3.out', scrollTrigger: { trigger: '.footer', start: 'top 95%' } });

    // Destacados: scroll horizontal fijado (solo en pantallas grandes)
    ST.matchMedia({
      '(min-width: 761px)': () => {
        const track = $('.featured__track');
        const dist = () => Math.max(0, track.scrollWidth - innerWidth);
        const tween = gsap.to(track, {
          x: () => -dist(), ease: 'none',
          scrollTrigger: { trigger: '.featured__pin', start: 'top top', end: () => '+=' + dist(), pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1 }
        });
        // Cada póster hace un ligero parallax interno mientras se desplaza
        $$('.feat img', track).forEach((img) => gsap.fromTo(img, { xPercent: -6 }, { xPercent: 6, ease: 'none', scrollTrigger: { trigger: img.parentElement, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } }));
      }
    });
  }

  /* ───────────────────────── Interacciones globales ───────────────────────── */
  function uiInteractions() {
    // Header: se oculta al bajar, reaparece al subir
    let lastY = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY;
      const h = $('.header');
      h.classList.toggle('is-scrolled', y > 40);
      // Ya pasó la portada (video): en modo claro el header cambia a fondo claro y logo oscuro
      h.classList.toggle('is-past-hero', y > ($('.hero')?.offsetHeight || innerHeight) - h.offsetHeight);
      h.classList.toggle('is-hidden', y > lastY && y > 400 && !$('.nav').classList.contains('is-open'));
      lastY = y;
    }, { passive: true });

    // Menú móvil
    const btn = $('.menu-btn'), nav = $('.nav');
    btn.addEventListener('click', () => {
      const open = !nav.classList.contains('is-open');
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('is-locked', open);
    });
    $$('a', nav).forEach((a) => a.addEventListener('click', () => {
      nav.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); document.body.classList.remove('is-locked');
    }));

    // Timecode del hero (24 fps)
    const tc = $('.timecode');
    const t0 = performance.now();
    const pad = (n) => String(n).padStart(2, '0');
    (function tick() {
      const f = Math.floor((performance.now() - t0) / (1000 / 24));
      tc.textContent = `${pad(Math.floor(f / 86400) % 24)}:${pad(Math.floor(f / 1440) % 60)}:${pad(Math.floor(f / 24) % 60)}:${pad(f % 24)}`;
      requestAnimationFrame(tick);
    })();

    // Abrir fichas (delegación de eventos para tarjetas y destacados)
    document.addEventListener('click', (e) => {
      const card = e.target.closest('[data-slug]');
      if (card && !e.target.closest('.detail')) openProject(card.dataset.slug);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-slug]')) openProject(e.target.dataset.slug);
    });

    // Botones magnéticos
    if (ANIM) $$('.btn-ghost').forEach((b) => {
      b.addEventListener('mousemove', (e) => {
        const r = b.getBoundingClientRect();
        gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * .25, y: (e.clientY - r.top - r.height / 2) * .35, duration: .4 });
      });
      b.addEventListener('mouseleave', () => gsap.to(b, { x: 0, y: 0, duration: .7, ease: 'elastic.out(1, .4)' }));
    });
  }

  /* ───────────────────────── Cortina de transición ───────────────────────── */
  const curtain = {
    in() {
      if (!ANIM) return Promise.resolve();
      return new Promise((r) => gsap.timeline({ onComplete: r })
        .set('.curtain', { pointerEvents: 'auto' })
        .fromTo('.curtain__panel', { scaleY: 0 }, { scaleY: 1, duration: .7, stagger: .08, ease: 'power4.inOut' })
        .fromTo('.curtain__brand', { opacity: 0, scale: .85 }, { opacity: 1, scale: 1, duration: .5, ease: 'power3.out' }, '-=.2'));
    },
    out() {
      if (!ANIM) return Promise.resolve();
      return new Promise((r) => gsap.timeline({ onComplete: r })
        .to('.curtain__brand', { opacity: 0, duration: .25 })
        .to('.curtain__panel', { scaleY: 0, duration: .7, stagger: .08, ease: 'power4.inOut', transformOrigin: (i) => (i ? 'top' : 'bottom') })
        .set('.curtain__panel', { clearProps: 'transformOrigin' })
        .set('.curtain', { pointerEvents: 'none' }));
    }
  };

  /* ───────────────────────── Ficha de proyecto ───────────────────────── */
  const detail = $('.detail');
  const detailScroll = $('.detail__scroll');
  let lastFocus = null;
  let gallery = [];

  /** Convierte la URL del tráiler en embed de YouTube/Vimeo o en <video> nativo. */
  function trailerEmbed(url) {
    url = safeUrl(url);
    if (!url) return null;
    let m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return `<iframe src="https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0&modestbranding=1" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="Trailer"></iframe>`;
    m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return `<iframe src="https://player.vimeo.com/video/${m[1]}?autoplay=1&title=0&byline=0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="Trailer"></iframe>`;
    return `<video src="${esc(url)}" controls autoplay playsinline></video>`;
  }

  function renderDetail(p) {
    const groups = { reparto: 'Cast', artistas: 'Artists', equipo: 'Crew' };
    const credits = Object.entries(groups).map(([key, title]) => {
      const list = p.credits.filter((c) => c.department === key);
      if (!list.length) return '';
      return `<div><h4 class="mono">${title}</h4><ul>${list.map((c) => `
        <li><span>${esc(c.role)}</span><span>${c.person_id
          ? `<button class="person" data-person='${esc(JSON.stringify({ name: c.name, bio: c.bio, photo: safeUrl(c.photo_url), role: c.role }))}'>${esc(c.name)}</button>`
          : esc(c.name)}</span></li>`).join('')}</ul></div>`;
    }).join('');

    // Un archivo cuenta como video si está marcado así o si su enlace es de video (.mp4, Cloudinary /video/…)
    const looksVideo = (u) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u) || /res\.cloudinary\.com\/[^/]+\/video\//.test(u);
    gallery = p.media.map((m) => ({ ...m, url: safeUrl(m.url) })).filter((m) => m.url)
      .map((m) => ({ ...m, type: m.type === 'video' || looksVideo(m.url) ? 'video' : 'image' }));
    // Los videos se cargan y reproducen solos al aparecer en pantalla (ver autoplayGallery)
    const galleryHtml = gallery.map((m, i) => `
      <figure data-index="${i}"${m.type === 'video' ? ' class="is-video"' : ''}>
        ${m.type === 'video'
          ? `<video data-src="${esc(responsiveVideo(m.url, { max1080: true }))}" muted loop playsinline preload="none" disablepictureinpicture aria-label="${esc(m.caption || p.title)}"></video>
             <span class="vid-badge mono" aria-hidden="true"><i></i>Playing</span>`
          : `<img src="${esc(m.url)}" alt="${esc(m.caption || p.title)}" loading="lazy">`}
      </figure>`).join('');

    // Siguiente proyecto (para navegar sin volver a la galería)
    const idx = state.projects.findIndex((x) => x.slug === p.slug);
    const next = state.projects[(idx + 1) % state.projects.length];
    const trailerHtml = trailerEmbed(p.trailer_url);
    const backdrop = safeUrl(p.backdrop_url) || safeUrl(p.poster_url);

    detailScroll.innerHTML = `
      <section class="d-hero">
        <div class="d-hero__bg"><img src="${esc(backdrop)}" alt=""></div>
        <div class="d-hero__content">
          <div class="d-poster"><img src="${esc(safeUrl(p.poster_url))}" alt="${esc(p.title)} poster"></div>
          <div>
            <p class="d-kicker mono">${esc(p.category_name || '')}${p.year ? ' · ' + esc(p.year) : ''}</p>
            <h2 class="d-title" id="detail-title">${esc(p.title)}</h2>
            ${p.tagline ? `<p class="d-tagline">${esc(p.tagline)}</p>` : ''}
          </div>
        </div>
      </section>

      <dl class="d-facts">
        ${[['Directed by', p.director], ['Year', p.year], ['Runtime', p.duration], ['Genre', p.genre]]
          .filter(([, v]) => v).map(([k, v]) => `<div><dt class="mono">${k}</dt><dd>${esc(v)}</dd></div>`).join('')}
      </dl>

      ${p.synopsis ? `<section class="d-block d-anim"><div class="d-block__head"><span class="mono" style="color:var(--accent)">Synopsis</span></div>
        <p class="d-synopsis">${esc(p.synopsis)}</p></section>` : ''}

      ${trailerHtml ? `<section class="d-block d-anim"><div class="d-block__head"><span class="mono" style="color:var(--accent)">01</span><h3>Trailer</h3></div>
        <div class="d-trailer"><div class="d-trailer__poster">
          <img src="${esc(backdrop)}" alt=""><span class="d-trailer__btn">${PLAY_ICON}</span></div></div></section>` : ''}

      ${credits ? `<section class="d-block d-anim"><div class="d-block__head"><span class="mono" style="color:var(--accent)">02</span><h3>Credits</h3></div>
        <div class="d-credits">${credits}</div></section>` : ''}

      ${galleryHtml ? `<section class="d-block d-anim"><div class="d-block__head"><span class="mono" style="color:var(--accent)">03</span><h3>Gallery</h3></div>
        <div class="d-gallery">${galleryHtml}</div></section>` : ''}

      ${next && next.slug !== p.slug ? `<a class="d-next" data-next="${esc(next.slug)}">
        <div class="d-next__bg"><img src="${esc(safeUrl(next.backdrop_url) || safeUrl(next.poster_url))}" alt=""></div>
        <p class="mono">Next project</p><h3>${esc(next.title)}</h3></a>` : ''}
    `;

    // Tráiler: se carga solo al pulsar (no consume datos ni ralentiza la ficha)
    const tp = $('.d-trailer__poster', detailScroll);
    if (tp) tp.addEventListener('click', () => { tp.parentElement.innerHTML = trailerHtml; });

    autoplayGallery();
  }

  /**
   * Videos de la galería: se reproducen SOLOS (sin sonido y en bucle) cuando aparecen en pantalla
   * y se pausan al salir, para no gastar datos ni batería. El archivo se descarga solo cuando
   * el video está por aparecer. Con "reducir movimiento" activado en el sistema, se reproducen al pasar el ratón.
   */
  let galleryIO = null;
  function autoplayGallery() {
    if (galleryIO) { galleryIO.disconnect(); galleryIO = null; }
    const vids = $$('.d-gallery video', detailScroll);
    if (!vids.length) return;
    const load = (v) => { if (!v.src && v.dataset.src) { v.src = v.dataset.src; v.load(); } };
    const play = (v) => { load(v); v.play().then(() => v.parentElement.classList.add('is-playing')).catch(() => {}); };
    const pause = (v) => { v.pause(); v.parentElement.classList.remove('is-playing'); };
    vids.forEach((v) => {
      v.addEventListener('loadeddata', () => v.parentElement.classList.add('is-loaded'), { once: true });
      v.addEventListener('error', () => v.parentElement.classList.add('is-error'), { once: true });
    });
    if (REDUCED) {
      vids.forEach((v) => {
        load(v);
        v.parentElement.addEventListener('mouseenter', () => play(v));
        v.parentElement.addEventListener('mouseleave', () => pause(v));
      });
      return;
    }
    // Precarga un poco antes de que se vea (rootMargin) y reproduce cuando se ve al menos un 35 %
    const pre = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { load(en.target); pre.unobserve(en.target); }
    }), { root: detailScroll, rootMargin: '600px 0px' });
    galleryIO = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting && en.intersectionRatio >= .35) play(en.target); else pause(en.target);
    }), { root: detailScroll, threshold: [0, .35] });
    vids.forEach((v) => { pre.observe(v); galleryIO.observe(v); });
  }
  // Pestaña oculta → pausa los videos de la galería; al volver, el observador reanuda los visibles
  document.addEventListener('visibilitychange', () => {
    if (!galleryIO) return;
    const vids = $$('.d-gallery video', detailScroll);
    if (document.hidden) vids.forEach((v) => v.pause());
    else { galleryIO.disconnect(); vids.forEach((v) => galleryIO.observe(v)); }
  });

  /** Animaciones de entrada de la ficha + reveals al hacer scroll dentro de ella. */
  function animateDetail() {
    if (!ANIM) return;
    const words = splitWords($('.d-title', detailScroll));
    gsap.timeline()
      .from('.d-hero__bg img', { scale: 1.3, duration: 2, ease: 'power3.out' }, 0)
      .from('.d-poster', { clipPath: 'inset(100% 0 0 0)', y: 40, duration: 1.2, ease: 'power4.out' }, .1)
      .from('.d-kicker', { opacity: 0, y: 20, duration: .8 }, .3)
      .from(words, { yPercent: 110, duration: 1.1, stagger: .05, ease: 'power4.out' }, .3)
      .from('.d-tagline', { opacity: 0, y: 20, duration: .8 }, .7)
      .from('.d-facts > div', { opacity: 0, y: 20, stagger: .08, duration: .7 }, .8);

    // Parallax del fondo dentro del contenedor con scroll propio
    if (ST) gsap.to('.d-hero__bg img', { yPercent: 15, ease: 'none', scrollTrigger: { scroller: detailScroll, trigger: '.d-hero', start: 'top top', end: 'bottom top', scrub: true } });

    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      gsap.fromTo(en.target, { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 1.1, ease: 'power3.out' });
      const figs = en.target.querySelectorAll('.d-gallery figure, .d-credits > div');
      if (figs.length) gsap.fromTo(figs, { opacity: 0, y: 40, clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)', duration: 1, stagger: .08, ease: 'power3.out', delay: .2 });
    }), { root: detailScroll, threshold: .12 });
    $$('.d-anim', detailScroll).forEach((el) => { gsap.set(el, { opacity: 0 }); io.observe(el); });
  }

  async function openProject(slug, { push = true } = {}) {
    if (!slug) return;
    lastFocus = lastFocus || document.activeElement;
    const [data] = await Promise.all([
      fetch(`/api/projects/${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.json() : null)),
      curtain.in()
    ]);
    if (!data) { await curtain.out(); return; }

    ST && ST.getAll().filter((t) => t.scroller === detailScroll).forEach((t) => t.kill());
    renderDetail(data);
    detail.hidden = false;
    detailScroll.scrollTop = 0;
    document.body.classList.add('is-locked');
    state.detailOpen = true;
    document.title = `${data.title} — ${state.settings.site_name || 'DayOff Studios'}`;
    if (push) history.pushState({ slug }, '', `/project/${slug}`);
    await curtain.out();
    animateDetail();
    $('.detail__close').focus({ preventScroll: true });
  }

  async function closeProject({ push = true } = {}) {
    if (!state.detailOpen) return;
    await curtain.in();
    detail.hidden = true;
    if (galleryIO) { galleryIO.disconnect(); galleryIO = null; }
    clearInterval(founderSwap); founderSwap = null;
    detailScroll.innerHTML = '';
    document.body.classList.remove('is-locked');
    state.detailOpen = false;
    document.title = `${state.settings.site_name || 'DayOff Studios'} — ${state.settings.slogan || ''}`;
    if (push) history.pushState({}, '', '/');
    await curtain.out();
    if (lastFocus) { lastFocus.focus({ preventScroll: true }); lastFocus = null; }
  }

  $('.detail__close').addEventListener('click', () => closeProject());
  detailScroll.addEventListener('click', (e) => {
    const next = e.target.closest('[data-next]');
    if (next) { e.preventDefault(); openProject(next.dataset.next); return; }
    const person = e.target.closest('[data-person]');
    if (person) { openBio(JSON.parse(person.dataset.person)); return; }
    const fig = e.target.closest('.d-gallery figure');
    if (fig) openLightbox(+fig.dataset.index);
  });
  addEventListener('popstate', () => {
    const m = location.pathname.match(/^\/(?:project|proyecto)\/([^/]+)/);
    if (m) openProject(decodeURIComponent(m[1]), { push: false });
    else if (/^\/director\//.test(location.pathname)) openFounder({ push: false });
    else closeProject({ push: false });
  });

  /* ───────────────────────── Fundador ─────────────────────────
     Bloque protagonista dentro de "The studio" + página propia en /director/nombre-apellido.
     Los textos se editan en el panel → Textos del sitio → "Fundador / creador". */
  const slugify = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const founderSlug = () => slugify(state.settings.founder_name);
  const disciplines = () => String(state.settings.founder_disciplines || '').split(',').map((d) => d.trim()).filter(Boolean);
  /** Nombre partido en líneas (una por palabra; las dos últimas palabras van juntas si son 3+). */
  function nameLines(name) {
    const w = String(name || '').trim().split(/\s+/);
    return w.length > 2 ? [w.slice(0, -1).join(' '), w[w.length - 1]] : w;
  }

  function renderFounder() {
    const s = state.settings, box = $('.founder');
    if (!box || !s.founder_name) return;
    box.hidden = false;
    $('.founder__name', box).innerHTML = nameLines(s.founder_name).map((l) => `<span class="w"><span>${esc(l)}</span></span>`).join('');
    const q = $('.founder__quote', box);
    q.textContent = s.founder_quote || ''; q.hidden = !s.founder_quote;
    const img = $('.founder__portrait img', box);
    img.src = safeUrl(s.founder_photo_url) || safeUrl(s.about_image_url) || '';
    img.alt = s.founder_name;
    // Sello giratorio con sus oficios; textLength reparte el texto exacto alrededor del círculo
    const ring = $('.founder__ring-text', box);
    const words = disciplines().length ? disciplines() : [s.founder_role || 'Founder'];
    ring.textContent = words.map((d) => `${d} · `).join('').toUpperCase();
    ring.setAttribute('textLength', '486'); ring.setAttribute('lengthAdjust', 'spacing');
    const first = s.founder_name.split(/\s+/)[0];
    $('.founder__link-label', box).textContent = 'Learn more about him';
    $$('[data-founder-link]').forEach((a) => {
      a.href = `/director/${founderSlug()}`;
      a.setAttribute('aria-label', `Learn more about ${s.founder_name}`);
    });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-founder-link]');
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      openFounder();
    });
    box.dataset.first = first;
  }

  let founderSwap = null;
  async function openFounder({ push = true } = {}) {
    lastFocus = lastFocus || document.activeElement;
    const [data] = await Promise.all([
      fetch('/api/founder').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      curtain.in()
    ]);
    if (!data) { await curtain.out(); return; }
    ST && ST.getAll().filter((t) => t.scroller === detailScroll).forEach((t) => t.kill());
    renderFounderPage(data);
    detail.hidden = false;
    detailScroll.scrollTop = 0;
    document.body.classList.add('is-locked');
    state.detailOpen = true;
    document.title = `${data.name} — ${state.settings.site_name || 'DayOff Studios'}`;
    if (push) history.pushState({ founder: 1 }, '', `/director/${slugify(data.name)}`);
    await curtain.out();
    animateFounder();
    $('.detail__close').focus({ preventScroll: true });
  }

  function renderFounderPage(f) {
    const s = state.settings;
    const photo = safeUrl(f.photo_url) || safeUrl(s.about_image_url) || '';
    const ds = disciplines();
    const first = String(f.name).split(/\s+/)[0];
    const lines = nameLines(f.name);
    const chars = (t) => [...t].map((c) => `<span class="ch">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
    const bio = String(f.bio || '').split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    const miles = String(f.milestones || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0]);
    const firstYear = f.films.map((x) => +x.year).filter(Boolean).sort()[0];
    const sun = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>';
    const mq = (ds.length ? ds : [f.role || 'Director']).map((d) => `<span>${esc(d)}</span>${sun}`).join('');

    detailScroll.innerHTML = `
      <article class="f-page" aria-labelledby="detail-title">
        <header class="f-hero">
          <div class="f-hero__portrait"><img src="${esc(photo)}" alt="${esc(f.name)}"></div>
          <span class="f-hero__scroll mono" aria-hidden="true">Scroll — the story</span>
          <div class="f-hero__text">
            <p class="f-hero__kicker mono"><i></i><span>${esc(f.role || '')}</span>
              ${ds.length ? `<span class="f-hero__swap">${ds.map((d) => `<span>${esc(d)}</span>`).join('')}</span>` : ''}</p>
            <h1 class="f-name" id="detail-title">${lines.map((l) => `<span class="w">${chars(l)}</span>`).join('')}</h1>
          </div>
        </header>

        <div class="f-marquee" aria-hidden="true"><div class="f-marquee__track">${mq.repeat(6)}</div></div>

        ${f.quote ? `<section class="f-section">
          <p class="f-label mono"><b>01</b> In his words</p>
          <blockquote class="f-quote">${esc(f.quote).split(/\s+/).map((w) => `<span class="qw">${w}</span>`).join('')}</blockquote>
        </section>` : ''}

        ${bio ? `<section class="f-section f-bio">
          <aside class="f-bio__aside">
            <img src="${esc(photo)}" alt="" loading="lazy">
            <dl>
              ${f.role ? `<div><dt class="mono">Role</dt><dd>${esc(f.role)}</dd></div>` : ''}
              ${ds.length ? `<div><dt class="mono">Disciplines</dt><dd>${ds.map(esc).join(' · ')}</dd></div>` : ''}
              <div><dt class="mono">Studio</dt><dd>${esc(s.site_name || 'DayOff Studios')}</dd></div>
            </dl>
          </aside>
          <div><p class="f-label mono"><b>02</b> Biography</p><div class="f-bio__text">${bio}</div></div>
        </section>` : ''}

        ${miles.length ? `<section class="f-section">
          <p class="f-label mono"><b>03</b> Trajectory</p>
          <div class="f-timeline"><span class="f-timeline__line"></span><ol>
            ${miles.map(([y, t]) => `<li><b>${esc(y)}</b>${t ? `<p>${esc(t)}</p>` : ''}</li>`).join('')}
          </ol></div>
        </section>` : ''}

        ${f.films.length ? `<section class="f-section">
          <p class="f-label mono"><b>04</b> ${f.own ? 'Filmography' : 'From the studio'}${firstYear ? ` <b>· since ${firstYear}</b>` : ''}</p>
          <ul class="f-films">
            ${f.films.map((x) => `<li><a href="/project/${esc(x.slug)}" data-next="${esc(x.slug)}" data-poster="${esc(safeUrl(x.poster_url))}">
              <span class="y mono">${esc(x.year || '')}</span>
              <h4>${esc(x.title)}</h4>
              <span class="c mono">${esc(x.category_name || '')}</span>
              <span class="r mono">${esc(x.role || '')}</span>
            </a></li>`).join('')}
          </ul>
          <div class="f-preview" aria-hidden="true"><img alt=""></div>
        </section>` : ''}

        ${s.contact_email ? `<footer class="f-cta">
          <p class="mono">Have a story to tell?</p>
          <a href="mailto:${esc(s.contact_email)}">Work with ${esc(first)} <span>→</span></a>
        </footer>` : ''}
      </article>`;

    // Póster que sigue al cursor en la filmografía
    const list = $('.f-films', detailScroll), pv = $('.f-preview', detailScroll);
    if (list && pv && ANIM && HOVER.matches) {
      const pimg = $('img', pv);
      const xTo = gsap.quickTo(pv, 'x', { duration: .5, ease: 'power3' }), yTo = gsap.quickTo(pv, 'y', { duration: .5, ease: 'power3' });
      let on = false;
      list.addEventListener('mousemove', (e) => {
        const a = e.target.closest('a[data-poster]');
        if (!on) { gsap.set(pv, { x: e.clientX, y: e.clientY }); }
        xTo(e.clientX); yTo(e.clientY);
        if (a && a.dataset.poster) {
          if (pimg.getAttribute('src') !== a.dataset.poster) pimg.src = a.dataset.poster;
          if (!on) { on = true; gsap.to(pv, { opacity: 1, scale: 1, rotate: gsap.utils.random(-5, 5), duration: .45, ease: 'power3.out', overwrite: true }); }
        } else if (on) { on = false; gsap.to(pv, { opacity: 0, scale: .85, duration: .3, overwrite: true }); }
      });
      const off = () => { if (on) { on = false; gsap.to(pv, { opacity: 0, scale: .85, duration: .25, overwrite: true }); } };
      list.addEventListener('mouseleave', off);
      detailScroll.addEventListener('scroll', off, { passive: true });
    }
  }

  function animateFounder() {
    clearInterval(founderSwap); founderSwap = null;
    const swaps = $$('.f-hero__swap span', detailScroll);
    // Oficios que se turnan bajo el cargo: Director → Screenwriter → Producer…
    if (swaps.length > 1) {
      let i = 0;
      if (ANIM) gsap.set(swaps.slice(1), { yPercent: 110 });
      else swaps.slice(1).forEach((el) => { el.style.visibility = 'hidden'; });
      founderSwap = setInterval(() => {
        const cur = swaps[i], next = swaps[(i + 1) % swaps.length];
        i = (i + 1) % swaps.length;
        if (ANIM) {
          gsap.to(cur, { yPercent: -110, duration: .6, ease: 'power3.in' });
          gsap.fromTo(next, { yPercent: 110 }, { yPercent: 0, duration: .7, ease: 'power3.out', delay: .25 });
        } else { cur.style.visibility = 'hidden'; next.style.visibility = 'visible'; }
      }, 2200);
    }
    if (!ANIM) return;
    const tl = gsap.timeline();
    tl.fromTo('.f-hero__portrait', { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 1.6, ease: 'power4.inOut' }, 0)
      .from('.f-hero__portrait img', { scale: 1.35, duration: 2.2, ease: 'power3.out' }, 0)
      .from('.f-name .w:first-child .ch', { yPercent: 115, rotate: 8, duration: 1.1, stagger: .035, ease: 'power4.out' }, .45)
      .from('.f-name .w:last-child .ch', { yPercent: 115, rotate: 8, duration: 1.1, stagger: .035, ease: 'power4.out' }, .7)
      .from('.f-hero__kicker', { opacity: 0, y: 20, duration: .8 }, 1.1)
      .from('.f-hero__scroll', { opacity: 0, duration: 1 }, 1.4);
    if (!ST) return;
    const sc = { scroller: detailScroll };
    gsap.to('.f-hero__portrait img', { yPercent: -12, ease: 'none', scrollTrigger: { ...sc, trigger: '.f-hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.f-name .w:first-child', { xPercent: -8, ease: 'none', scrollTrigger: { ...sc, trigger: '.f-hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.f-name .w:last-child', { xPercent: 6, ease: 'none', scrollTrigger: { ...sc, trigger: '.f-hero', start: 'top top', end: 'bottom top', scrub: true } });
    // La cita se "enciende" palabra por palabra al bajar
    const qw = $$('.f-quote .qw', detailScroll);
    if (qw.length) gsap.fromTo(qw, { opacity: .14 }, { opacity: 1, stagger: .1, ease: 'none', scrollTrigger: { ...sc, trigger: '.f-quote', start: 'top 80%', end: 'bottom 40%', scrub: true } });
    $$('.f-label', detailScroll).forEach((el) => gsap.from(el, { opacity: 0, x: -20, duration: .8, scrollTrigger: { ...sc, trigger: el, start: 'top 90%' } }));
    if ($('.f-bio', detailScroll)) {
      gsap.from('.f-bio__aside img', { clipPath: 'inset(0 0 100% 0)', duration: 1.4, ease: 'power4.inOut', scrollTrigger: { ...sc, trigger: '.f-bio', start: 'top 75%' } });
      gsap.from('.f-bio__text p', { opacity: 0, y: 30, duration: 1, stagger: .12, ease: 'power3.out', scrollTrigger: { ...sc, trigger: '.f-bio__text', start: 'top 80%' } });
    }
    if ($('.f-timeline', detailScroll)) {
      gsap.fromTo('.f-timeline__line', { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { ...sc, trigger: '.f-timeline', start: 'top 85%', end: 'top 35%', scrub: true } });
      gsap.from('.f-timeline li', { opacity: 0, y: 30, duration: .9, stagger: .15, ease: 'power3.out', scrollTrigger: { ...sc, trigger: '.f-timeline', start: 'top 75%' } });
    }
    if ($('.f-films', detailScroll)) gsap.from('.f-films li', { opacity: 0, y: 30, duration: .8, stagger: .07, ease: 'power3.out', scrollTrigger: { ...sc, trigger: '.f-films', start: 'top 80%' } });
    if ($('.f-cta', detailScroll)) gsap.from('.f-cta a', { yPercent: 40, opacity: 0, duration: 1.2, ease: 'power4.out', scrollTrigger: { ...sc, trigger: '.f-cta', start: 'top 80%' } });
  }

  /* ───────────────────────── Biografía ───────────────────────── */
  const bio = $('.bio');
  function openBio(p) {
    $('.bio__name', bio).textContent = p.name;
    $('.bio__kind', bio).textContent = p.role;
    $('.bio__text', bio).textContent = p.bio || 'Biography coming soon.';
    const ph = $('.bio__photo', bio);
    ph.hidden = !p.photo; if (p.photo) ph.src = p.photo;
    bio.hidden = false;
    if (ANIM) gsap.fromTo('.bio__card', { opacity: 0, y: 40, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .6, ease: 'power3.out' });
    $('.bio__close', bio).focus();
  }
  const closeBio = () => { bio.hidden = true; };
  bio.addEventListener('click', (e) => { if (e.target === bio || e.target.closest('.bio__close')) closeBio(); });

  /* ───────────────────────── Lightbox ───────────────────────── */
  const lb = $('.lightbox');
  let lbIndex = 0;
  function showLightbox(dir = 0) {
    const m = gallery[lbIndex];
    const stage = $('.lightbox__stage', lb);
    stage.innerHTML = (m.type === 'video'
      ? `<video src="${esc(responsiveVideo(m.url))}" controls autoplay playsinline></video>`
      : `<img src="${esc(m.url)}" alt="${esc(m.caption || '')}">`) + (m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : '');
    $('.lightbox__count', lb).textContent = `${String(lbIndex + 1).padStart(2, '0')} / ${String(gallery.length).padStart(2, '0')}`;
    if (ANIM) gsap.fromTo(stage.firstElementChild, { opacity: 0, x: dir * 60 }, { opacity: 1, x: 0, duration: .5, ease: 'power3.out' });
  }
  function openLightbox(i) { lbIndex = i; lb.hidden = false; showLightbox(); }
  const closeLightbox = () => { lb.hidden = true; lb.classList.remove('is-trailer'); $('.lightbox__stage', lb).innerHTML = ''; };
  /** Tráiler a pantalla completa (desde el estreno), sin abrir la ficha. */
  function openTrailer(url) {
    const embed = trailerEmbed(url);
    if (!embed) return;
    lb.classList.add('is-trailer');
    $('.lightbox__stage', lb).innerHTML = `<div class="lightbox__trailer">${embed}</div>`;
    lb.hidden = false;
    if (ANIM) gsap.fromTo('.lightbox__trailer', { opacity: 0, scale: .94 }, { opacity: 1, scale: 1, duration: .6, ease: 'power3.out' });
    $('.lightbox__close', lb).focus();
  }
  const step = (d) => { lbIndex = (lbIndex + d + gallery.length) % gallery.length; showLightbox(d); };
  $('.lightbox__prev').addEventListener('click', () => step(-1));
  $('.lightbox__next').addEventListener('click', () => step(1));
  $('.lightbox__close').addEventListener('click', closeLightbox);

  // Teclado: Esc cierra la capa superior; flechas navegan la galería
  document.addEventListener('keydown', (e) => {
    if (!lb.hidden) {
      if (e.key === 'Escape') closeLightbox();
      if (!lb.classList.contains('is-trailer') && e.key === 'ArrowRight') step(1);
      if (!lb.classList.contains('is-trailer') && e.key === 'ArrowLeft') step(-1);
    } else if (!bio.hidden) { if (e.key === 'Escape') closeBio(); }
    else if (state.detailOpen && e.key === 'Escape') closeProject();
  });

  /* ───────────────────────── Arranque ───────────────────────── */
  (async function boot() {
    try {
      await loadSite();
      applySettings();
      renderSpotlight();
      renderFeatured();
      renderCategories();
      renderFilters();
      renderGrid();
      renderFounder();
      await Promise.race([
        Promise.all([
          heroReel.ready(), // primer video listo para reproducirse
          preloadImages([
            ...(heroReel.urls?.length ? [] : [safeUrl(state.settings.hero_image_url)]), // imagen fija solo si no hay videos
            ...state.projects.slice(0, 6).map((p) => safeUrl(p.poster_url))
          ])
        ]),
        new Promise((r) => setTimeout(r, 6000)) // nunca esperar más de 6 s
      ]);
      if (document.fonts) await document.fonts.ready;
    } catch (err) {
      console.error(err);
      $('.hero__title').textContent = 'We couldn’t load the content. Please refresh the page.';
    }
    moveInk();
    uiInteractions();
    await preloader.finish((at) => { heroReel.begin(); heroIntro(at); });
    // ScrollTrigger también "recuerda" la posición anterior y la restaura: se le pide que no lo haga
    if (ST) ST.clearScrollMemory('manual');
    scrollTo(0, 0);
    scrollAnimations();
    // Recalcula posiciones cuando terminan de cargar imágenes/fuentes (evita saltos y zonas vacías)
    if (ST) {
      ST.refresh();
      if (document.readyState !== 'complete') addEventListener('load', () => ST.refresh(), { once: true });
    }

    // Enlace directo a una ficha: /proyecto/mi-pelicula
    const m = location.pathname.match(/^\/(?:project|proyecto)\/([^/]+)/);
    if (m) openProject(decodeURIComponent(m[1]), { push: false });
    else if (/^\/director\//.test(location.pathname)) openFounder({ push: false });
  })();
})();