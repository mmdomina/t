/* Para correrlo:  node pruebas/teetest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
/* "Llegaste al tee del 6, ¿cerramos el 5?"
   El socio no anota en el green: camina al tee siguiente y anota ahí, para no
   frenar la cancha. Ese momento el GPS lo puede ver, porque la cancha está
   medida a pie. Se corre con las coordenadas REALES de Trisquelia, no con
   puntos inventados: si alguien mueve una medición, esta suite se entera. */
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m);

const SEMILLA = { v:1, onboarded:true, tipo:'socio', tee:'mixta', vuelta:18, hole:5,
  playing:true, torneo:false, indexDias:2,
  user:{ name:'Mauro Domina', ini:'MD', hcp:7.4, socio:'—', club:'Trisquelia Golf Club', cat:'cab' } };

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
    deviceScaleFactor:2, permissions:['geolocation'],
    geolocation:{ latitude:-35.6561758, longitude:-63.7915282, accuracy:4 } });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  await p.addInitScript(s => { window.confirm = () => true;
    try { localStorage.setItem('trisquelia_v1', JSON.stringify(s)); } catch (e) {} }, SEMILLA);
  await p.goto(APP, { waitUntil:'load' });
  await p.waitForTimeout(1400);

  /* Nos paramos en un punto y esperamos a que el watcher del GPS lo tome. */
  const pararse = async (lat, lon, acc = 4) => {
    await ctx.setGeolocation({ latitude: lat, longitude: lon, accuracy: acc });
    await p.waitForTimeout(500);
    await p.evaluate(() => { S.tab = 'play'; render(); });
    await p.waitForTimeout(200);
  };
  const pantalla = () => p.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g,' '));

  /* Coordenadas reales, leídas del propio CLUB.geo al arrancar. */
  const G = await p.evaluate(() => ({
    t6: CLUB.geo.tees[6].blancas, t5: CLUB.geo.tees[5].blancas,
    t2: CLUB.geo.tees[2].azules,  g1: CLUB.geo.greens[1].c, g5: CLUB.geo.greens[5].c
  }));

  console.log('\n1. Llegás al tee del 6 con el hoyo 5 sin anotar');
  await p.evaluate(() => { S.hole = 5; R.scores = {}; S.teeVisto = null; });
  await pararse(G.t6[0], G.t6[1]);
  ok(await p.evaluate(() => hoyoDelTee() === 6), 'la app sabe que estás en el tee del 6');
  const t1 = await pantalla();
  ok(/Llegaste al tee del 6/.test(t1), 'y lo dice en pantalla');
  ok(/hoyo 5 todav[íi]a no est[áa] anotado/i.test(t1), 'avisa que el 5 quedó sin anotar');
  ok(await p.evaluate(() => S.hole === 5), 'PERO NO cambia de hoyo sola');

  console.log('\n2. Tocás el botón y te lleva a cerrar el 5');
  await p.locator('#screen button', { hasText:'Cerrar el 5' }).first().click();
  await p.waitForTimeout(250);
  ok(await p.evaluate(() => S.cerrando === true && S.hole === 5), 'abre el cierre del hoyo 5');
  await p.evaluate(() => { fijar('sc', 4); cerrarHoyo(); });
  await p.waitForTimeout(250);
  ok(await p.evaluate(() => S.hole === 6 && R.scores[5] === 4), 'y al guardar pasa al 6 con el 5 anotado');

  console.log('\n3. Ya en el 6, parado en su tee, no molesta más');
  await pararse(G.t6[0], G.t6[1]);
  ok(await p.evaluate(() => sugerenciaTee() === null), 'no sugiere el hoyo que ya estás jugando');
  ok(!/Llegaste al tee/.test(await pantalla()), 'y el aviso desaparece');

  console.log('\n4. Puteando en el green del 1 no dispara nada');
  /* El caso ajustado de la cancha: el tee del 2 está a 25 m del green del 1.
     La regla que los separa no es el radio, es estar más cerca del tee que
     del green. */
  await p.evaluate(() => { S.hole = 1; R.scores = {}; S.teeVisto = null; });
  await pararse(G.g1[0], G.g1[1]);
  ok(await p.evaluate(() => hoyoDelTee() === null),
     'parado en el green del 1, la app NO cree que estás en el tee del 2');
  ok(!/Llegaste al tee/.test(await pantalla()), 'y no aparece el aviso');

  console.log('\n5. Caminás al tee del 2 y ahí sí');
  await pararse(G.t2[0], G.t2[1]);
  ok(await p.evaluate(() => hoyoDelTee() === 2), 'en el tee del 2 lo detecta');
  ok(/Llegaste al tee del 2/.test(await pantalla()), 'y lo propone');

  console.log('\n6. "Ahora no" lo saca, y no vuelve a insistir');
  await p.locator('#screen button', { hasText:'Ahora no' }).first().click();
  await p.waitForTimeout(200);
  ok(!/Llegaste al tee/.test(await pantalla()), 'se va el aviso');
  await pararse(G.t2[0], G.t2[1]);
  ok(!/Llegaste al tee/.test(await pantalla()), 'y sigue sin aparecer en el mismo hoyo');

  console.log('\n7. Ida y vuelta: el mismo tee son dos hoyos distintos');
  await p.evaluate(() => { S.hole = 14; R.scores = {14:5}; S.teeVisto = null; });
  await pararse(G.t6[0], G.t6[1]);
  ok(await p.evaluate(() => hoyoDelTee() === 15),
     'jugando el 14 y parado en el tee físico 6, propone el 15 y no el 6');
  ok(/Llegaste al tee del 15/.test(await pantalla()), 'y eso es lo que muestra');
  ok(/ya est[áa] cerrado/i.test(await pantalla()), 'como el 14 ya está anotado, ofrece pasar de largo');
  await p.locator('#screen button', { hasText:'Ir al 15' }).first().click();
  await p.waitForTimeout(250);
  ok(await p.evaluate(() => S.hole === 15), 'y pasa al 15 cuando el socio lo toca');

  console.log('\n8. Lejos de todo, y sin GPS');
  await pararse(-35.6600000, -63.8000000);
  ok(await p.evaluate(() => hoyoDelTee() === null), 'a 500 metros de la cancha no detecta ningún tee');
  await p.evaluate(() => { POS_T = Date.now() - 60000; });   // posición vencida
  ok(await p.evaluate(() => hoyoDelTee() === null), 'con la posición vencida tampoco inventa');

  console.log('\n9. Nada se rompió');
  await pararse(G.t5[0], G.t5[1]);
  const fin = await pantalla();
  ok(!/\bnull\b|\bNaN\b|undefined|Infinity|\[object/.test(fin), 'la pantalla sin basura');

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
})();
