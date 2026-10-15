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
  /**
   * Imagen optimizada: pide al servidor la versión WebP al ancho justo para la pantalla (/img/<ancho>/uploads/…).
   * "cssW" = ancho aproximado en pantalla (px CSS); se multiplica por la densidad de la pantalla (máx. 2×).
   * Cloudinary: usa sus transformaciones (f_auto, q_auto, w_). Otros enlaces externos se dejan igual.
   */
  const IMG_W = [320, 480, 640, 960, 1280, 1600, 1920, 2560];
  function opt(url, cssW = innerWidth) {
    url = safeUrl(url);
    if (!url) return '';
    const px = Math.min(2560, Math.round(cssW * Math.min(2, window.devicePixelRatio || 1)));
    const w = IMG_W.find((x) => x >= px) || 2560;
    if (/^\/(uploads|media)\/[^?#]+\.(jpe?g|png|webp|avif)$/i.test(url)) return `/img/${w}${url}`;
    if (/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url) && !/\/upload\/[^/]*(w_|f_auto)/.test(url)) {
      return url.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${w}/`);
    }
    return url;
  }
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
          // Sin pausas muertas: al terminar el "1" entra ¡Action! y el número sale de inmediato con un golpe
          // (como el corte de la claqueta), mientras la cuenta regresiva se desvanece.
          tl.call(() => this.showCall(this.CALLS.length - 1))
            .to('.preloader__count', { scale: 1.35, opacity: 0, duration: .45, ease: 'power3.in' }, 0)
            .to('.preloader__leader, .preloader__progress, .preloader__meta', { opacity: 0, scale: .96, duration: .4, ease: 'power2.in' }, .2)
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
        v.addEventListener('ended', () => {
          if (v !== this.v[this.cur]) return;
          if (performance.now() < this.holdUntil) { v.currentTime = 0; this.play(v); return; }   // nunca corta durante la intro
          this.next();
        });
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
      if (this.poster && !$('.hero__poster')) $('.hero__media').insertAdjacentHTML('afterbegin', `<img class="hero__poster" src="${esc(opt(this.poster))}" alt="" fetchpriority="high">`);
    },
    ready() { return this.readyP || Promise.resolve(); },
    /** Arranca el showreel desde el PRIMER clip. Se llama cuando la portada se revela. */
    begin(holdSec = 0) {
      if (!this.v || this.started) return;
      this.started = true;
      this.show(0, true);
      // Mientras dura la revelación con el logo, el primer clip NO puede terminar ni cambiar
      // (con clips cortos, p. ej. 3 s, el cambio se veía como "otra máscara"). Se reproduce en
      // cámara lenta suave para que dure toda la intro y luego sigue el showreel normal.
      if (holdSec > 0) {
        this.holdUntil = performance.now() + holdSec * 1000;
        const v = this.v[0];
        const slow = () => {
          const limit = Math.min(v.duration || this.clip, this.clip);
          v.playbackRate = Math.max(.5, Math.min(1, limit / (holdSec + 1)));
        };
        v.duration ? slow() : v.addEventListener('loadedmetadata', slow, { once: true });
      }
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
      inV.playbackRate = 1;
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
      if (v && this.urls.length > 1 && !v.paused && v.duration && !(performance.now() < this.holdUntil)) {
        const limit = Math.min(v.duration, this.clip);
        if (v.currentTime >= limit - this.FADE / 2) this.next();
      }
      requestAnimationFrame(() => this.tick());
    }
  };

  /* ───────────────────────── Render: textos ───────────────────────── */
  /* Íconos de redes adicionales: se elige según el dominio del enlace; si no se reconoce, ícono de enlace */
  const SOCIAL_ICONS = [
    [/imdb\.com/i, '<svg viewBox="0 0 24 24"><rect x="1.5" y="5.5" width="21" height="13" rx="2.5" class="fill"/><g class="cut"><rect x="4.4" y="8.6" width="1.5" height="6.8"/><path d="M7.2 8.6h1.9l.9 3.6.9-3.6h1.9v6.8h-1.4v-4.6l-1 4.6H9.3l-1-4.6v4.6H7.2z"/><path d="M13.6 8.6h1.9c1.5 0 2 .6 2 1.6v3.6c0 1-.5 1.6-2 1.6h-1.9zm1.5 1.2v4.4c.5 0 .8-.1.8-.6v-3.2c0-.5-.3-.6-.8-.6z"/><path d="M18.2 8.6h1.4v2.2c.3-.3.6-.4 1-.4.7 0 1 .4 1 1.1v2.7c0 .8-.4 1.2-1.1 1.2-.4 0-.7-.2-.9-.5l-.1.4h-1.3zm1.4 3.2v2.4c0 .3.1.4.3.4s.3-.1.3-.4v-2.4c0-.3-.1-.4-.3-.4s-.3.1-.3.4z"/></g></svg>'],
    [/spotify\.com/i, '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" class="fill"/><g class="cut-stroke"><path d="M6.8 9.4c3.5-1 7.5-.7 10.6.9"/><path d="M7.4 12.6c2.9-.8 6-.5 8.6.8"/><path d="M8 15.5c2.2-.6 4.5-.4 6.5.6"/></g></svg>'],
    [/(whatsapp\.com|wa\.me)/i, '<svg viewBox="0 0 24 24" class="stroke"><path d="M4.5 19.5l1.1-3.6A8.3 8.3 0 1 1 8.4 18.6z"/><path d="M9.2 8.6c.3-.6.9-.6 1.2 0l.7 1.5c.1.3 0 .6-.2.8l-.5.5c.6 1.2 1.6 2.2 2.8 2.8l.5-.5c.2-.2.5-.3.8-.2l1.5.7c.6.3.6.9 0 1.2-.8.5-1.8.6-2.7.2a8.3 8.3 0 0 1-4.3-4.3c-.4-.9-.3-1.9.2-2.7z"/></svg>'],
    [/threads\.(net|com)/i, '<svg viewBox="0 0 24 24" class="stroke"><path d="M16.8 11.2c-.5-2.6-2.4-3.9-4.8-3.9-3 0-4.8 2.2-4.8 4.9s1.7 5 4.9 5c2.6 0 4.4-1.4 4.4-3.5 0-1.6-1.3-2.7-3.5-2.7-1.9 0-3 .9-3 2.1 0 1 .9 1.8 2.3 1.8 2.3 0 3.6-2 3.6-5.2 0-4.4-2.6-6.9-6.3-6.9-4.4 0-7 3.3-7 8.4s2.7 8.4 7.2 8.4c3 0 5.1-1.2 6.4-3.4"/></svg>'],
    [/behance\.net/i, '<svg viewBox="0 0 24 24"><rect x="1.5" y="3.5" width="21" height="17" rx="4" class="fill"/><g class="cut"><path d="M4.6 8h3.6c1.5 0 2.4.7 2.4 1.9 0 .8-.4 1.3-1 1.6.9.2 1.4.9 1.4 1.8 0 1.4-1.1 2.2-2.7 2.2H4.6zm1.6 1.3v1.8h1.7c.6 0 1-.3 1-.9s-.4-.9-1-.9zm0 3v2h1.9c.7 0 1.1-.3 1.1-1s-.4-1-1.1-1z"/><path d="M14.4 8.4h3.8v.9h-3.8z"/><path d="M16.3 10.2c1.8 0 2.8 1.2 2.7 3.2h-4.1c.1.9.6 1.4 1.4 1.4.6 0 1-.3 1.2-.7h1.4c-.3 1.2-1.3 1.9-2.6 1.9-1.8 0-2.9-1.2-2.9-2.9s1.1-2.9 2.9-2.9zm-1.4 2.2h2.7c-.1-.8-.6-1.2-1.3-1.2s-1.2.4-1.4 1.2z"/></g></svg>'],
    [/pinterest\./i, '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" class="fill"/><path class="cut" d="M12.3 5.6c-3.6 0-5.4 2.6-5.4 4.7 0 1.3.5 2.4 1.5 2.8.2.1.3 0 .4-.2l.2-.6c0-.2 0-.3-.1-.4-.3-.4-.5-.9-.5-1.5 0-2 1.5-3.7 3.8-3.7 2.1 0 3.2 1.3 3.2 2.9 0 2.2-1 4.1-2.4 4.1-.8 0-1.4-.7-1.2-1.5.2-1 .7-2 .7-2.7 0-.6-.3-1.1-1-1.1-.8 0-1.4.8-1.4 1.9 0 .7.2 1.2.2 1.2l-1 4.1c-.3 1.2 0 2.7 0 2.9 0 .1.1.1.2 0 .1-.1 1-1.3 1.4-2.5l.5-2.1c.3.5 1 .9 1.8.9 2.4 0 4-2.2 4-5.1 0-2.2-1.9-4.3-4.7-4.3z"/></svg>'],
    [/letterboxd\.com/i, '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="3.6" class="fill"/><circle cx="12" cy="12" r="3.6" class="fill"/><circle cx="18.5" cy="12" r="3.6" class="fill"/></svg>'],
    [/(t\.me|telegram\.)/i, '<svg viewBox="0 0 24 24" class="stroke"><path d="M21 4 2.8 11.2l5.7 2 2 6.3 3.2-3.8 4.6 3.4z"/><path d="M8.5 13.2 21 4"/></svg>'],
    [/soundcloud\.com/i, '<svg viewBox="0 0 24 24" class="stroke"><path d="M10 17.5V8.3c.9-.5 1.9-.8 3-.8 3 0 5.4 2.2 5.8 5a2.6 2.6 0 0 1-.5 5z"/><path d="M7.5 17.5v-7M5 17.5v-5M2.5 17.5v-3"/></svg>'],
    [/(snapchat\.com)/i, '<svg viewBox="0 0 24 24" class="stroke"><path d="M12 3.5c-2.9 0-4.6 2.1-4.6 4.6v2.3l-1.6.3c-.4.1-.4.6 0 .8l1.3.6c-.5 1.7-1.8 3.2-3.6 3.8.6.9 1.9 1 2.6 1.1.2.5.3 1 .6 1.3.9-.2 1.8-.2 2.6.2.8.4 1.6 1 2.7 1s1.9-.6 2.7-1c.8-.4 1.7-.4 2.6-.2.3-.3.4-.8.6-1.3.7-.1 2-.2 2.6-1.1-1.8-.6-3.1-2.1-3.6-3.8l1.3-.6c.4-.2.4-.7 0-.8l-1.6-.3V8.1c0-2.5-1.7-4.6-4.6-4.6z"/></svg>'],
    [/(facebook\.com|fb\.com)/i, '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" class="fill"/><path class="cut" d="M13.4 21v-6.9h2.3l.35-2.7h-2.65V9.7c0-.8.25-1.3 1.35-1.3h1.4V6c-.25 0-1.05-.1-2-.1-2 0-3.35 1.2-3.35 3.45v2.05H8.5v2.7h2.3V21z"/></svg>'],
  ];
  const LINK_ICON = '<svg viewBox="0 0 24 24" class="stroke"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>';
  function renderExtraSocials(s) {
    const nav = $('.footer__social');
    if (!nav) return;
    $$('[data-extra-social]', nav).forEach((a) => a.remove());
    let list = [];
    try { list = JSON.parse(s.extra_socials || '[]'); } catch { list = []; }
    list.forEach((m) => {
      const url = safeUrl(m && m.url);
      if (!/^https?:\/\//i.test(url)) return;
      const icon = (SOCIAL_ICONS.find(([re]) => re.test(url)) || [])[1] || LINK_ICON;
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.dataset.extraSocial = '';
      a.setAttribute('aria-label', m.name || new URL(url).hostname.replace(/^www\./, ''));
      a.title = m.name || '';
      a.innerHTML = icon;
      nav.append(a);
    });
  }

  // Título de la pestaña en la portada: el "Título para Google" del panel, o "Nombre — Eslogan"
  function homeTitle() {
    const s = state.settings || {};
    return (s.seo_title || '').trim() || `${s.site_name || 'DayOff Studios'} — ${s.slogan || 'Film Production Company'}`;
  }

  function applySettings() {
    const s = state.settings;
    document.title = homeTitle();

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
      const v = String(s[key] || '').trim();
      const href = v ? (prefix ? `${prefix}:${v}` : safeUrl(v)) : '';
      // Sin enlace en el panel → el ícono se quita del todo (un <a> sin destino lo marca Google como "no rastreable")
      if (!href) { el.remove(); return; }
      // Asunto ya escrito en el correo (data-subject en el HTML; {site} = nombre del sitio)
      const subject = el.dataset.subject && el.dataset.subject.replace('{site}', s.site_name || 'DayOff Studios');
      el.href = prefix === 'mailto' && subject ? `${href}?subject=${encodeURIComponent(subject)}` : href;
    });
    // Otras redes (panel → Textos del sitio → "Otras redes"): se agregan al pie con su ícono
    renderExtraSocials(s);
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
    videos = videos.map(safeUrl).filter(Boolean);
    // YouTube/Vimeo de fondo (sin sonido, en bucle). No se pueden encadenar con fundidos: para un showreel usa MP4.
    const isEmb = (u) => /(youtube\.com|youtu\.be|vimeo\.com)\//i.test(u || '');
    // Panel → Textos del sitio → "Fondo de la portada": showreel de clips o un video de YouTube/Vimeo
    const embedUrl = safeUrl(s.hero_embed_url);
    const heroEmbed = s.hero_mode === 'embed' ? (isEmb(embedUrl) ? embedUrl : '')
      : s.hero_mode === 'reel' ? '' : (isEmb(videos[0]) ? videos[0] : '');   // sin elegir: compatibilidad con la versión anterior
    if (heroEmbed) {
      heroReel.start([], image, 7);              // imagen de respaldo mientras carga (y si el navegador no deja reproducir)
      const media = $('.hero__media');
      media.classList.add('has-embed');
      const box = document.createElement('div');
      box.className = 'hero__embed';
      media.append(box);
      backgroundTrailer(box, heroEmbed, { revealDelay: 2200 });
    } else {
      heroReel.start(videos.filter((u) => !/(youtube\.com|youtu\.be|vimeo\.com)\//i.test(u)), image, parseFloat(s.hero_clip_seconds) || 7);
    }

    // Imagen de "Estudio"
    const aboutImg = safeUrl(s.about_image_url) || safeUrl(state.projects[1]?.backdrop_url) || image;
    $('.about__photo img').src = opt(aboutImg);

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
    $('.spotlight__img', sec).src = opt(bg);
    const poster = safeUrl(p.poster_url);
    const fig = $('.spotlight__poster', sec);
    fig.hidden = !poster;
    if (poster) { $('img', fig).src = opt(poster, 420); $('img', fig).alt = `${p.title} poster`; }
    // Descripción antes de la animación (editable en el panel; si está vacía no se muestra)
    const st = state.settings || {};
    const intro = $('.spotlight__intro', sec), introText = String(st.latest_intro || '').trim();
    intro.hidden = !introText;
    $('.spotlight__intro-kicker', sec).textContent = String(st.latest_intro_kicker ?? 'Latest release').trim();
    $('.spotlight__intro-text', sec).innerHTML = introText.split(/\n\s*\n/).map((t) => esc(t).replace(/\n/g, '<br>')).join('<br><br>');
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
    // El campo "Director/a" de la ficha manda; si está vacío, se usa el crédito de dirección
    const director = p.director || cr.find((c) => /^direct/i.test(c.role) && c.department === 'equipo')?.name;
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
  function backgroundTrailer(box, url, { revealDelay = 400 } = {}) {
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

    // Se muestra solo cuando lleva un momento reproduciendo: así no se ven los íconos que YouTube enseña
    // al arrancar (play, pausa, "siguiente"). Si se detiene, carga o vuelve a empezar el bucle, se oculta otra vez.
    let showT = null;
    const show = () => { if (f.classList.contains('is-ready') || showT) return; showT = setTimeout(() => { showT = null; f.classList.add('is-ready'); }, revealDelay); };
    const hide = () => { clearTimeout(showT); showT = null; f.classList.remove('is-ready'); };
    const onMsg = (e) => {
      if (e.source !== f.contentWindow) return;
      let d = e.data;
      try { if (typeof d === 'string') d = JSON.parse(d); } catch { return; }
      if (!d || typeof d !== 'object') return;
      // YouTube: playerState 1 = reproduciendo · Vimeo: evento "play"
      const ytState = d.info && typeof d.info === 'object' ? d.info.playerState : undefined;
      if (ytState === 1 || d.event === 'play' || d.event === 'playProgress') show();
      else if (ytState === 0 || ytState === 2 || ytState === 3 || ytState === -1 || d.event === 'pause' || d.event === 'ended') hide();
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
        send({ method: 'addEventListener', value: 'pause' });
        send({ method: 'addEventListener', value: 'ended' });
      }
    }, { once: true });
    box.append(f);
  }

  function renderFeatured() {
    // Solo los proyectos marcados como "Destacado" en el panel; si no hay ninguno, la sección se oculta (como News)
    const list = state.projects.filter((p) => +p.featured);
    $('#featured').hidden = !list.length;
    const cat = (id) => state.categories.find((c) => c.id === id)?.name || '';
    $('.featured__track').innerHTML = list.map((p, i) => `
      <a class="feat" href="/project/${esc(p.slug)}" data-slug="${esc(p.slug)}">
        <img src="${esc(opt(safeUrl(p.backdrop_url) || safeUrl(p.poster_url), Math.min(innerWidth * .62, 1100)))}" alt="${esc(p.title)}" loading="lazy" decoding="async">
        <div class="feat__info">
          <div>
            <span class="mono" style="color:var(--accent)">${esc(cat(p.category_id))} · ${esc(p.year || '')}</span>
            <h3 class="feat__title">${esc(p.title)}</h3>
            ${p.tagline ? `<p class="feat__tag">${esc(p.tagline)}</p>` : ''}
          </div>
          <span class="feat__idx">${String(i + 1).padStart(2, '0')}</span>
        </div>
      </a>`).join('');
  }

  /* ───────────────────────── Render: On set (galería de videos del estudio) ───────────────────────── */
  /**
   * Videos de rodaje y detrás de cámaras del panel → "Galería de videos".
   * Muro de videos centrado sobre fondo negro, en filas de distintos formatos
   * (ancha · dos desiguales · dos iguales · panorámica · panorámica) que se repiten.
   * Todos se reproducen a la vez, sin sonido y en bucle, y cada cuadro lleva el logo arriba a la izquierda.
   * Encima, el "rollo" de cámara: una escala de exposición que se desliza al hacer scroll.
   * - Archivo .mp4/.webm: se carga al acercarse y se pausa solo cuando sale de la pantalla (ahorra batería).
   * - Link de YouTube/Vimeo: se reproduce de fondo sin sonido (o muestra la portada si el navegador no deja).
   * Al hacer clic, el video se abre en grande con sonido.
   * Cada fila tiene un formato fijo, así la altura no cambia mientras cargan los videos
   * y las escenas fijadas de más abajo no se descuadran.
   */
  const ONSET_LIMIT = 9;
  // Filas que se repiten: cuántos videos lleva cada una, su formato (ancho/alto de la fila) y el ancho de cada cuadro
  const ONSET_ROWS = [
    { n: 1, ar: 2.05 },
    { n: 2, ar: 1.62, w: [42.5, 57.5] },
    { n: 2, ar: 2.72 },
    { n: 1, ar: 2.4 },
    { n: 1, ar: 2.4 }
  ];
  const isVideoFile = (u) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u) || /\/video\/upload\//.test(u);
  const isEmbed = (u) => /(youtube\.com|youtu\.be|vimeo\.com)\//i.test(u);
  let onsetAll = false, onsetIO = null;
  const onsetItems = () => (state.photos || []).map((m) => ({ ...m, url: safeUrl(m.url), poster: safeUrl(m.poster_url) })).filter((m) => m.url);
  const brandMark = () => (state.settings?.logo_url
    ? `<img src="${esc(safeUrl(state.settings.logo_url))}" alt="">` : (window.DAYOFF_LOGO_SVG || ''));

  /* ───────────────────────── "Rollo" de cámara (escala de exposición tipo visor) ─────────────────────────
     Se usa en "Featured Work" y debajo de cada franja de categoría en "Work".
     Los textos de los lados se editan en el panel → Textos del sitio (vacío = se oculta). */
  const METER_HTML = `<span class="meter__side meter__side--l"><span class="meter__txt"></span>&nbsp; |</span>
    <div class="meter__scale"><i class="meter__mark"></i><div class="meter__track"></div><div class="meter__ticks"></div></div>
    <span class="meter__side meter__side--r">|&nbsp; <span class="meter__txt"></span></span>`;
  function fillMeter(el) {
    if (!el) return;
    const st = state.settings || {};
    [['meter_left', '1\\400  ISO 400', '.meter__side--l'], ['meter_right', 'AWB  FPS 24  f1.8', '.meter__side--r']].forEach(([k, def, sel]) => {
      const v = String(st[k] ?? def).trim(), side = $(sel, el);
      $('.meter__txt', side).textContent = v;
      side.style.visibility = v ? '' : 'hidden';
    });
    // Escala 16…1 … 1…16, repetida 3 veces para que nunca se acabe al deslizarse
    const track = $('.meter__track', el);
    if (!track.childElementCount) {
      const nums = [...Array(16)].map((_, k) => 16 - k).concat(['', ...Array.from({ length: 16 }, (_, k) => k + 1)]);
      const run = nums.map((n) => (n === '' ? '<b>…</b>' : `<span>${n}</span><b>…</b>`)).join('');
      track.innerHTML = `<div>${run}</div><div>${run}</div><div>${run}</div>`;
      $('.meter__ticks', el).innerHTML = '<span></span>'.repeat(17);
    }
  }
  /** La escala se desliza con el scroll; a mitad del recorrido la marca queda entre el "1" y el "1". */
  function slideMeter(el, trigger) {
    const track = $('.meter__track', el), scale = $('.meter__scale', el);
    if (!track || !track.firstElementChild) return;
    const copyW = () => track.firstElementChild.offsetWidth;
    const centerX = () => scale.offsetWidth / 2 - copyW() * 1.5;
    gsap.fromTo(track, { x: () => centerX() + copyW() * .22 }, { x: () => centerX() - copyW() * .22, ease: 'none',
      scrollTrigger: { trigger, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true } });
  }

  /* ───────────────────────── Work: franjas de categorías ─────────────────────────
     Una franja de ancho completo por categoría (las que tienen proyectos): imagen o video de fondo
     (Categorías → "Imagen o video de la franja"; si está vacío, la imagen panorámica de su primer proyecto),
     título grande y el rollo de cámara debajo. Al hacer scroll la imagen se mueve más lento (parallax),
     hace un ligero zoom, y en escritorio cada franja se queda quieta mientras la siguiente sube encima.
     Clic → se abren los proyectos de esa categoría. */
  const countLabel = (c) => {
    const n = +c.is_gallery ? (c.photos || []).length : (c.items || state.projects.filter((p) => p.category_id === c.id)).length;
    return `${String(n).padStart(2, '0')} ${+c.is_gallery ? (n === 1 ? 'photo' : 'photos') : (n === 1 ? 'project' : 'projects')}`;
  };
  function renderCats() {
    const sec = $('#work'), wrap = $('.cats', sec);
    // Categorías normales: las que tienen proyectos. Galerías (Photography…): las que tienen fotos.
    const cats = state.categories.map((c) => ({ ...c, items: state.projects.filter((p) => p.category_id === c.id), photos: (c.photos || []).filter((f) => safeUrl(f.url)) }))
      .filter((c) => (+c.is_gallery ? c.photos.length : c.items.length));
    sec.hidden = !cats.length;
    $$('.nav a[href="#work"]').forEach((a) => { a.hidden = !cats.length; });
    if (!cats.length) return;
    const bg = (c) => {
      const cover = safeUrl(c.cover_url);
      const p = c.items.find((x) => safeUrl(x.backdrop_url)) || c.items[0];
      const img = +c.is_gallery ? safeUrl(c.photos[0]?.url) : (p ? safeUrl(p.backdrop_url) || safeUrl(p.poster_url) : '');
      if (cover && isVideoFile(cover)) {
        return `<video muted loop playsinline preload="none" data-src="${esc(responsiveVideo(cover, { max1080: true }))}"${img ? ` poster="${esc(opt(img))}"` : ''} aria-hidden="true"></video>`;
      }
      const src = cover || img;
      return src ? `<img src="${esc(opt(src))}" alt="" loading="lazy" decoding="async" draggable="false">` : '';
    };
    wrap.innerHTML = cats.map((c, i) => `
      <div class="cat-block" style="z-index:${i + 1}">
        <a class="cat-band" href="#work" data-cat="${esc(c.slug)}" aria-label="${esc(c.name)} — ${esc(countLabel(c))}">
          <span class="cat-band__media" aria-hidden="true">${bg(c)}</span>
          <span class="cat-band__shade" aria-hidden="true"></span>
          <span class="cat-band__body">
            <span class="cat-band__title">${esc(c.name)}</span>
            <span class="cat-band__more mono">${esc(countLabel(c))} <i>→</i></span>
          </span>
        </a>
        <div class="meter meter--tall" aria-hidden="true">${METER_HTML}</div>
      </div>`).join('');
    $$('.meter', wrap).forEach(fillMeter);
    // Videos de las franjas: se descargan solo al acercarse y se reproducen solo mientras se ven
    const catVids = $$('.cat-band video', wrap);
    if (catVids.length && !REDUCED && !navigator.connection?.saveData) {
      const io = new IntersectionObserver((entries) => entries.forEach((en) => {
        const v = en.target;
        if (en.isIntersecting) { if (!v.getAttribute('src')) v.src = v.dataset.src; if (!state.catOpen) v.play().catch(() => {}); }
        else v.pause();
      }), { rootMargin: '250px 0px' });
      catVids.forEach((v) => io.observe(v));
    }

    if (!wrap.dataset.bound) {
      wrap.dataset.bound = '1';
      wrap.addEventListener('click', (e) => {
        const a = e.target.closest('.cat-band');
        if (!a) return;
        e.preventDefault();
        openCategory(a.dataset.cat, a);
      });
    }
  }

  /** Animaciones de las franjas (se llaman desde scrollAnimations).
   *  Transición con zoom entre categorías: la franja que entra viene muy acercada y se abre hasta su tamaño
   *  mientras sube; la que se queda fija debajo se aleja (zoom out), se redondea y se oscurece hasta quedar tapada. */
  function catsAnimations() {
    const blocks = $$('#work .cat-block');
    if (!blocks.length) return;
    blocks.forEach((b) => {
      const media = $('.cat-band__media', b), body = $('.cat-band__body', b);
      // Entrada: la imagen llega con zoom (1.45 → 1.05) y un poco de parallax mientras la franja sube hasta arriba
      gsap.fromTo(media, { scale: 1.45, yPercent: -8 }, { scale: 1.05, yPercent: 6, ease: 'none',
        scrollTrigger: { trigger: b, start: 'top bottom', end: 'top top', scrub: true } });
      // El título se acerca desde grande…
      gsap.fromTo(body, { scale: 1.35, yPercent: 40 }, { scale: 1, yPercent: 0, ease: 'power1.out',
        scrollTrigger: { trigger: b, start: 'top bottom', end: 'top 25%', scrub: true } });
      // …y pasa de gris desenfocado a blanco nítido, como cuando la cámara hace foco
      gsap.fromTo($('.cat-band__title', b), { color: 'rgba(255,255,255,.28)', filter: 'blur(10px)' }, { color: 'rgba(255,255,255,1)', filter: 'blur(0px)', ease: 'power1.in',
        scrollTrigger: { trigger: b, start: 'top 55%', end: 'top 2%', scrub: true } });
      slideMeter($('.meter', b), b);
    });
    // Escritorio: cada franja se queda quieta y la siguiente sube encima; mientras tanto la de abajo se aleja
    ST.matchMedia({
      '(min-width: 861px)': () => {
        blocks.slice(0, -1).forEach((b) => {
          const band = $('.cat-band', b);
          const st = { trigger: b, start: 'top top', end: () => '+=' + b.offsetHeight, scrub: true, invalidateOnRefresh: true };
          ST.create({ trigger: b, start: 'top top', end: () => '+=' + b.offsetHeight, pin: true, pinSpacing: false, invalidateOnRefresh: true });
          gsap.fromTo(band, { scale: 1, borderRadius: 0 }, { scale: .82, borderRadius: 18, ease: 'power1.in', scrollTrigger: st });
          gsap.fromTo($('.cat-band__media', b), { scale: 1.05 }, { scale: 1.25, ease: 'none', immediateRender: false, scrollTrigger: st });
          gsap.fromTo($('.cat-band__shade', b), { opacity: 0 }, { opacity: .8, ease: 'none', scrollTrigger: st });
        });
      },
      // Celular: sin fijar; la franja se aleja un poco al salir por arriba
      '(max-width: 860px)': () => {
        blocks.forEach((b) => {
          gsap.fromTo($('.cat-band', b), { scale: 1 }, { scale: .9, ease: 'none',
            scrollTrigger: { trigger: b, start: 'bottom 60%', end: 'bottom top', scrub: true } });
        });
      }
    });
  }

  /* ───────────────────────── Página de una categoría ─────────────────────────
     Clic en una franja → la franja se agranda hasta ocupar toda la pantalla (zoom) y debajo aparecen
     sus proyectos: una franja de ancho completo por proyecto con su video de fondo (el primer video de
     su galería o su tráiler; si no tiene, su imagen panorámica), el título abajo a la izquierda y una
     línea "Watch …". Efecto persiana: cada video queda fijo detrás de la pantalla y su franja funciona
     como una ventana; al bajar, la franja siguiente sube y "tapa" a la anterior. Clic en un proyecto → su ficha. */
  const catview = $('.catview');
  if (catview) document.body.append(catview);   // fuera de <main>, para que ninguna transformación la afecte
  const cvScroll = catview && $('.catview__scroll', catview);
  let cvTweens = [], cvIO = null;
  function catMedia(url, poster) {
    if (url && isVideoFile(url)) {
      return `<video muted loop playsinline preload="none" data-src="${esc(responsiveVideo(url, { max1080: true }))}"${poster ? ` poster="${esc(poster)}"` : ''}></video>`;
    }
    return `${poster ? `<img src="${esc(opt(poster))}" alt="" decoding="async" draggable="false">` : ''}${url && isEmbed(url) ? `<span class="pband__embed" data-embed="${esc(url)}"></span>` : ''}`;
  }
  function openCategory(slug, fromEl) {
    const i = state.categories.findIndex((c) => c.slug === slug);
    const cat = state.categories[i];
    if (!cat) return;
    const items = state.projects.filter((p) => p.category_id === cat.id);
    const isGallery = +cat.is_gallery;
    const photos = (cat.photos || []).map((f) => ({ type: 'image', url: safeUrl(f.url), caption: f.caption })).filter((f) => f.url);
    const site = state.settings.site_name || 'DayOff Studios';
    // Portada: la misma imagen/video de la franja
    const bandMedia = fromEl && $('.cat-band__media', fromEl);
    $('.catview__media', catview).innerHTML = bandMedia ? bandMedia.innerHTML : '';
    $$('.catview__media video', catview).forEach((v) => { if (!v.getAttribute('src') && v.dataset.src) v.src = v.dataset.src; if (!REDUCED) v.play().catch(() => {}); });
    $('.catview__title', catview).textContent = cat.name;
    $('.catview__count', catview).textContent = countLabel(cat);
    catview.classList.toggle('is-gallery', !!isGallery);
    state.catPhotos = photos;
    // Galería (Photography…): un mosaico con todas las fotos; clic → visor con zoom
    if (isGallery) {
      $('.catview__list', catview).innerHTML = `<div class="photowall">${photos.map((f, k) => `
        <figure class="photowall__item" data-photo="${k}">
          <img src="${esc(opt(f.url, innerWidth <= 700 ? innerWidth / 2 : innerWidth / 3))}" alt="${esc(f.caption || cat.name)}" loading="lazy" decoding="async" draggable="false">
          ${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ''}
        </figure>`).join('')}</div>`;
    } else $('.catview__list', catview).innerHTML = items.map((p, k) => {
      const poster = safeUrl(p.backdrop_url) || safeUrl(p.poster_url);
      const vid = safeUrl(p.preview_video) || safeUrl(p.trailer_url);
      const line = p.trailer_url ? `Watch “${p.title}” trailer, a film produced by ${site}` : (p.tagline || `A film produced by ${site}`);
      return `<a class="pband" href="/project/${esc(p.slug)}" data-slug="${esc(p.slug)}" style="z-index:${k + 1}">
          <span class="pband__media" aria-hidden="true">${catMedia(vid, poster)}</span>
          <span class="pband__shade" aria-hidden="true"></span>
          <span class="pband__body">
            <span class="pband__logo" aria-hidden="true">${brandMark()}</span>
            ${safeUrl(p.title_logo_url)
              ? `<span class="pband__title pband__title--img"><img src="${esc(opt(p.title_logo_url, 960))}" alt="${esc(p.title)}" decoding="async" draggable="false"></span>`
              : `<span class="pband__title">${esc(p.title)}</span>`}
            <span class="pband__line">${esc(line)}</span>
          </span>
          ${p.year ? `<span class="pband__year mono">${esc(p.year)}</span>` : ''}
        </a>`;
    }).join('');
    // Al final: la siguiente categoría (con proyectos)
    const others = state.categories.filter((c) => c.id !== cat.id && (+c.is_gallery ? (c.photos || []).length : state.projects.some((p) => p.category_id === c.id)));
    const nextCat = others.find((c) => state.categories.indexOf(c) > i) || others[0];
    const nx = $('.catview__next', catview);
    nx.hidden = !nextCat;
    if (nextCat) { nx.dataset.cat = nextCat.slug; nx.innerHTML = `<span class="mono">Next</span><b>${esc(nextCat.name)}</b><i>→</i>`; }

    const first = catview.hidden;
    catview.hidden = false;
    state.catOpen = true;
    document.body.classList.add('is-locked');
    cvScroll.scrollTop = 0;
    $$('.cat-band video').forEach((v) => v.pause());
    // Zoom: el recorte arranca en la posición de la franja pulsada y se abre a pantalla completa
    if (ANIM && first) {
      const r = fromEl ? fromEl.getBoundingClientRect() : { top: innerHeight / 2, bottom: innerHeight / 2, left: 0, right: innerWidth };
      const from = `inset(${Math.max(0, r.top)}px ${Math.max(0, innerWidth - r.right)}px ${Math.max(0, innerHeight - r.bottom)}px ${Math.max(0, r.left)}px)`;
      gsap.fromTo(catview, { clipPath: from }, { clipPath: 'inset(0px 0px 0px 0px)', duration: 1.1, ease: 'expo.inOut', clearProps: 'clipPath' });
      gsap.fromTo('.catview__media', { scale: 1.05 }, { scale: 1.25, duration: 1.6, ease: 'power3.out' });
      gsap.fromTo('.catview__heading', { scale: .8, opacity: .4 }, { scale: 1, opacity: 1, duration: 1.2, ease: 'power3.out', delay: .2 });
      gsap.fromTo('.catview__title', { color: 'rgba(255,255,255,.28)', filter: 'blur(10px)' }, { color: 'rgba(255,255,255,1)', filter: 'blur(0px)', duration: 1.4, ease: 'power2.out', delay: .5, clearProps: 'filter' });
      gsap.from('.catview__close', { opacity: 0, rotate: -90, duration: .6, delay: .7 });
    }
    catviewMotion();
    $('.catview__close', catview).focus({ preventScroll: true });
  }

  /** Movimiento dentro de la página de categoría: parallax/zoom de cada proyecto y videos solo a la vista. */
  function catviewMotion() {
    cvTweens.forEach((t) => { t.scrollTrigger && t.scrollTrigger.kill(); t.kill(); });
    cvTweens = [];
    if (cvIO) cvIO.disconnect();
    const bands = $$('.pband', catview);
    if (ANIM && ST) {
      $$('.photowall__item', catview).forEach((f) => {
        cvTweens.push(gsap.fromTo(f, { clipPath: 'inset(100% 0 0 0)', y: 40 }, { clipPath: 'inset(0% 0 0 0)', y: 0, duration: 1.1, ease: 'power4.out', clearProps: 'clipPath',
          scrollTrigger: { scroller: cvScroll, trigger: f, start: 'top 95%', once: true } }));
      });
      cvTweens.push(gsap.to('.catview__heading', { yPercent: 60, opacity: 0, ease: 'none',
        scrollTrigger: { scroller: cvScroll, trigger: '.catview__hero', start: 'top top', end: 'bottom top', scrub: true } }));
      bands.forEach((b) => {
        const st = { scroller: cvScroll, trigger: b, start: 'top bottom', end: 'bottom top', scrub: true };
        // El video está fijo detrás (efecto persiana): solo hace un leve zoom mientras su franja sube
        cvTweens.push(gsap.fromTo($('.pband__media', b), { scale: 1.18 }, { scale: 1, ease: 'none',
          scrollTrigger: { ...st, end: 'top top' } }));
        cvTweens.push(gsap.fromTo($('.pband__body', b), { y: 80, opacity: 0 }, { y: 0, opacity: 1, ease: 'power2.out',
          scrollTrigger: { scroller: cvScroll, trigger: b, start: 'top 85%', end: 'top 35%', scrub: true } }));
        cvTweens.push(gsap.fromTo($('.pband__title', b), { color: 'rgba(255,255,255,.28)', filter: 'blur(8px)' }, { color: 'rgba(255,255,255,1)', filter: 'blur(0px)', ease: 'power2.out',
          scrollTrigger: { scroller: cvScroll, trigger: b, start: 'top 70%', end: 'top 15%', scrub: true } }));
      });
      ST.refresh();
    }
    const auto = !REDUCED && !navigator.connection?.saveData;
    cvIO = new IntersectionObserver((entries) => entries.forEach((en) => {
      const band = en.target, v = $('video', band), emb = $('.pband__embed', band);
      if (v) {
        if (en.isIntersecting) {
          if (!v.getAttribute('src')) { v.src = v.dataset.src; v.addEventListener('loadeddata', () => band.classList.add('is-loaded'), { once: true }); }
          if (auto) v.play().catch(() => {});
        } else v.pause();
      }
      if (emb && en.isIntersecting && auto && !emb.childElementCount) backgroundTrailer(emb, emb.dataset.embed);
    }), { root: cvScroll, rootMargin: '200px 0px', threshold: .15 });
    bands.forEach((b) => cvIO.observe(b));
  }

  function closeCategory() {
    if (!state.catOpen) return;
    const done = () => {
      catview.hidden = true;
      cvTweens.forEach((t) => { t.scrollTrigger && t.scrollTrigger.kill(); t.kill(); }); cvTweens = [];
      if (cvIO) { cvIO.disconnect(); cvIO = null; }
      $('.catview__list', catview).innerHTML = '';
      $('.catview__media', catview).innerHTML = '';
      $$('.cat-band video').forEach((v) => { if (!REDUCED && v.getAttribute('src')) v.play().catch(() => {}); });
    };
    state.catOpen = false;
    if (!state.detailOpen) document.body.classList.remove('is-locked');
    if (ANIM) gsap.to(catview, { clipPath: 'inset(0% 0% 100% 0%)', duration: .7, ease: 'power3.inOut', onComplete: () => { done(); gsap.set(catview, { clearProps: 'clipPath' }); } });
    else done();
  }
  if (catview) {
    $('.catview__list', catview).addEventListener('click', (e) => {
      const f = e.target.closest('[data-photo]');
      if (!f) return;
      gallery = state.catPhotos || [];
      openLightbox(+f.dataset.photo, $('img', f));
    });
    $('.catview__close', catview).addEventListener('click', closeCategory);
    $('.catview__down', catview).addEventListener('click', () => cvScroll.scrollTo({ top: innerHeight * .9, behavior: 'smooth' }));
    // "Next: …" → cambia de categoría sin cerrar (la portada sube con un fundido)
    $('.catview__next', catview).addEventListener('click', (e) => {
      e.preventDefault();
      const slug = e.currentTarget.dataset.cat;
      const band = $(`.cat-band[data-cat="${CSS.escape(slug)}"]`);
      if (ANIM) gsap.to(cvScroll, { opacity: 0, duration: .35, onComplete: () => { openCategory(slug, band); gsap.fromTo(cvScroll, { opacity: 0 }, { opacity: 1, duration: .6 }); } });
      else openCategory(slug, band);
    });
  }

  function renderOnset() {
    const sec = $('#onset');
    if (!sec) return;
    const items = onsetItems();
    sec.hidden = !items.length;
    // Textos editables en el panel → Textos del sitio → "Galería de videos (Featured Work)".
    // Si un texto se deja vacío, esa parte se oculta.
    const st = state.settings || {};
    const txt = (k, def) => String(st[k] ?? def).trim();
    const title = txt('onset_title', 'Featured Work');
    $('.onset__title', sec).textContent = title;
    $('.onset__band', sec).hidden = !title;
    $$('.nav__onset').forEach((a) => { a.hidden = !items.length; a.textContent = txt('onset_nav', title || 'Featured Work'); });
    fillMeter($('.meter', sec));
    if (!items.length) return;

    const media = (m) => {
      if (isVideoFile(m.url)) {
        // #t=0.1 → Safari muestra el primer cuadro aunque aún no se reproduzca
        return `<video muted loop playsinline preload="none" data-src="${esc(responsiveVideo(m.url, { max1080: true }))}#t=0.1"${m.poster ? ` poster="${esc(m.poster)}"` : ''} aria-hidden="true"></video>`;
      }
      if (isEmbed(m.url)) {
        const yt = ytId(m.url);
        const img = m.poster || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '');
        return `${img ? `<img src="${esc(opt(img, 900))}" alt="" loading="lazy" decoding="async" draggable="false">` : ''}<span class="shot__preview" aria-hidden="true"></span>`;
      }
      return `<img src="${esc(opt(m.url, 1000))}" alt="${esc(m.caption || '')}" loading="lazy" decoding="async" draggable="false">`;   // fotos
    };
    const tile = (m, i, width) => `<button type="button" class="shot${isEmbed(m.url) ? ' shot--embed' : ''}" data-i="${i}"${width ? ` style="flex-grow:${width}"` : ''} aria-label="${esc((isVideoFile(m.url) || isEmbed(m.url) ? 'Play: ' : 'View: ') + (m.caption || 'Featured work ' + (i + 1)))}">
        ${media(m)}
        <span class="shot__logo" aria-hidden="true">${brandMark()}</span>
        ${m.caption ? `<span class="shot__cap">${esc(m.caption)}</span>` : ''}
      </button>`;

    // Reparte los videos en filas siguiendo el patrón; si al final sobra uno, va en una fila ancha
    let html = '', i = 0, r = 0;
    while (i < items.length) {
      let row = ONSET_ROWS[r % ONSET_ROWS.length];
      if (row.n > items.length - i) row = { n: 1, ar: 2.05 };
      const hide = !onsetAll && i >= ONSET_LIMIT;
      html += `<div class="onset__row" style="--ar:${row.ar}"${hide ? ' hidden' : ''}>${items.slice(i, i + row.n).map((m, k) => tile(m, i + k, row.w && row.w[k])).join('')}</div>`;
      i += row.n; r++;
    }
    $('.onset__wall', sec).innerHTML = html;

    const more = $('.onset__more', sec);
    more.hidden = onsetAll || items.length <= ONSET_LIMIT;
    $('span', more).textContent = `Show all (${items.length})`;
    onsetPlayback();

    if (!sec.dataset.bound) {
      sec.dataset.bound = '1';
      // Clic → visor a pantalla completa con sonido y controles (flechas para pasar al siguiente)
      sec.addEventListener('click', (e) => {
        const shot = e.target.closest('.shot');
        if (!shot) return;
        gallery = onsetItems().map((m) => ({ type: isEmbed(m.url) ? 'embed' : isVideoFile(m.url) ? 'video' : 'image', url: m.url, caption: m.caption }));
        $$('video', sec).forEach((v) => v.pause());
        openLightbox(+shot.dataset.i, $('img, video', shot));
      });
      more.addEventListener('click', () => {
        onsetAll = true;
        const extra = $$('.onset__row[hidden]', sec);
        extra.forEach((el) => { el.hidden = false; });
        more.hidden = true;
        onsetPlayback();
        if (ANIM) gsap.fromTo(extra, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: .8, stagger: .08, ease: 'power3.out' });
        ST && ST.refresh();
      });
    }
  }

  /** Animaciones de "On set": el rollo se desliza con el scroll y cada fila entra al aparecer. */
  function onsetAnimations() {
    const sec = $('#onset');
    if (!ANIM || !ST || !sec || sec.hidden) return;
    slideMeter($('.meter', sec), '#onset');
    gsap.from('.onset__title', { yPercent: 100, opacity: 0, duration: 1, ease: 'power4.out', scrollTrigger: { trigger: '.onset__band', start: 'top 85%' } });
    gsap.from('.onset__chev', { y: -10, opacity: 0, duration: .8, delay: .3, scrollTrigger: { trigger: '.onset__band', start: 'top 85%' } });
    gsap.from('.meter', { opacity: 0, duration: 1.2, scrollTrigger: { trigger: '.meter', start: 'top 90%' } });
    $$('.onset__row:not([hidden]) .shot', sec).forEach((el) => {
      gsap.fromTo(el, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 1.2, ease: 'power4.inOut', clearProps: 'clipPath',
        scrollTrigger: { trigger: el, start: 'top 92%', once: true } });
    });
  }

  /** Videos propios de "On set": se cargan al acercarse y solo se reproducen mientras se ven. */
  function onsetPlayback() {
    if (onsetIO) onsetIO.disconnect();
    const vids = $$('#onset .onset__row:not([hidden]) video, #onset .onset__row:not([hidden]) .shot--embed');
    if (!vids.length) return;
    const auto = !REDUCED && !navigator.connection?.saveData;
    onsetIO = new IntersectionObserver((entries) => entries.forEach((en) => {
      const v = en.target;
      // YouTube/Vimeo: al aparecer arranca de fondo sin sonido (si el navegador no deja, queda la portada)
      if (v.classList.contains('shot--embed')) {
        if (en.isIntersecting && auto && !v.dataset.started) {
          v.dataset.started = '1';
          backgroundTrailer($('.shot__preview', v), onsetItems()[+v.dataset.i]?.url);
          v.classList.add('is-previewing');
        }
        return;
      }
      if (en.isIntersecting) {
        if (!v.getAttribute('src')) {
          v.src = v.dataset.src;
          v.preload = auto ? 'auto' : 'metadata';
          v.addEventListener('loadeddata', () => v.closest('.shot')?.classList.add('is-loaded'), { once: true });
          v.addEventListener('error', () => v.closest('.shot')?.classList.add('is-error'), { once: true });
        }
        if (auto && en.intersectionRatio > .25 && lb.hidden) v.play().catch(() => {});
        else if (en.intersectionRatio <= .25) v.pause();
      } else v.pause();
    }), { rootMargin: '300px 0px', threshold: [0, .25, .6] });
    vids.forEach((v) => onsetIO.observe(v));
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
      <a class="card" href="/project/${esc(p.slug)}" data-slug="${esc(p.slug)}">
        <div class="card__frame">
          <img src="${esc(opt(p.poster_url, 420))}" alt="${esc(p.title)} poster" loading="lazy" decoding="async" draggable="false">
          ${p.year ? `<span class="card__year mono">${esc(p.year)}</span>` : ''}
          <span class="card__play">${PLAY_ICON}</span>
        </div>
        <div class="card__meta">
          <h3 class="card__title">${esc(p.title)}</h3>
          <span class="card__cat mono">${esc(catName(p.category_id))}</span>
        </div>
      </a>`).join('') : '<p class="grid__empty">New work in this category coming soon.</p>';

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
  /**
   * Celular / tablet (sin cursor): la obra que pasa por el centro de la pantalla al hacer scroll se "activa"
   * sola (pasa a color, barrido de luz, ícono de play) y, si tiene un video propio en su galería, lo reproduce
   * sin sonido. Al salir del centro vuelve a blanco y negro. Los tráileres de YouTube/Vimeo no se cargan aquí
   * (pesan mucho para datos móviles).
   */
  let touchIO = null;
  function cardTouchActivation() {
    if (touchIO) { touchIO.disconnect(); touchIO = null; }
    if (HOVER.matches) return;
    const cards = $$('.grid .card');
    if (!cards.length) return;
    const isFile = (u) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u) || /\/video\/upload\//.test(u);
    const on = (card) => {
      card.classList.add('is-active');
      if (REDUCED || navigator.connection?.saveData) return;
      const p = state.projects.find((x) => x.slug === card.dataset.slug);
      const src = p && [safeUrl(p.preview_video), safeUrl(p.trailer_url)].find((u) => u && isFile(u));
      if (!src) return;
      let box = $('.card__preview', card);
      if (!box) {
        box = document.createElement('div');
        box.className = 'card__preview';
        box.setAttribute('aria-hidden', 'true');
        const frame = $('.card__frame', card);
        frame.insertBefore(box, $('.card__year', frame) || null);
        backgroundTrailer(box, responsiveVideo(src, { max1080: true }));
      }
      box.classList.add('is-on');
      $('video', box)?.play().catch(() => {});
    };
    const off = (card) => {
      card.classList.remove('is-active');
      const box = $('.card__preview', card);
      if (box) { box.classList.remove('is-on'); $('video', box)?.pause(); }
    };
    // Franja central de la pantalla (35 %–65 % de alto): la obra que la cruza es la activa
    touchIO = new IntersectionObserver((entries) => entries.forEach((en) => (en.isIntersecting ? on : off)(en.target)),
      { rootMargin: '-35% 0px -35% 0px', threshold: 0 });
    cards.forEach((c) => touchIO.observe(c));
  }

  function cardPreviews() {
    cardTouchActivation();
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
    if (!ANIM || !ST) { $('.about')?.classList.add('is-static'); return; }   // sin animaciones: foto completa con el texto encima

    // Hero: parallax del fondo y fundido del contenido al bajar
    gsap.to('.hero__media', { yPercent: 18, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.fromTo('.hero__content', { yPercent: 0, opacity: 1 }, { yPercent: -25, opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.hero', start: 'center center', end: 'bottom top', scrub: true } });

    // Títulos de sección: reveal por palabras
    $$('[data-reveal]').forEach((el) => {
      gsap.from(splitWords(el), { yPercent: 110, duration: 1.1, stagger: .06, ease: 'power4.out', scrollTrigger: { trigger: el, start: 'top 85%' } });
    });
    $$('.section-head__num').forEach((el) => gsap.from(el, { opacity: 0, x: -20, duration: .8, scrollTrigger: { trigger: el, start: 'top 85%' } }));

    // Lista de categorías: líneas que se dibujan + entrada escalonada
    // On set (galería del estudio)
    onsetAnimations();
    // Work: franjas de categorías
    catsAnimations();

    // ESTUDIO — la foto a través de las letras.
    // Escritorio: la escena se fija; al bajar, la foto sube dentro de las letras, las letras crecen hasta
    // abrir la máscara a pantalla completa y entran el texto y las cifras sobre la foto.
    // Móvil: misma idea sin fijar (la máscara se abre mientras pasa la escena) y el texto va debajo.
    const countUp = (els) => els.forEach((el) => {
      if (el.dataset.counted) return;
      el.dataset.counted = '1';
      const target = parseFloat(el.dataset.target ?? el.textContent) || 0;
      el.dataset.target = target;
      const obj = { v: 0 };
      gsap.to(obj, { v: target, duration: 2, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(obj.v); } });
    });
    $$('.about [data-count]').forEach((el) => { el.dataset.target = parseFloat(el.textContent) || 0; });
    // Las letras entran desde abajo cuando la escena aparece
    gsap.from('.about__mask-text', { yPercent: 40, opacity: 0, duration: 1.4, ease: 'power4.out', scrollTrigger: { trigger: '.about__stage', start: 'top 75%' } });
    ST.matchMedia({
      '(min-width: 861px)': () => {
        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: '.about__stage', start: 'top top', end: '+=170%', pin: true, scrub: 1, anticipatePin: 1 }
        });
        tl.fromTo('.about__photo img', { yPercent: 0, scale: 1.08 }, { yPercent: -22, scale: 1, duration: 1 }, 0)        // la foto "sube"
          .to('.about__mask-text', { scale: 5.5, letterSpacing: '.02em', duration: .5, ease: 'power2.in' }, .18)         // las letras crecen…
          .to('.about__mask', { opacity: 0, duration: .26, ease: 'power1.in' }, .4)                                   // …y la máscara se abre
          .to('.about__shade', { opacity: 1, duration: .25 }, .58)
          .fromTo('.about__content', { opacity: 0, y: 70 }, { opacity: 1, y: 0, duration: .22, ease: 'power3.out' }, .66)
          .from('.about__text p, .about .stats > div', { opacity: 0, y: 30, duration: .18, stagger: .04, ease: 'power2.out' }, .72)
          .call(() => countUp($$('.about [data-count]')), null, .78)
          .to({}, { duration: .12 });                                                                                  // pausa final para leer
      },
      '(max-width: 860px)': () => {
        const st = { trigger: '.about__stage', start: 'top 30%', end: 'top -45%', scrub: true };
        gsap.fromTo('.about__photo img', { yPercent: 0 }, { yPercent: -18, ease: 'none', scrollTrigger: { trigger: '.about__stage', start: 'top bottom', end: 'bottom top', scrub: true } });
        gsap.to('.about__mask-text', { scale: 4, ease: 'power2.in', scrollTrigger: st });
        gsap.to('.about__mask', { opacity: 0, ease: 'power1.in', scrollTrigger: { ...st, start: 'top 5%' } });
        gsap.from('.about__text p, .about .stats > div', { opacity: 0, y: 30, duration: 1, stagger: .12, ease: 'power3.out',
          scrollTrigger: { trigger: '.about__content', start: 'top 85%', onEnter: () => countUp($$('.about [data-count]')) } });
      }
    });

    // ESTRENO — escena principal.
    // Escritorio: la sección se fija; al hacer scroll aparece "DayOff Studios presents", el cuadro del
    // tráiler se expande desde el centro a pantalla completa y entran título, ficha, póster y créditos.
    // Móvil: entrada sencilla sin fijar (fijar en móvil se siente brusco).
    // Descripción del estreno: las palabras suben y pasan de gris a blanco; se desvanece cuando arranca la escena
    if (state.spotlight && !$('.spotlight__intro').hidden) {
      const words = splitWords($('.spotlight__intro-text'));
      gsap.from('.spotlight__intro-kicker', { opacity: 0, y: 20, duration: .9, ease: 'power3.out', scrollTrigger: { trigger: '.spotlight__intro', start: 'top 80%' } });
      gsap.fromTo(words, { opacity: .18, yPercent: 40 }, { opacity: 1, yPercent: 0, stagger: .04, ease: 'none',
        scrollTrigger: { trigger: '.spotlight__intro', start: 'top 80%', end: 'center 45%', scrub: true } });
      gsap.to('.spotlight__intro > *', { opacity: 0, y: -40, ease: 'none',
        scrollTrigger: { trigger: '.spotlight__intro', start: 'bottom 45%', end: 'bottom top', scrub: true } });
    }
    if (state.spotlight) {
      ST.matchMedia({
        '(min-width: 861px)': () => {
          const words = splitWords($('.spotlight__title'));
          const tl = gsap.timeline({
            defaults: { ease: 'none' },
            scrollTrigger: { trigger: '.spotlight__stage', start: 'top top', end: '+=150%', pin: '.spotlight__stage', scrub: 1, anticipatePin: 1 }
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
      // Visor: las esquinas encuadran, la imagen hace "rack focus" (borrosa → nítida) y entra la claqueta, se abre y ¡clac!
      gsap.from('.vf-c', { scale: 1.6, opacity: 0, duration: 1.1, ease: 'power3.out', delay: .9, scrollTrigger: st });
      gsap.from('.vf-rec, .vf-tc, .vf-meta, .vf-cross', { opacity: 0, duration: .6, stagger: .08, delay: 1.3, scrollTrigger: st });
      gsap.fromTo('.founder__portrait img', { filter: 'grayscale(1) contrast(1.08) brightness(.92) blur(10px)' },
        { filter: 'grayscale(1) contrast(1.08) brightness(.92) blur(0px)', duration: 1.4, ease: 'power2.out', delay: .9, scrollTrigger: st, clearProps: 'filter' });
      const clap = () => {
        const t = gsap.timeline();
        t.to('.slate__stick--top', { rotate: -32, duration: .35, ease: 'power2.out' })
          .to('.slate__stick--top', { rotate: 0, duration: .11, ease: 'power4.in' }, '+=.18')
          .fromTo('.founder__slate', { x: 0 }, { x: 3, duration: .04, repeat: 5, yoyo: true, ease: 'none', clearProps: 'x' })
          .fromTo('.founder__flash', { opacity: .55 }, { opacity: 0, duration: .5, ease: 'power2.out' }, '<');
        return t;
      };
      gsap.timeline({ scrollTrigger: st, delay: 1 })
        .from('.founder__slate', { y: 90, rotate: 14, opacity: 0, duration: .9, ease: 'back.out(1.4)' })
        .add(clap(), '+=.1');
      // Al pasar el cursor por la foto: otra toma
      let clapping = null;
      $('.founder__portrait').addEventListener('mouseenter', () => { if (!clapping || !clapping.isActive()) clapping = clap(); });
      gsap.from('.founder__name .w > span', { yPercent: 110, duration: 1.2, stagger: .12, ease: 'power4.out', delay: .3, scrollTrigger: st });
      gsap.from('.founder__kicker i', { scaleX: 0, transformOrigin: 'left', duration: 1, ease: 'power3.out', scrollTrigger: st });
      gsap.from('.founder__kicker span, .founder__quote, .founder__teaser, .founder__link', { opacity: 0, y: 26, duration: 1, stagger: .1, ease: 'power3.out', delay: .55, scrollTrigger: st });
      gsap.to('.founder__portrait', { yPercent: -6, ease: 'none', scrollTrigger: { trigger: '.founder', start: 'top bottom', end: 'bottom top', scrub: true } });
    }

    // News: los laureles "brotan", la nota destacada se revela y las filas suben una a una
    if ($('#news') && !$('#news').hidden) {
      const st = { trigger: '.news__laurels', start: 'top 82%' };
      gsap.from('.laurel', { opacity: 0, y: 40, duration: 1, stagger: .12, ease: 'power3.out', scrollTrigger: st });
      gsap.from('.laurel__branch', { scale: .3, opacity: 0, rotate: (i) => (i % 2 ? 28 : -28), svgOrigin: (i) => (i % 2 ? '168 190' : '122 190'), duration: 1.3, stagger: .06, ease: 'back.out(1.6)', scrollTrigger: st });
      if (!$('.news__lead').hidden) {
        gsap.fromTo('.news__lead-media', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.4, ease: 'power4.inOut', scrollTrigger: { trigger: '.news__lead', start: 'top 78%' } });
        gsap.from('.news__lead-body > *', { opacity: 0, y: 30, duration: .9, stagger: .1, ease: 'power3.out', delay: .4, scrollTrigger: { trigger: '.news__lead', start: 'top 78%' } });
      }
      gsap.from('.news__list li:not([hidden])', { opacity: 0, y: 30, duration: .8, stagger: .07, ease: 'power3.out', scrollTrigger: { trigger: '.news__list', start: 'top 85%' } });
    }

    // Contacto y footer
    gsap.from(splitWords($('.contact__title')), { yPercent: 110, duration: 1.2, stagger: .06, ease: 'power4.out', scrollTrigger: { trigger: '.contact', start: 'top 70%' } });
    gsap.from('.footer__brand, .footer__social', { y: 24, opacity: 0, duration: 1, stagger: .1, ease: 'power3.out', scrollTrigger: { trigger: '.footer', start: 'top 95%' } });

    // Destacados: scroll horizontal fijado (solo en pantallas grandes; nada si la sección está oculta)
    if (!$('#featured').hidden) ST.matchMedia({
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
  /* ── Menú de correo (solo en computador) ──
     Un link mailto: abre la app de correo predeterminada del PC (a menudo Outlook/Correo de Windows),
     aunque la persona use Gmail en el navegador. En computador, al hacer clic se muestra un menú:
     Gmail · Outlook · App de correo · Copiar email. En celular se abre la app directo (comportamiento normal). */
  function mailMenu() {
    // Celular/tablet → app de correo directo. Computador (aunque tenga pantalla táctil) → menú.
    const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && !matchMedia('(any-pointer: fine)').matches);
    const desktop = { get matches() { return !isMobile(); } };
    let menu = null, opener = null;
    const close = () => {
      if (!menu) return;
      menu.remove(); menu = null;
      removeEventListener('keydown', onKey); removeEventListener('scroll', close, true); removeEventListener('resize', close);
      if (opener) { opener.setAttribute('aria-expanded', 'false'); opener = null; }
    };
    const onKey = (e) => { if (e.key === 'Escape') { const o = opener; close(); o && o.focus(); } };
    document.addEventListener('click', (e) => {
      if (menu && !menu.contains(e.target)) close();
      const a = e.target.closest('a[href^="mailto:"]');
      if (!a || !desktop.matches || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      const href = a.getAttribute('href');
      const [addr, qs] = href.slice(7).split('?');
      const to = decodeURIComponent(addr || '');
      if (!to) return;
      const subject = new URLSearchParams(qs || '').get('subject') || '';
      const enc = encodeURIComponent;
      const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}${subject ? `&su=${enc(subject)}` : ''}`;
      const outlook = `https://outlook.live.com/mail/0/deeplink/compose?to=${enc(to)}${subject ? `&subject=${enc(subject)}` : ''}`;
      const ico = {
        gmail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5v11h4v-7l5 3.8 5-3.8v7h4v-11l-9 6.8z"/></svg>',
        outlook: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
        app: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/></svg>',
        copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>'
      };
      close();
      opener = a; a.setAttribute('aria-expanded', 'true');
      menu = document.createElement('div');
      menu.className = 'mailmenu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = `
        <p class="mailmenu__to mono">${esc(to)}</p>
        <a role="menuitem" href="${esc(gmail)}" target="_blank" rel="noopener">${ico.gmail}<span>Gmail</span></a>
        <a role="menuitem" href="${esc(outlook)}" target="_blank" rel="noopener">${ico.outlook}<span>Outlook</span></a>
        <a role="menuitem" href="${esc(href)}" data-mail-app>${ico.app}<span>Mail app</span></a>
        <button type="button" role="menuitem" data-mail-copy>${ico.copy}<span>Copy email</span></button>`;
      document.body.appendChild(menu);
      // Posición: debajo del link (o encima si no cabe), sin salirse de la pantalla
      const r = a.getBoundingClientRect(), m = menu.getBoundingClientRect(), pad = 12;
      let top = r.bottom + 10;
      if (top + m.height > innerHeight - pad) top = Math.max(pad, r.top - m.height - 10);
      let left = Math.min(Math.max(pad, e.clientX - m.width / 2), innerWidth - m.width - pad);
      menu.style.top = `${top}px`; menu.style.left = `${left}px`;
      menu.querySelector('a').focus({ preventScroll: true });
      menu.addEventListener('click', async (ev) => {
        const item = ev.target.closest('[role=menuitem]');
        if (!item) return;
        ev.stopPropagation();
        if (item.hasAttribute('data-mail-app')) { ev.preventDefault(); close(); location.href = href; return; }
        if (item.hasAttribute('data-mail-copy')) {
          try { await navigator.clipboard.writeText(to); } catch {
            const t = document.createElement('textarea'); t.value = to; document.body.appendChild(t); t.select();
            try { document.execCommand('copy'); } catch { /* sin portapapeles */ } t.remove();
          }
          item.querySelector('span').textContent = 'Copied!';
          setTimeout(close, 900);
          return;
        }
        setTimeout(close, 50);   // Gmail / Outlook abren en una pestaña nueva
      });
      menu.addEventListener('keydown', (ev) => {
        if (!['ArrowDown', 'ArrowUp'].includes(ev.key)) return;
        ev.preventDefault();
        const items = [...menu.querySelectorAll('[role=menuitem]')];
        const i = items.indexOf(document.activeElement);
        items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      });
      addEventListener('keydown', onKey); addEventListener('scroll', close, true); addEventListener('resize', close);
    }, true);
  }

  try { mailMenu(); } catch (e) { console.error(e); }   // se activa de inmediato, sin esperar a que cargue el contenido

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

    // Enlaces internos (#work, #studio, #contact…): desplazamiento suave hecho en JS.
    // (No se usa "scroll-behavior: smooth" en CSS porque descuadra las escenas fijadas de ScrollTrigger.)
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = e.target.closest('a[href^="#"]');
      const id = a && a.getAttribute('href').slice(1);
      if (!id || id === 'latest') return;                 // #latest tiene su propio manejo (final de la escena)
      const target = document.getElementById(id);
      if (!target || target.hidden) return;
      e.preventDefault();
      const top = id === 'home' ? 0 : target.getBoundingClientRect().top + scrollY;
      window.scrollTo({ top, behavior: REDUCED ? 'auto' : 'smooth' });
    });

    // Timecode del hero (24 fps)
    const tc = $('.timecode');
    const t0 = performance.now();
    const pad = (n) => String(n).padStart(2, '0');
    (function tick() {
      const f = Math.floor((performance.now() - t0) / (1000 / 24));
      tc.textContent = `${pad(Math.floor(f / 86400) % 24)}:${pad(Math.floor(f / 1440) % 60)}:${pad(Math.floor(f / 24) % 60)}:${pad(f % 24)}`;
      requestAnimationFrame(tick);
    })();

    // Abrir fichas (delegación de eventos para tarjetas y destacados).
    // Las tarjetas son enlaces reales (<a href="/project/…">): accesibles, indexables por Google y se pueden
    // abrir en otra pestaña con Ctrl/Cmd+clic o clic central; el clic normal abre la ficha con la transición.
    document.addEventListener('click', (e) => {
      const card = e.target.closest('[data-slug]');
      if (!card || e.target.closest('.detail')) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      openProject(card.dataset.slug);
    });
    document.addEventListener('keydown', (e) => {
      // Los <a> ya abren con Enter (generan un clic); esto cubre cualquier otro elemento con data-slug
      if (e.key === 'Enter' && e.target.matches('[data-slug]:not(a)')) openProject(e.target.dataset.slug);
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
    state.detailGallery = gallery;
    // Póster e imagen principal: al hacer clic se abren en el visor con zoom (y con flechas se sigue a la galería)
    state.detailCover = [safeUrl(p.poster_url), safeUrl(p.backdrop_url)].filter((u, k, arr) => u && arr.indexOf(u) === k)
      .map((url) => ({ type: 'image', url, caption: p.title }));
    // Los videos se cargan y reproducen solos al aparecer en pantalla (ver autoplayGallery)
    const galleryHtml = gallery.map((m, i) => `
      <figure data-index="${i}"${m.type === 'video' ? ' class="is-video"' : ''}>
        ${m.type === 'video'
          ? `<video data-src="${esc(responsiveVideo(m.url, { max1080: true }))}" muted loop playsinline preload="none" disablepictureinpicture aria-label="${esc(m.caption || p.title)}"></video>
             <span class="vid-badge mono" aria-hidden="true"><i></i>Playing</span>`
          : `<img src="${esc(opt(m.url, 900))}" alt="${esc(m.caption || p.title)}" loading="lazy" decoding="async">`}
      </figure>`).join('');

    // Siguiente proyecto (para navegar sin volver a la galería)
    const idx = state.projects.findIndex((x) => x.slug === p.slug);
    const next = state.projects[(idx + 1) % state.projects.length];
    const trailerHtml = trailerEmbed(p.trailer_url);
    const backdrop = safeUrl(p.backdrop_url) || safeUrl(p.poster_url);

    detailScroll.innerHTML = `
      <section class="d-hero">
        <div class="d-hero__bg"><img src="${esc(opt(backdrop))}" data-full="${esc(backdrop)}" alt="" fetchpriority="high"></div>
        <div class="d-hero__content">
          <div class="d-poster"><img src="${esc(opt(p.poster_url, 300))}" data-full="${esc(safeUrl(p.poster_url))}" alt="${esc(p.title)} poster"></div>
          <div>
            <p class="d-kicker mono">${esc(p.category_name || '')}${p.year ? ' · ' + esc(p.year) : ''}</p>
            ${safeUrl(p.title_logo_url)
              ? `<h2 class="d-title d-title--img" id="detail-title"><img src="${esc(opt(p.title_logo_url, 1280))}" alt="${esc(p.title)}"></h2>`
              : `<h2 class="d-title" id="detail-title">${esc(p.title)}</h2>`}
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
          <img src="${esc(opt(backdrop, 1280))}" alt="" loading="lazy" decoding="async"><span class="d-trailer__btn">${PLAY_ICON}</span></div></div></section>` : ''}

      ${credits ? `<section class="d-block d-anim"><div class="d-block__head"><span class="mono" style="color:var(--accent)">02</span><h3>Credits</h3></div>
        <div class="d-credits">${credits}</div></section>` : ''}

      ${galleryHtml ? `<section class="d-block d-anim"><div class="d-block__head"><span class="mono" style="color:var(--accent)">03</span><h3>Gallery</h3></div>
        <div class="d-gallery">${galleryHtml}</div></section>` : ''}

      ${next && next.slug !== p.slug ? `<a class="d-next" data-next="${esc(next.slug)}">
        <div class="d-next__bg"><img src="${esc(opt(safeUrl(next.backdrop_url) || safeUrl(next.poster_url)))}" alt="" loading="lazy" decoding="async"></div>
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
      .from(words.length ? words : '.d-title--img img', words.length
        ? { yPercent: 110, duration: 1.1, stagger: .05, ease: 'power4.out' }
        : { opacity: 0, y: 30, filter: 'blur(10px)', duration: 1.2, ease: 'power3.out' }, .3)
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
    if (!data) {
      // Proyecto inexistente o despublicado: se vuelve a la portada con una URL limpia
      if (!push && /^\/(?:project|proyecto)\//.test(location.pathname)) history.replaceState({}, '', '/');
      await curtain.out(); return;
    }

    ST && ST.getAll().filter((t) => t.scroller === detailScroll).forEach((t) => t.kill());
    renderDetail(data);
    detail.hidden = false;
    detailScroll.scrollTop = 0;
    document.body.classList.add('is-locked');
    state.detailOpen = true;
    document.title = `${data.title} — ${state.settings.site_name || 'DayOff Studios'}`;
    // Siempre con el slug ACTUAL: si se llegó por un enlace viejo (el título cambió), la barra de direcciones se corrige
    if (push) history.pushState({ slug: data.slug }, '', `/project/${data.slug}`);
    else if (location.pathname !== `/project/${data.slug}`) history.replaceState({ slug: data.slug }, '', `/project/${data.slug}`);
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
    if (!state.catOpen) document.body.classList.remove('is-locked');
    state.detailOpen = false;
    document.title = homeTitle();
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
    if (fig) { gallery = state.detailGallery || gallery; openLightbox(+fig.dataset.index, $('img, video', fig)); return; }
    // Póster o imagen principal de la ficha → visor con zoom desde donde está la imagen
    const poster = e.target.closest('.d-poster');
    const heroBg = !poster && e.target.closest('.d-hero') && !e.target.closest('.d-hero__content, a, button') ? $('.d-hero__bg img', detail) : null;
    if (poster || heroBg) {
      const src = poster ? $('img', poster).dataset.full : heroBg.dataset.full;
      const covers = state.detailCover || [];
      gallery = [...covers, ...(state.detailGallery || [])];
      openLightbox(Math.max(0, covers.findIndex((c) => c.url === src)), poster ? $('img', poster) : heroBg);
    }
  });
  addEventListener('popstate', () => {
    const m = location.pathname.match(/^\/(?:project|proyecto)\/([^/]+)/);
    if (m) openProject(decodeURIComponent(m[1]), { push: false });
    else if (/^\/director\//.test(location.pathname)) openFounder({ push: false });
    else closeProject({ push: false });
  });

  /* ───────────────────────── News: prensa, premios, festivales, videos ─────────────────────────
     · Premios y festivales → laureles como en los pósters de cine.
     · La noticia "destacada" (que no sea premio) → bloque grande con imagen o video.
     · El resto → lista editorial (fecha · medio · titular). Los videos se ven en el sitio (lightbox);
       las notas abren el enlace en otra pestaña. Todo se administra en el panel → News. */
  const ytId = (u) => (String(u || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/) || [])[1];
  const newsThumb = (n) => safeUrl(n.image_url) || (ytId(n.video_url) ? `https://img.youtube.com/vi/${ytId(n.video_url)}/hqdefault.jpg` : '');
  const newsDate = (d) => {
    if (!d) return '';
    const [y, m, day] = String(d).split('-').map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, day || 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };
  let laurelCache = '';
  /** Rama de laurel dibujada con hojas a lo largo de una curva (izquierda + su reflejo a la derecha). */
  function laurelSVG() {
    if (laurelCache) return laurelCache;
    const P0 = { x: 122, y: 190 }, C = { x: 18, y: 150 }, P2 = { x: 60, y: 18 };
    const q = (t) => ({ x: (1 - t) ** 2 * P0.x + 2 * (1 - t) * t * C.x + t * t * P2.x, y: (1 - t) ** 2 * P0.y + 2 * (1 - t) * t * C.y + t * t * P2.y });
    const dv = (t) => ({ x: 2 * (1 - t) * (C.x - P0.x) + 2 * t * (P2.x - C.x), y: 2 * (1 - t) * (C.y - P0.y) + 2 * t * (P2.y - C.y) });
    const f = (n) => n.toFixed(1);
    let leaves = '';
    for (let i = 0; i < 10; i++) {
      const t = .07 + i * .095, p = q(t), v = dv(t), len = Math.hypot(v.x, v.y), ux = v.x / len, uy = v.y / len;
      const L = 24 - i * 1.15, W = 6.8 - i * .3;
      for (const side of [1, -1]) {
        const a = side * .78, dx = ux * Math.cos(a) - uy * Math.sin(a), dy = ux * Math.sin(a) + uy * Math.cos(a);
        const tip = { x: p.x + dx * L, y: p.y + dy * L }, m = { x: p.x + dx * L / 2, y: p.y + dy * L / 2 };
        leaves += `M${f(p.x)},${f(p.y)}Q${f(m.x - dy * W)},${f(m.y + dx * W)} ${f(tip.x)},${f(tip.y)}Q${f(m.x + dy * W)},${f(m.y - dx * W)} ${f(p.x)},${f(p.y)}Z`;
      }
    }
    // hoja final en la punta
    leaves += `M${P2.x},${P2.y}Q${P2.x - 9},${P2.y - 12} ${P2.x + 2},${P2.y - 24}Q${P2.x + 8},${P2.y - 10} ${P2.x},${P2.y}Z`;
    const branch = `<path class="laurel__stem" d="M${P0.x},${P0.y}Q${C.x},${C.y} ${P2.x},${P2.y}" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="${leaves}"/>`;
    laurelCache = `<svg viewBox="0 0 290 200" aria-hidden="true"><g class="laurel__branch"><g>${branch}</g></g><g class="laurel__branch"><g transform="translate(290 0) scale(-1 1)">${branch}</g></g></svg>`;
    return laurelCache;
  }

  function renderNews() {
    const sec = $('#news');
    const all = (state.news || []).filter((n) => n && n.title);
    if (!sec) return;
    sec.hidden = !all.length;
    $$('.nav__news').forEach((a) => { a.hidden = !all.length; });
    if (!all.length) return;

    // 1) Laureles: premios y festivales
    const laurels = all.filter((n) => n.kind === 'award' || n.kind === 'festival');
    $('.news__laurels', sec).innerHTML = laurels.map((n) => {
      const tag = n.url ? 'a' : 'div';
      const attrs = n.url ? ` href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener"` : '';
      const year = (n.published_at || '').slice(0, 4);
      // "Distinción - Película" → la distinción va arriba en dorado (ej. "Semi Finalist - Mythomania").
      // Vale guion normal, guion largo o barra, con espacios a los lados (así "Spider-Man" no se parte).
      // Sin separador: "Winner" (premio) u "Official Selection" (festival).
      const parts = String(n.title || '').split(/\s+[-—–|]\s+/);
      const label = parts.length > 1 ? parts.shift() : (n.kind === 'award' ? 'Winner' : 'Official Selection');
      const title = parts.join(' — ');
      return `<${tag} class="laurel" role="listitem"${attrs}>${laurelSVG()}
        <span class="laurel__txt">
          <span class="laurel__kind">${esc(label)}</span>
          <span class="laurel__title">${esc(title)}</span>
          <span class="laurel__by">${esc([n.outlet, year].filter(Boolean).join(' · '))}</span>
        </span></${tag}>`;
    }).join('');

    // 2) Destacada (prensa o video marcado como "Destacada")
    const rest = all.filter((n) => !laurels.includes(n));
    const lead = rest.find((n) => +n.featured);
    const leadBox = $('.news__lead', sec);
    leadBox.hidden = !lead;
    if (lead) {
      const img = newsThumb(lead), video = safeUrl(lead.video_url), link = safeUrl(lead.url);
      leadBox.innerHTML = `
        ${video ? `<button type="button" class="news__lead-media" data-news-video="${esc(video)}" aria-label="Watch: ${esc(lead.title)}">`
                : `<a class="news__lead-media" ${link ? `href="${esc(link)}" target="_blank" rel="noopener"` : ''} aria-label="${esc(lead.title)}">`}
          ${img ? `<img src="${esc(opt(img, 1000))}" alt="" loading="lazy" decoding="async">` : ''}
          ${video ? `<span class="news__play">${PLAY_ICON}</span>` : ''}
        ${video ? '</button>' : '</a>'}
        <div class="news__lead-body">
          <p class="news__lead-meta mono">${esc(lead.outlet || (lead.kind === 'video' ? 'Video' : 'Press'))}<span>${esc(newsDate(lead.published_at))}</span></p>
          <h3>${esc(lead.title)}</h3>
          ${lead.excerpt ? `<blockquote>${esc(lead.excerpt)}</blockquote>` : ''}
          ${video ? `<button type="button" class="news__go" data-news-video="${esc(video)}">Watch <i>▶</i></button>`
                  : link ? `<a class="news__go" href="${esc(link)}" target="_blank" rel="noopener">Read the article <i>↗</i></a>` : ''}
        </div>`;
    }

    // 3) Lista: el resto, con "Show more" a partir de 8
    const items = rest.filter((n) => n !== lead);
    const row = (n, i) => {
      const video = safeUrl(n.video_url), link = safeUrl(n.url), img = newsThumb(n);
      const inner = `${img ? `<img class="news-row__thumb" src="${esc(opt(img, 240))}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="news-row__date">${esc(newsDate(n.published_at))}</span>
        <span class="news-row__outlet">${esc(n.outlet || '')}</span>
        <span class="news-row__title">${esc(n.title)}</span>
        <span class="news-row__kind">${video ? 'Watch' : link ? 'Read' : n.project_slug ? 'Project' : ''}<i>${video ? '▶' : '↗'}</i></span>`;
      const common = `class="news-row" data-img="${esc(img)}"`;
      const el = video ? `<button type="button" ${common} data-news-video="${esc(video)}">${inner}</button>`
        : link ? `<a ${common} href="${esc(link)}" target="_blank" rel="noopener">${inner}</a>`
        : n.project_slug ? `<a ${common} href="/project/${esc(n.project_slug)}" data-slug="${esc(n.project_slug)}">${inner}</a>`
        : `<div ${common}>${inner}</div>`;
      return `<li${i >= 8 ? ' hidden' : ''}>${el}</li>`;
    };
    $('.news__list', sec).innerHTML = items.map(row).join('');
    const more = $('.news__more', sec);
    more.hidden = items.length <= 8;
    more.onclick = () => {
      $$('.news__list li[hidden]', sec).forEach((li) => { li.hidden = false; });
      more.hidden = true;
      if (ANIM) gsap.from($$('.news__list li', sec).slice(8), { opacity: 0, y: 24, duration: .7, stagger: .05, ease: 'power3.out' });
      ST && ST.refresh();
    };

    // Videos: se ven aquí mismo (lightbox con sonido y controles)
    if (!sec.dataset.bound) {
      sec.dataset.bound = '1';
      sec.addEventListener('click', (e) => {
        const b = e.target.closest('[data-news-video]');
        if (b) { e.preventDefault(); openTrailer(b.dataset.newsVideo); }
      });
      // Imagen que sigue al cursor sobre la lista (escritorio)
      const pv = $('.news__preview', sec), pimg = $('img', pv), list = $('.news__list', sec);
      if (ANIM && HOVER.matches) {
        const xTo = gsap.quickTo(pv, 'x', { duration: .5, ease: 'power3' }), yTo = gsap.quickTo(pv, 'y', { duration: .5, ease: 'power3' });
        let on = false;
        const hide = () => { if (on) { on = false; gsap.to(pv, { opacity: 0, scale: .85, duration: .25, overwrite: true }); } };
        list.addEventListener('mousemove', (e) => {
          const r = e.target.closest('.news-row');
          if (!on) gsap.set(pv, { x: e.clientX, y: e.clientY });
          xTo(e.clientX); yTo(e.clientY);
          if (r && r.dataset.img) {
            if (pimg.getAttribute('src') !== r.dataset.img) pimg.src = r.dataset.img;
            if (!on) { on = true; gsap.to(pv, { opacity: 1, scale: 1, rotate: gsap.utils.random(-4, 4), duration: .45, ease: 'power3.out', overwrite: true }); }
          } else hide();
        });
        list.addEventListener('mouseleave', hide);
        addEventListener('scroll', hide, { passive: true });
      }
    }
  }

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
    img.src = opt(safeUrl(s.founder_photo_url) || safeUrl(s.about_image_url) || '', 700);
    img.alt = s.founder_name;
    // Claqueta con sus datos (como la que se usa en el set) y fecha de hoy
    $('.slate-dir', box).textContent = s.founder_name;
    $('.slate-prod', box).textContent = s.site_name || 'DayOff Studios';
    const d = new Date(), two = (n) => String(n).padStart(2, '0');
    $('.slate-date', box).textContent = `${two(d.getMonth() + 1)}.${two(d.getDate())}.${String(d.getFullYear()).slice(2)}`;
    const first = s.founder_name.split(/\s+/)[0];
    $('.founder__link-label', box).textContent = 'Learn more about him';
    // El texto visible ("Learn more about him") es el nombre accesible del enlace; la foto es un atajo
    // decorativo (oculto a lectores de pantalla y al tabulador) que lleva al mismo sitio
    $$('[data-founder-link]').forEach((a) => { a.href = `/director/${founderSlug()}`; });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-founder-link]');
      if (!a || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      openFounder();
    });
    box.dataset.first = first;
    // Timecode del visor (24 fps) — solo corre mientras el bloque está en pantalla
    const tc = $('.vf-tc', box);
    if (tc && !REDUCED) {
      let on = false, t0 = performance.now();
      const pad = (n) => String(n).padStart(2, '0');
      const tick = (now) => {
        if (!on) return;
        const f = Math.floor((now - t0) / (1000 / 24));
        tc.textContent = `${pad(Math.floor(f / 86400) % 24)}:${pad(Math.floor(f / 1440) % 60)}:${pad(Math.floor(f / 24) % 60)}:${pad(f % 24)}`;
        requestAnimationFrame(tick);
      };
      new IntersectionObserver(([en]) => { const was = on; on = en.isIntersecting; if (on && !was) requestAnimationFrame(tick); }).observe(box);
    }
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
    const photo2 = safeUrl(f.photo2_url) || photo;   // foto de la biografía (distinta a la de portada si se sube una)
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
          <div class="f-hero__portrait"><img src="${esc(opt(photo, 800))}" alt="${esc(f.name)}"></div>
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
            <img src="${esc(opt(photo2, 800))}" alt="${esc(f.name)}" loading="lazy" decoding="async">
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
          <a href="mailto:${esc(s.contact_email)}?subject=${encodeURIComponent(`Hi ${first}, I'd love to work with you on my next project`)}">Work with ${esc(first)} <span>→</span></a>
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
    stage.innerHTML = (m.type === 'embed'
      ? `<div class="lightbox__trailer">${trailerEmbed(m.url) || ''}</div>`
      : m.type === 'video'
      ? `<video src="${esc(responsiveVideo(m.url))}" controls autoplay playsinline></video>`
      : `<img src="${esc(opt(m.url, Math.min(innerWidth, 1920)))}" alt="${esc(m.caption || '')}">`) + (m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : '');
    $('.lightbox__count', lb).textContent = `${String(lbIndex + 1).padStart(2, '0')} / ${String(gallery.length).padStart(2, '0')}`;
    if (ANIM) gsap.fromTo(stage.firstElementChild, { opacity: 0, x: dir * 60 }, { opacity: 1, x: 0, duration: .5, ease: 'power3.out' });
  }
  function openLightbox(i, fromEl) {
    lbIndex = i; lb.hidden = false; showLightbox();
    // Zoom: la imagen sale desde donde estaba (póster, portada o miniatura) hasta su tamaño en el visor
    const to = $('.lightbox__stage', lb).firstElementChild;
    if (!ANIM || !fromEl || !to) return;
    const run = () => {
      const a = fromEl.getBoundingClientRect(), b = to.getBoundingClientRect();
      if (!b.width || !a.width) return;
      gsap.killTweensOf(to);
      gsap.fromTo(to, { x: (a.left + a.width / 2) - (b.left + b.width / 2), y: (a.top + a.height / 2) - (b.top + b.height / 2), scale: Math.min(a.width / b.width, a.height / b.height), opacity: 1 },
        { x: 0, y: 0, scale: 1, duration: .75, ease: 'expo.out', clearProps: 'transform' });
      gsap.fromTo(lb, { backgroundColor: 'rgba(5,5,4,0)' }, { backgroundColor: 'rgba(5,5,4,.96)', duration: .5, clearProps: 'backgroundColor' });
    };
    if (to.tagName === 'IMG' && !to.complete) to.addEventListener('load', run, { once: true }); else run();
  }
  const closeLightbox = () => { lb.hidden = true; lb.classList.remove('is-trailer'); $('.lightbox__stage', lb).innerHTML = ''; onsetPlayback(); };
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
    else if (state.catOpen && e.key === 'Escape') closeCategory();
  });

  /* ───────────────────────── Arranque ───────────────────────── */
  (async function boot() {
    try {
      await loadSite();
      applySettings();
      renderSpotlight();
      renderFeatured();
      renderOnset();
      renderCats();
      renderFounder();
      renderNews();
      await Promise.race([
        Promise.all([
          heroReel.ready(), // primer video listo para reproducirse
          preloadImages([
            ...(heroReel.urls?.length ? [] : [opt(state.settings.hero_image_url)]) // imagen fija solo si no hay videos
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
    await preloader.finish((at) => { heroReel.begin(at + .6); heroIntro(at); });   // at+.6 ≈ fin del zoom del logo
    // ScrollTrigger también "recuerda" la posición anterior y la restaura: se le pide que no lo haga
    if (ST) ST.clearScrollMemory('manual');
    scrollTo(0, 0);
    scrollAnimations();
    // Recalcula posiciones cuando terminan de cargar imágenes/fuentes (evita saltos y zonas vacías)
    if (ST) {
      // Las escenas fijadas (estreno, destacados, estudio) se crean en distinto orden que en la página:
      // se ordenan por posición antes de recalcular, para que cada una sume el espacio de las anteriores
      ST.sort();
      ST.refresh();
      if (document.readyState !== 'complete') addEventListener('load', () => ST.refresh(), { once: true });
    }

    // Enlace directo a una ficha: /proyecto/mi-pelicula
    const m = location.pathname.match(/^\/(?:project|proyecto)\/([^/]+)/);
    if (m) openProject(decodeURIComponent(m[1]), { push: false });
    else if (/^\/director\//.test(location.pathname)) openFounder({ push: false });
  })();
})();