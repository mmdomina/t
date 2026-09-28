/* Para correrlo:  node pruebas/formatest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */

/* LA FORMA DE LOS HOYOS SALE DE LA CANCHA MEDIDA, NO DE PARÁMETROS A OJO.

   Desde la v18 el dibujo de cada hoyo usa las coordenadas que se midieron a pie
   el 5/8/2026: el largo real de la salida al green, el largo del green de frente
   a fondo, en qué ángulo está cruzado respecto de la línea de juego, y dónde cae
   cada salida —no sólo a qué distancia, también cuánto corrida del eje.

   Esta suite es el control cruzado de eso. La app calcula con una proyección
   plana (rápida y de sobra precisa en menos de un kilómetro); acá se recalcula
   todo con la **fórmula de haversine**, que es otra matemática. Si los dos
   caminos dan lo mismo, el error no está en la cuenta. Y si alguien mueve una
   coordenada sin querer, los números dejan de cerrar y esto se enciende.

   El ancla externa: del tee de blancas al centro del green del 7, nuestras
   coordenadas dan 403 yardas. La captura de Hole19 del 25/9/2026 marcaba 402. */

const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
let bien = 0, mal = 0;
const ok = (c, m) => { c ? bien++ : mal++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

/* La otra matemática: haversine sobre la esfera, y el rumbo inicial. */
const R_TIERRA = 6371008.8, YD = 1.0936133;
const rad = g => g * Math.PI / 180;
function haversine(a, b) {
  const dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]);
  const x = Math.sin(dLa / 2) ** 2 +
            Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R_TIERRA * Math.asin(Math.sqrt(x)) * YD;      // en yardas
}
function rumbo(a, b) {                                      // grados desde el norte
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
            Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const cerca = (a, b, t) => Math.abs(a - b) <= t;

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('trisquelia_v1', JSON.stringify({
    v:1, onboarded:true, tipo:'socio', tee:'negras', vuelta:18, hole:1,
    user:{ name:'Socio Uno', ini:'S1', hcp:12.0, socio:'—', club:'Trisquelia Golf Club', cat:'cab' } })); } catch(e){} });
  await p.goto(APP, { waitUntil:'load' });
  await p.waitForTimeout(1300);

  /* Las coordenadas crudas, tal como las tiene la app. */
  const geo = await p.evaluate(() => JSON.parse(JSON.stringify(CLUB.geo)));

  console.log('\n1. Las coordenadas están completas');
  ok(Object.keys(geo.greens).length === 9, `los 9 greens medidos`);
  ok(Object.keys(geo.tees).length === 9, `las salidas de los 9 hoyos`);
  ok(Object.values(geo.greens).every(g => g.f && g.c && g.b),
     'cada green con frente, centro y fondo');
  ok(!!(geo.tees[4].negras2 && geo.tees[9].negras2),
     'el 4 y el 9 tienen el segundo tee de negras, que es el que se juega en la vuelta');

  console.log('\n2. La app y el haversine dan el mismo largo');
  const conFormula = await p.evaluate(() => {
    const salida = {};
    [['negras',1],['mixta',1],['damas',1]].forEach(()=>{});
    for (const id of ['negras','mixta','damas']) {
      S.tee = id;
      salida[id] = {};
      for (const h of [1,2,3,4,5,6,7,8,9,10,13,18]) {
        S.hole = h;
        const F = formaHoyo(h);
        salida[id][h] = F ? { largo:F.largo, punto:puntoTee(tee(), h),
                              gl:F.green.largo, da:F.green.da, dl:F.green.dl } : null;
      }
    }
    S.tee = 'negras'; S.hole = 1;
    return salida;
  });

  let peor = 0, n = 0;
  for (const id of Object.keys(conFormula))
    for (const h of Object.keys(conFormula[id])) {
      const d = conFormula[id][h];
      if (!d) continue;
      const fis = h <= 9 ? +h : h - 9;
      const mio = haversine(d.punto, geo.greens[fis].c);
      peor = Math.max(peor, Math.abs(mio - d.largo)); n++;
    }
  ok(n >= 30, `se compararon ${n} largos, de las tres salidas`);
  ok(peor < 0.5, `la diferencia más grande entre las dos matemáticas es ${peor.toFixed(2)} yardas`);

  console.log('\n3. El ancla externa: el hoyo 7 contra Hole19');
  const h7 = haversine(geo.tees[7].blancas, geo.greens[7].c);
  ok(cerca(h7, 403, 1.5), `del tee de blancas al centro del green del 7: ${h7.toFixed(0)} yardas (Hole19 marcaba 402)`);

  console.log('\n4. El 13 y el 18 se juegan del segundo tee de negras');
  ok(conFormula.negras[4].punto[1] === geo.tees[4].negras[1] &&
     conFormula.negras[13].punto[1] === geo.tees[4].negras2[1],
     'el 4 sale del tee de ida y el 13 del de vuelta, que es otro punto');
  ok(conFormula.negras[9].largo > 500 && conFormula.negras[18].largo < 450,
     `el 9 mide ${conFormula.negras[9].largo.toFixed(0)} y el 18 ${conFormula.negras[18].largo.toFixed(0)}: ` +
     'el mismo green desde dos tees distintos');

  console.log('\n5. Los greens, medidos uno por uno');
  /* El centro tiene que caer ENTRE el frente y el fondo y sobre esa línea. Si
     la suma frente→centro→fondo se pasa mucho de la recta, el punto del centro
     quedó corrido al costado. La tolerancia son 4 yardas porque el GPS midió
     con ±3 a 4 metros y un green puede ser curvo de verdad. */
  const torcidos = [];
  for (const fis of [1,2,3,4,5,6,7,8,9]) {
    const g = geo.greens[fis];
    const largo = haversine(g.f, g.b);
    const dFC = haversine(g.f, g.c), dCB = haversine(g.c, g.b);
    const fuera = dFC + dCB - largo;
    if (fuera > 2 || Math.abs(dFC - dCB) > 0.3 * largo)
      torcidos.push(`green ${fis} (${fuera > 2 ? `centro corrido ${fuera.toFixed(1)} yd al costado` :
        `centro a ${dFC.toFixed(0)} del frente y ${dCB.toFixed(0)} del fondo`})`);
    ok(largo > 14 && largo < 34 && cerca(dFC + dCB, largo, 4),
       `green ${fis}: ${largo.toFixed(1)} yardas de frente a fondo, centro a ` +
       `${dFC.toFixed(0)} y ${dCB.toFixed(0)} · fuera del eje ${fuera.toFixed(1)}`);
  }
  console.log('\n   PARA VOLVER A MEDIR en la cancha (no es un error del código):');
  torcidos.forEach(t => console.log('   · ' + t));

  console.log('\n6. La inclinación del green respecto de la línea de juego');
  for (const [fis, esperado] of [[7, -41], [9, 44], [1, -38], [4, -5]]) {
    const g = geo.greens[fis], t = geo.tees[fis].negras;
    const linea = rumbo(t, g.c), eje = rumbo(g.f, g.b);
    const dif = ((eje - linea + 540) % 360) - 180;
    const dela = conFormula.negras[fis];
    const appDif = Math.atan2(dela.dl, dela.da) * 180 / Math.PI;
    ok(cerca(dif, esperado, 3) && cerca(appDif, dif, 3),
       `hoyo ${fis}: cruzado ${dif.toFixed(0)}° — la app dice ${appDif.toFixed(0)}°`);
  }

  console.log('\n7. El dibujo respeta lo medido');
  const dib = await p.evaluate(() => {
    S.tee = 'negras'; S.hole = 7; S.playing = true; S.tab = 'play'; render();
    const svg = document.querySelector('.mapa svg');
    const el = [...svg.querySelectorAll('ellipse')].filter(e => e.getAttribute('transform'));
    const g = el[0];
    const marcas = [...svg.querySelectorAll('rect')].filter(r => r.getAttribute('rx') === '2.5');
    return { giro: g && +(/rotate\(([-\d.]+)/.exec(g.getAttribute('transform')) || [])[1],
             cy: g && +g.getAttribute('cy'), cx: g && +g.getAttribute('cx'),
             ry: g && +g.getAttribute('ry'), rx: g && +g.getAttribute('rx'),
             marcas: marcas.map(r => ({ x:+r.getAttribute('x'), y:+r.getAttribute('y') })),
             pie: ([...svg.querySelectorAll('text')].pop() || {}).textContent };
  });
  ok(dib.cx === 100, 'el green queda centrado sobre la línea de juego');
  /* En el dibujo el giro sale más marcado que en la cancha porque el ancho va
     exagerado; lo que se comprueba es que gire para el mismo lado y se note. */
  ok(dib.giro < -20, `y girado ${dib.giro}° en el dibujo — en la cancha son -41°, ` +
     'más marcado porque el ancho va exagerado');
  ok(dib.ry > dib.rx, 'dibujado alargado, que es lo que deja ver la inclinación');
  ok(dib.marcas.length >= 3 && dib.marcas.some(m => Math.abs(m.x - 100) > 3),
     `las ${dib.marcas.length} salidas están corridas del eje, no apiladas en el centro`);
  ok(dib.marcas.every(m => m.y > dib.cy), 'todas las salidas quedan por detrás del green');
  ok(/medidos/.test(dib.pie || ''), `el pie del dibujo dice qué se midió: "${(dib.pie||'').trim().slice(0,60)}…"`);

  console.log('\n8. Un club sin coordenadas no rompe el dibujo');
  const sinGeo = await p.evaluate(() => {
    const guardado = CLUB.geo; CLUB.geo = null;
    let html = '', err = null;
    try { html = holeSVG(3); } catch (e) { err = e.message; }
    CLUB.geo = guardado;
    return { err, largo: html.length, sucio: /NaN|undefined/.test(html) };
  });
  ok(!sinGeo.err && sinGeo.largo > 800 && !sinGeo.sucio,
     'sin geo, el dibujo cae al esquema de siempre y sale limpio');

  await ctx.close();
  console.log(`\n${bien} bien · ${mal} mal`);
  console.log('Errores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
  process.exit(mal ? 1 : 0);
})();
