/**
 * Modo claro / oscuro — compartido por el sitio y el panel.
 *
 * - Se carga en el <head> SIN defer, para aplicar el tema antes de pintar la página
 *   (así no hay destello del tema equivocado al recargar).
 * - La elección se guarda en localStorage ("dayoff-theme"). Si no hay elección guardada,
 *   el sitio arranca en OSCURO (identidad cinematográfica de la marca).
 * - Botones: cualquier elemento con [data-theme-toggle].
 * - Transición: el nuevo tema se abre en círculo desde el botón (efecto "iris" de cámara)
 *   usando la View Transitions API; en navegadores sin soporte, el cambio es un fundido simple.
 */
(function () {
  'use strict';
  var KEY = 'dayoff-theme';
  var root = document.documentElement;

  function saved() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f1ea' : '#0a0908');
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(theme === 'light'));
      b.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    });
  }

  // 1) Aplicar YA (antes de que se pinte el body)
  apply(saved() === 'light' ? 'light' : 'dark');

  // 1b) Fuentes de Google sin bloquear el primer pintado: el <link rel="preload" data-fonts> ya las está
  //     descargando; aquí se convierten en hoja de estilos (insertada por script = no bloquea el render)
  var pre = document.querySelector('link[rel="preload"][data-fonts]');
  if (pre) {
    var css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = pre.href;
    document.head.appendChild(css);
  }

  // 2) Cambiar de tema con transición tipo "iris"
  function toggle(origin) {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch (e) { /* modo privado: no se guarda */ }

    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduced) {
      root.classList.add('theme-fade');
      apply(next);
      setTimeout(function () { root.classList.remove('theme-fade'); }, 500);
      return;
    }
    var r = origin ? origin.getBoundingClientRect() : { left: innerWidth - 40, top: 40, width: 0, height: 0 };
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    var t = document.startViewTransition(function () { apply(next); });
    t.ready.then(function () {
      root.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 750, easing: 'cubic-bezier(.77,0,.175,1)', pseudoElement: '::view-transition-new(root)' }
      );
    });
  }

  window.DayoffTheme = { toggle: toggle, get: function () { return root.getAttribute('data-theme'); } };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (b) { e.preventDefault(); toggle(b); }
  });
  document.addEventListener('DOMContentLoaded', function () { apply(root.getAttribute('data-theme')); });
})();