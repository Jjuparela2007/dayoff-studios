/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CLIPS DE DEMOSTRACIÓN PARA LA PORTADA (solo para pruebas en LOCAL)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Genera fragmentos de 3 segundos en 4K (3840×2160) para el showreel de la portada
 *  y los activa en la base de datos.
 *
 *  Fuentes:
 *   1. Películas abiertas de Blender Studio (licencia Creative Commons BY: uso libre
 *      dando crédito). Se leen por internet SIN descargar el archivo completo:
 *      FFmpeg salta directamente al segundo que necesita.
 *   2. Cualquier video que pongas en la carpeta  media-sources/  (en la raíz del proyecto),
 *      por ejemplo cortos o material de DayOff, o películas abiertas que descargues
 *      tú desde studio.blender.org. De cada uno se sacan 3 momentos.
 *
 *  Uso:
 *    npm run demo:clips                 → genera los clips y los pone en la portada
 *    npm run demo:clips -- --count 8    → número máximo de clips (por defecto 8)
 *    npm run demo:clips -- --local      → solo usa la carpeta media-sources/ (sin internet)
 *    npm run demo:clips -- --url <enlace directo a un .mp4/.webm>   → añade otra fuente por internet
 *
 *  Salida: public/media/showreel-01.mp4 … (4K) y showreel-01.1080.mp4 … (versión ligera
 *  que la portada usa automáticamente en móviles y pantallas pequeñas), más
 *  public/media/CREDITS.txt con los créditos de licencia.
 *
 *  ⚠ Los tráileres de películas comerciales tienen derechos de autor: no los uses
 *    aunque sean pocos segundos. En producción sube el material de la productora desde el panel.
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('../env');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { pool, query } = require('../db');

/* FFmpeg: el binario de npm (ffmpeg-static, se instala con npm install) o, si no está, el del sistema */
let FFMPEG = 'ffmpeg';
try { FFMPEG = require('ffmpeg-static') || 'ffmpeg'; } catch { /* usa el del sistema */ }

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'public', 'media');
const SRC_DIR = path.join(ROOT, 'media-sources');
const SECONDS = 3;            // duración de cada clip (máximo pedido: 3 s)
const W = 3840, H = 2160;     // 4K UHD

/* Películas abiertas con su licencia. "moments" = segundo donde empieza cada clip (planos con movimiento). */
const OPEN_MOVIES = [
  {
    title: 'Big Buck Bunny (4K re-render)',
    credit: 'Big Buck Bunny — © 2008 Blender Foundation | www.bigbuckbunny.org — CC BY 3.0',
    url: 'https://mirrors.mit.edu/kodi/demo-files/BBB/bbb_sunflower_2160p_30fps_normal.mp4',
    moments: [24, 75, 143, 262, 371, 455, 512, 548]
  }
];

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : def; };
const MAX = Math.max(1, Number(opt('--count', 8)) || 8);
const LOCAL_ONLY = args.includes('--local');

/** Ejecuta FFmpeg; si falla, devuelve un motivo corto y legible. */
const run = (cmd, a) => new Promise((resolve, reject) =>
  execFile(cmd, a, { maxBuffer: 1 << 26, timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
    if (!err) return resolve(stdout);
    const lines = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
    reject(new Error(lines.slice(-2).join(' | ') || (err.killed ? 'tiempo agotado' : `FFmpeg terminó con código ${err.code}`)));
  }));

/** Duración en segundos (lee la cabecera del archivo; por internet solo descarga unos KB). */
function duration(src) {
  return new Promise((resolve) => {
    execFile(FFMPEG, ['-hide_banner', '-i', src], { timeout: 60000 }, (err, stdout, stderr) => {
      const m = String(stderr).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0);
    });
  });
}

/** Corta SECONDS segundos desde "start", rellena 16:9 en 4K, sin audio, listo para web (+ versión 1080p). */
async function cut(src, start, outBase) {
  const out4k = `${outBase}.mp4`, out1080 = `${outBase}.1080.mp4`;
  const common = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', src, '-t', String(SECONDS), '-an', '-sn', '-dn'];
  await run(FFMPEG, [...common,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-profile:v', 'high', '-level', '5.1',
    '-movflags', '+faststart', out4k]);
  // Versión ligera a partir del clip 4K ya cortado (rápido)
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', out4k, '-an',
    '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-profile:v', 'high', '-movflags', '+faststart', out1080]);
  return out4k;
}

const sizeMB = (f) => (fs.statSync(f).size / 1048576).toFixed(1);

(async () => {
  console.log(`🎬 Generando clips de ${SECONDS}s en 4K (${W}×${H}) — máximo ${MAX}`);
  console.log(`   FFmpeg: ${FFMPEG}\n`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(SRC_DIR, { recursive: true });

  // 1) Lista de trabajos: [fuente, segundo de inicio, crédito]
  const jobs = [];
  const localFiles = fs.readdirSync(SRC_DIR).filter((f) => /\.(mp4|mov|mkv|webm|m4v)$/i.test(f));
  for (const f of localFiles) {
    const src = path.join(SRC_DIR, f);
    const d = await duration(src).catch(() => 0);
    if (d < SECONDS + 1) { console.log(`· ${f}: demasiado corto, se omite`); continue; }
    // 3 momentos repartidos (evita el inicio y los créditos finales)
    const picks = d < 20 ? [Math.max(0, d / 2 - SECONDS / 2)] : [0.2, 0.45, 0.7].map((r) => d * r);
    picks.forEach((t) => jobs.push({ src, start: +t.toFixed(2), label: f, credit: `${f} (material propio / media-sources)` }));
  }
  // Fuentes extra por enlace (--url, se puede repetir)
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--url' || !args[i + 1]) continue;
    const url = args[i + 1];
    const d = await duration(url).catch(() => 0);
    if (d < SECONDS + 1) { console.log(`· ${url}: no se pudo leer, se omite`); continue; }
    [0.2, 0.45, 0.7].forEach((r) => jobs.push({ src: url, start: +(d * r).toFixed(2), label: path.basename(new URL(url).pathname), credit: url, remote: true }));
  }
  if (!LOCAL_ONLY) {
    for (const m of OPEN_MOVIES) {
      process.stdout.write(`· Conectando con "${m.title}"… `);
      const d = await duration(m.url);
      if (!d) { console.log('✖ no disponible ahora (se omite)'); continue; }
      console.log(`✔ ${Math.round(d / 60)} min`);
      m.moments.filter((t) => t + SECONDS < d).forEach((t) => jobs.push({ src: m.url, start: t, label: m.title, credit: m.credit, remote: true }));
    }
  }
  if (!jobs.length) {
    console.log('No hay fuentes. Pon videos en la carpeta media-sources/ o quita --local.');
    return pool.end();
  }

  // Intercala fuentes para que el showreel no repita la misma película seguida
  const bySrc = {};
  jobs.forEach((j) => (bySrc[j.src] ||= []).push(j));
  const queues = Object.values(bySrc), ordered = [];
  while (ordered.length < jobs.length) queues.forEach((q) => q.length && ordered.push(q.shift()));

  // 2) Borra los clips anteriores generados por este script
  fs.readdirSync(OUT_DIR).filter((f) => /^showreel-\d+(\.1080)?\.mp4$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT_DIR, f)));

  // 3) Corta
  const made = [], credits = new Set(), deadSources = new Set();
  for (const j of ordered) {
    if (made.length >= MAX) break;
    if (deadSources.has(j.src)) continue;
    const n = String(made.length + 1).padStart(2, '0');
    process.stdout.write(`  ▸ showreel-${n}  ${j.label} @ ${j.start}s ${j.remote ? '(por internet)' : ''} … `);
    try {
      const file = await cut(j.src, j.start, path.join(OUT_DIR, `showreel-${n}`));
      made.push(`/media/showreel-${n}.mp4`);
      credits.add(j.credit);
      console.log(`✔ ${sizeMB(file)} MB`);
    } catch (e) {
      console.log(`✖ ${e.message}`);
      if (j.remote) {
        deadSources.add(j.src);
        console.log('    No se pudo leer por internet: se omite esta fuente. (Alternativa: descarga el video, ponlo en media-sources/ y usa --local)');
      }
    }
  }
  if (!made.length) { console.log('\nNo se pudo generar ningún clip.'); return pool.end(); }

  fs.writeFileSync(path.join(OUT_DIR, 'CREDITS.txt'),
    `Clips de demostración del showreel (generados con npm run demo:clips)\n\n${[...credits].join('\n')}\n`);

  // 4) Activa los clips en la portada (conserva primero los videos que hayas subido tú desde el panel)
  const [row] = await query("SELECT setting_value FROM settings WHERE setting_key = 'hero_videos'");
  let current = [];
  try { current = JSON.parse(row?.setting_value || '[]'); } catch { current = []; }
  const own = current.filter((u) => /^\/uploads\/|res\.cloudinary\.com/.test(u));
  const list = [...own, ...made];
  const upsert = 'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)';
  await query(upsert, ['hero_videos', JSON.stringify(list)]);
  await query(upsert, ['hero_clip_seconds', String(SECONDS)]);

  console.log(`\n✔ ${made.length} clips listos en public/media/ y activados en la portada${own.length ? ` (después de tus ${own.length} video(s) subidos)` : ''}.`);
  console.log('  Créditos de licencia en public/media/CREDITS.txt');
  console.log('  Recarga el sitio con Ctrl + F5.');
  await pool.end();
})().catch(async (e) => { console.error('✖', e.message); await pool.end(); process.exit(1); });
