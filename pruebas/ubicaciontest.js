/* Para correrlo:  node pruebas/ubicaciontest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
/* Sin ubicación no se sale a jugar — pero la tarjeta nunca se bloquea. */
const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m);

const SEMILLA = { v:1, onboarded:true, tipo:'socio', tee:'mixta', vuelta:18, hole:1,
  user:{ name:'Mauro Domina', ini:'MD', hcp:7.4, socio:'—', club:'Trisquelia Golf Club', cat:'cab' } };

/* Un teléfono. `conGps` decide si el contexto concede el permiso: sin él,
   Chromium contesta PERMISSION_DENIED sin preguntar, que es exactamente el
   caso del socio que le dijo que no a la app. */
async function telefono(b, conGps) {
  const ctx = await b.newContext({ ...devices['Pixel 7'],
    ...(conGps ? { permissions:['geolocation'],
                   geolocation:{ latitude:-35.65628, longitude:-63.78597, accuracy:4 } } : {}) });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  await p.addInitScript(s => {
    window.confirm = () => true;
    try { localStorage.setItem('trisquelia_v1', JSON.stringify(s)); } catch (e) {}
  }, SEMILLA);
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  return { p, ctx, errores };
}

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  console.log('\n1. Sin permiso de ubicación no se sale a jugar');
  const sin = await telefono(b, false);
  errores.push(...sin.errores);
  await sin.p.evaluate(() => { S.tab = 'arranque'; render(); });
  await sin.p.waitForTimeout(300);

  ok(await sin.p.evaluate(() => !gpsVivo()), 'la app sabe que no tiene ubicación');
  const pantalla = await sin.p.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g, ' '));
  ok(/permiso de ubicaci[óo]n|ubicaci[óo]n/i.test(pantalla), 'y lo dice en pantalla, con el motivo');
  ok(await sin.p.evaluate(() => { const x = document.getElementById('btnSalir'); return !!x && x.disabled; }),
     'el botón de salir a jugar queda apagado');

  await sin.p.evaluate(() => empezarRonda());
  ok(await sin.p.evaluate(() => S.playing === false), 'y si igual se llama a empezarRonda(), no arranca');

  console.log('\n2. Pero la tarjeta nunca se bloquea');
  ok(await sin.p.evaluate(() => !!document.body.innerText.match(/Anotar sin distancias/)),
     'hay una puerta explícita para anotar sin distancias');
  await sin.p.evaluate(() => empezarRonda(true));
  await sin.p.waitForTimeout(250);
  ok(await sin.p.evaluate(() => S.playing === true && S.tab === 'play'), 'esa puerta sí arranca la vuelta');
  await sin.p.evaluate(() => { setScore(4); });
  ok(await sin.p.evaluate(() => R.scores[1] === 4), 'y se puede anotar un golpe igual');

  const jugando = await sin.p.evaluate(() => { S.tab = 'play'; render();
    return document.getElementById('screen').innerText.replace(/\s+/g, ' '); });
  ok(/Se perdi[óo] la ubicaci[óo]n/.test(jugando), 'la pantalla de jugar avisa que no hay ubicación');
  ok(/estimadas/.test(jugando), 'y aclara que las distancias son estimadas');
  ok(!/\bnull\b|\bNaN\b|undefined|Infinity/.test(jugando), 'sin huecos ni basura');

  console.log('\n3. El resto de la app anda sin ubicación');
  for (const [tab, texto] of [['tarjeta', /tarjeta/i], ['stats', /./], ['me', /Mi cuenta/i]]) {
    const t = await sin.p.evaluate(v => { S.tab = v; render();
      return document.getElementById('screen').innerText; }, tab);
    ok(t.length > 100 && texto.test(t) && !/\bNaN\b|undefined/.test(t), `la pantalla "${tab}" funciona igual`);
  }
  const club = await sin.p.evaluate(() => { S.mode = 'club'; S.tab = 'dash'; render();
    return document.getElementById('screen').innerText; });
  ok(club.length > 200 && !/\bNaN\b|undefined/.test(club), 'y el panel de la comisión también');
  await sin.ctx.close();

  console.log('\n4. Con ubicación, todo normal');
  const con = await telefono(b, true);
  errores.push(...con.errores);
  ok(await con.p.evaluate(() => gpsVivo()), 'engancha el GPS');
  await con.p.evaluate(() => { S.tab = 'arranque'; render(); });
  await con.p.waitForTimeout(200);
  ok(await con.p.evaluate(() => { const x = document.getElementById('btnSalir'); return !!x && !x.disabled; }),
     'el botón de salir a jugar queda prendido');
  ok(/Lista/.test(await con.p.evaluate(() => document.getElementById('estadoGps').innerText)),
     'y dice que la ubicación está lista, con la precisión');
  await con.p.evaluate(() => empezarRonda());
  ok(await con.p.evaluate(() => S.playing === true && S.hole === 1), 'arranca la vuelta');
  ok(await con.p.evaluate(() => gps(1).real === true), 'y las distancias son medidas, no estimadas');

  console.log('\n5. Una posición vieja no es tu posición');
  const antes = await con.p.evaluate(() => gps(1).real);
  const viejo = await con.p.evaluate(() => {
    POS_T = Date.now() - 60000;             // un minuto sin lectura nueva
    return { vivo: gpsVivo(), real: gps(1).real, esperando: !!gps(1).esperandoGPS };
  });
  ok(antes === true && viejo.vivo === false, 'a los 30 segundos sin lectura, la posición vence');
  ok(viejo.real !== true, 'y la app deja de decir que la distancia es medida');
  ok(viejo.esperando === true, 'pasa a estimada y lo avisa');

  const golpe = await con.p.evaluate(() => {
    R.shots[1] = []; registrarGolpe(1, 'Dr');
    return R.shots[1][0];
  });
  ok(golpe && golpe.lat === null, 'y no guarda una coordenada vieja como si fuera dónde pegaste');
  await con.ctx.close();

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
})();
