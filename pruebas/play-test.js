/* Para correrlo:  node pruebas/<archivo>.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
/* Prueba de interacción de la pantalla de jugar nueva. */
const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;   // si está vacío, Playwright busca solo
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m);

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'],
    geolocation: { latitude: -35.65628, longitude: -63.78597, accuracy: 4 } });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });

  await p.addInitScript(() => {
    try { localStorage.setItem('trisquelia_v1', JSON.stringify({ v: 1, onboarded: true, tipo: 'socio',
      tee: 'mixta', vuelta: 18, hole: 1, indexDias: 2,
      user: { name: 'Mauro Domina', ini: 'MD', hcp: 7.4, socio: '#1047',
              club: 'Trisquelia Golf Club', cat: 'cab' } })); } catch (e) {}
  });
  await p.goto('http://localhost:8000/', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.evaluate(() => go('play'));
  await p.waitForTimeout(900);

  console.log('\n1. La pantalla');
  const arriba = await p.evaluate(() => {
    const mapa = document.querySelector('.mapa');
    const dists = document.querySelector('.dists');
    const centro = document.getElementById('dMid');
    return {
      mapaArriba: mapa ? Math.round(mapa.getBoundingClientRect().top) : null,
      distTop: dists ? Math.round(dists.getBoundingClientRect().top) : null,
      centro: centro && centro.textContent.trim(),
      tamañoCentro: centro && getComputedStyle(centro).fontSize,
      gps: (document.getElementById('gpsPill') || {}).textContent,
      alto: document.getElementById('screen').scrollHeight,
      ventana: window.innerHeight
    };
  });
  ok(arriba.mapaArriba < 40, `el mapa arranca arriba de todo (y=${arriba.mapaArriba})`);
  ok(arriba.distTop < arriba.ventana, `las distancias entran sin scroll (y=${arriba.distTop}, pantalla ${arriba.ventana})`);
  ok(parseInt(arriba.tamañoCentro) >= 50, `la distancia al centro es grande: ${arriba.tamañoCentro} · dice "${arriba.centro}"`);
  ok(/GPS ±\d/.test(arriba.gps || ''), `GPS real: "${(arriba.gps || '').trim()}"`);
  console.log(`    alto total de la pantalla: ${arriba.alto}px (antes hacía falta bajar mucho más)`);

  console.log('\n2. La barra fija del hoyo');
  const barra = await p.evaluate(() => {
    const e = document.getElementById('barra');
    const r = e.getBoundingClientRect();
    const nav = document.getElementById('nav').getBoundingClientRect();
    return { visible: e.classList.contains('on'), txt: e.innerText.replace(/\s+/g, ' ').trim(),
             sobreElNav: Math.abs(r.bottom - nav.top) < 2 };
  });
  ok(barra.visible && barra.sobreElNav, `fija arriba del menú · "${barra.txt.slice(0, 60)}…"`);

  await p.click('#barra .fl:last-child');   // siguiente hoyo
  await p.waitForTimeout(400);
  const h2 = await p.evaluate(() => ({ hole: S.hole, txt: document.querySelector('#barra .mid .h').textContent.trim() }));
  ok(h2.hole === 2, `la flecha avanza de hoyo · "${h2.txt}"`);

  await p.click('#barra .fl:first-child');
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => S.hole) === 1, 'la flecha vuelve');
  ok(await p.evaluate(() => document.querySelector('#barra .fl:first-child').disabled),
     'en el hoyo 1 la flecha de atrás queda apagada');

  console.log('\n3. Las hojas');
  for (const [cual, espero] of [['hoyos', /Saltar a un hoyo/], ['salida', /Salida y recorrido/],
                                ['grupo', /Tarjeta del grupo/], ['tarjeta', /Mi tarjeta/],
                                ['cancha', /Estacas y banderas/]]) {
    await p.evaluate(c => abrirHoja(c), cual);
    await p.waitForTimeout(280);
    const r = await p.evaluate(() => {
      const e = document.getElementById('hoja');
      const panel = e.querySelector('.panel');
      return { abierta: e.classList.contains('on'),
               titulo: (e.querySelector('.cab h3') || {}).textContent,
               dentro: panel ? panel.getBoundingClientRect().bottom <= window.innerHeight + 1 : false,
               txt: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 70) };
    });
    ok(r.abierta && espero.test(r.titulo) && r.dentro, `${cual} → "${r.titulo}"`);
  }

  // saltar de hoyo desde la hoja
  await p.evaluate(() => abrirHoja('hoyos'));
  await p.waitForTimeout(250);
  await p.evaluate(() => { const bs = [...document.querySelectorAll('#hoja .chip')];
    (bs.find(x => x.textContent.trim().startsWith('12')) || bs[11]).click(); });
  await p.waitForTimeout(400);
  const salto = await p.evaluate(() => ({ hole: S.hole, hoja: S.hoja }));
  ok(salto.hole === 12 && salto.hoja === null, `saltar desde la hoja lleva al hoyo ${salto.hole} y la cierra`);

  // cerrar tocando el fondo
  await p.evaluate(() => abrirHoja('cancha'));
  await p.waitForTimeout(250);
  await p.click('#hoja .fondo');
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.getElementById('hoja').classList.contains('on')),
     'se cierra tocando afuera');

  console.log('\n4. Jugar el hoyo');
  await p.evaluate(() => { S.hole = 1; render(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { S.shotOpen = true; render(); });
  await p.waitForTimeout(250);
  await p.evaluate(() => registrarGolpe(1, 'Dr'));
  await p.waitForTimeout(400);
  const golpe = await p.evaluate(() => ({ n: (R.shots[1] || []).length, palo: (R.shots[1] || [])[0] }));
  ok(golpe.n === 1 && golpe.palo.c === 'Dr', `registrar un golpe funciona (${golpe.n} golpe con ${golpe.palo.c})`);

  await p.evaluate(() => abrirCierre(1));
  await p.waitForTimeout(350);
  const cierre = await p.evaluate(() => ({
    cerrando: S.cerrando,
    barraOculta: !document.getElementById('barra').classList.contains('on'),
    txt: document.getElementById('screen').innerText.replace(/\s+/g, ' ').slice(0, 60) }));
  ok(cierre.cerrando && cierre.barraOculta, `el panel de cierre abre y la barra se va · "${cierre.txt}…"`);

  await p.evaluate(() => { setScore(4); setPutt(2); cerrarHoyo(1); });
  await p.waitForTimeout(400);
  const post = await p.evaluate(() => ({ score: R.scores[1], hole: S.hole, cerrando: S.cerrando }));
  ok(post.score === 4 && post.hole === 2 && !post.cerrando,
     `cerrar el hoyo guarda ${post.score} y pasa al hoyo ${post.hole}`);

  console.log('\n5. Cambiar de pantalla');
  await p.evaluate(() => abrirHoja('salida'));
  await p.waitForTimeout(200);
  await p.evaluate(() => go('home'));
  await p.waitForTimeout(350);
  const fuera = await p.evaluate(() => ({
    hoja: S.hoja,
    hojaCerrada: !document.getElementById('hoja').classList.contains('on'),
    barra: !document.getElementById('barra').classList.contains('on') }));
  ok(fuera.hoja === null && fuera.hojaCerrada && fuera.barra,
     'salir de jugar cierra la hoja y esconde la barra');

  console.log('\n6. Cada salida, sin huecos');
  for (const t of ['negras', 'mixta', 'damas']) {
    await p.evaluate(id => { setTee(id); go('play'); }, t);
    await p.waitForTimeout(350);
    const txt = await p.evaluate(() => document.getElementById('screen').innerText);
    const sucio = /\bnull\b|\bNaN\b|undefined|Infinity/.test(txt);
    await p.evaluate(() => abrirHoja('salida'));
    await p.waitForTimeout(250);
    const hoja = await p.evaluate(() => document.getElementById('hoja').innerText.replace(/\s+/g, ' '));
    const sucioHoja = /\bnull\b|\bNaN\b|undefined|Infinity/.test(hoja);
    ok(!sucio && !sucioHoja, `${t} · limpio · ${hoja.match(/rating|sin homologar|[\d.]+\/\d+/i) ? hoja.slice(hoja.indexOf('Estás jugando'), hoja.indexOf('Estás jugando') + 90) : ''}`);
    await p.evaluate(() => cerrarHoja());
  }

  await p.evaluate(() => { S.tee = 'mixta'; S.hole = 5; R.scores[3] = 4; go('play'); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: '/tmp/play-nueva.png' });
  await p.evaluate(() => abrirHoja('salida'));
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/tmp/play-hoja.png' });

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
})();
