/* Para correrlo:  node pruebas/<archivo>.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;   // si está vacío, Playwright busca solo
const URL = 'http://localhost:8000/';
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m);

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});

  // ───────── 1. registro del service worker y caché ─────────
  console.log('\n1. Service worker y caché offline');
  let ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'],
    geolocation: { latitude: -35.6563, longitude: -63.7859 } });
  let p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(String(e)));
  await p.goto(URL, { waitUntil: 'load' });

  /* El service worker tarda ~300 ms en pasar de "activating" a "activated", y
     además la app se recarga sola cuando él toma el control. Por eso esperamos
     desde acá afuera y reintentando: adentro de la página el contexto se muere
     con la recarga. */
  let reg = { activo:false, estado:'?', scope:'' };
  for (let i = 0; i < 25; i++) {
    try {
      reg = await p.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        return { scope: r.scope, activo: !!r.active, estado: r.active && r.active.state };
      });
      if (reg.estado === 'activated') break;
    } catch (e) { /* recargó justo: probamos de nuevo */ }
    await new Promise(x => setTimeout(x, 200));
  }
  ok(reg.activo && reg.estado === 'activated', `service worker activo · scope ${reg.scope}`);

  // esperamos a que termine de precachear
  await p.waitForTimeout(2500);
  const cache = await p.evaluate(async () => {
    const nombres = await caches.keys();
    const c = await caches.open(nombres[0]);
    const keys = await c.keys();
    return { nombres, urls: keys.map(k => new URL(k.url).pathname).sort() };
  });
  ok(cache.nombres.length === 1, `caché: ${cache.nombres.join(', ')}`);
  console.log('    guardado:', cache.urls.join(' '));
  const debe = ['/index.html', '/manifest.webmanifest', '/medir.html', '/icon-512.png'];
  debe.forEach(u => ok(cache.urls.includes(u), `precacheado ${u}`));

  // ───────── 2. sin conexión ─────────
  console.log('\n2. Sin conexión');
  await p.reload();                                  // que el SW tome el control
  await p.waitForTimeout(500);
  const controlada = await p.evaluate(() => !!navigator.serviceWorker.controller);
  ok(controlada, 'la app la sirve el service worker');

  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const offline = await p.evaluate(() => ({
    nombre: (document.getElementById('appname') || {}).textContent,
    pantalla: (document.getElementById('screen') || {}).innerHTML.length,
    titulo: document.title
  }));
  ok(offline.nombre === 'Trisquelia' && offline.pantalla > 500,
     `abre sin señal · "${offline.titulo}" · ${offline.pantalla} bytes de pantalla`);

  const medirOffline = await p.goto(URL + 'medir.html', { waitUntil: 'load' }).then(r => r && r.status());
  const medirTitulo = await p.title();
  ok(/Medir/i.test(medirTitulo), `la herramienta de medir también anda sin señal · "${medirTitulo}"`);
  await ctx.setOffline(false);
  await ctx.close();

  // ───────── 3. manifest e instalación ─────────
  console.log('\n3. Manifest e íconos');
  ctx = await b.newContext({ ...devices['Pixel 7'] });
  p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'load' });
  const man = await p.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const m = await (await fetch(href)).json();
    const icons = await Promise.all(m.icons.map(async i => {
      const r = await fetch(new URL(i.src, href));
      return { src: i.src, ok: r.ok, tipo: r.headers.get('content-type') };
    }));
    const apple = document.querySelector('link[rel="apple-touch-icon"]');
    const appleOk = apple ? (await fetch(apple.href)).ok : false;
    return { nombre: m.name, display: m.display, start: m.start_url, icons, appleOk,
             atajos: (m.shortcuts || []).map(s => s.url) };
  });
  ok(man.display === 'standalone', `display: ${man.display} · start_url: ${man.start}`);
  man.icons.forEach(i => ok(i.ok && /image\/png/.test(i.tipo), `${i.src} (${i.tipo})`));
  ok(man.appleOk, 'apple-touch-icon accesible');
  console.log('    atajos:', man.atajos.join(' · '));

  // el atajo del ícono abre la pantalla que corresponde
  await p.evaluate(() => { try { localStorage.setItem('trisquelia_v1',
    JSON.stringify({ v:1, onboarded:true, tipo:'socio', user:{name:'Prueba',ini:'PR',hcp:7.4,socio:'#1',club:'Trisquelia Golf Club',cat:'cab'} })); } catch(e){} });
  await p.goto(URL + '?ir=stats', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  const tab = await p.evaluate(() => S.tab);
  ok(tab === 'stats', `el atajo del ícono abre la pantalla pedida (S.tab = ${tab})`);
  await ctx.close();

  // ───────── 4. el aviso de instalar en iPhone ─────────
  console.log('\n4. Aviso de instalación en iPhone');
  ctx = await b.newContext({ ...devices['iPhone 13'] });
  p = await ctx.newPage();
  await p.addInitScript(() => {
    try { localStorage.setItem('trisquelia_v1', JSON.stringify({ v:1, onboarded:true, tipo:'socio',
      user:{name:'Prueba',ini:'PR',hcp:7.4,socio:'#1',club:'Trisquelia Golf Club',cat:'cab'} })); } catch(e){}
  });
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(800);
  const banner = await p.evaluate(() => {
    const el = document.querySelector('.instalar');
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : null;
  });
  ok(!!banner && /Compartir/.test(banner), banner ? `"${banner.slice(0, 95)}…"` : 'no apareció');
  const cerrado = await p.evaluate(() => { ocultarInstalar(); return !document.querySelector('.instalar'); });
  ok(cerrado, 'se puede cerrar y no vuelve');
  await p.screenshot({ path: '/tmp/pwa-ios.png' });
  await ctx.close();

  // ───────── 5. instalada: ocupa la pantalla entera ─────────
  console.log('\n5. Instalada en el teléfono');
  ctx = await b.newContext({ ...devices['Pixel 7'] });
  p = await ctx.newPage();
  await p.emulateMedia({ media: 'screen', reducedMotion: 'no-preference' });
  await p.addInitScript(() => {
    try { localStorage.setItem('trisquelia_v1', JSON.stringify({ v:1, onboarded:true, tipo:'socio',
      user:{name:'Prueba',ini:'PR',hcp:7.4,socio:'#1',club:'Trisquelia Golf Club',cat:'cab'} })); } catch(e){}
  });
  await p.goto(URL, { waitUntil: 'load' });
  // forzamos la regla de "instalada" para ver el resultado
  await p.addStyleTag({ content: `body{padding:0;display:block}
    #frame{max-width:none;width:100%;height:100dvh;max-height:none;border-radius:0;border:0;box-shadow:none}` });
  await p.waitForTimeout(600);
  const marco = await p.evaluate(() => {
    const f = document.getElementById('frame').getBoundingClientRect();
    return { w: Math.round(f.width), h: Math.round(f.height),
             vw: window.innerWidth, vh: window.innerHeight };
  });
  ok(marco.w === marco.vw && Math.abs(marco.h - marco.vh) < 2,
     `ocupa la pantalla entera · ${marco.w}×${marco.h} en ${marco.vw}×${marco.vh}`);
  await p.screenshot({ path: '/tmp/pwa-instalada.png' });
  await ctx.close();

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
})();
