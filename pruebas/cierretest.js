/* Para correrlo:  node pruebas/cierretest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
/* Cerrar el hoyo: el socio anota parado en el tee siguiente, para no frenar
   la cancha. Veinte segundos, una mano, un guante. Todo lo que carga siempre
   —golpes, putts, bunker, penalidades y dónde quedó la salida— tiene que
   entrar en una pantalla, sin scrollear, en el teléfono más chico. */
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m);

const SEMILLA = { v:1, onboarded:true, tipo:'socio', tee:'mixta', vuelta:18, hole:5,
  playing:true, torneo:true, indexDias:2,
  user:{ name:'Mauro Domina', ini:'MD', hcp:7.4, socio:'—', club:'Trisquelia Golf Club', cat:'cab' } };

async function telefono(b, w, h) {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, isMobile:true, hasTouch:true,
    deviceScaleFactor:2, permissions:['geolocation'],
    geolocation:{ latitude:-35.65628, longitude:-63.78597, accuracy:4 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(s => { window.confirm = () => true;
    try { localStorage.setItem('trisquelia_v1', JSON.stringify(s)); } catch (e) {} }, SEMILLA);
  await p.goto(APP, { waitUntil:'load' });
  await p.waitForTimeout(1300);
  return { p, ctx, errs };
}

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  console.log('\n1. Entra en una pantalla, sin scroll');
  /* Se mide CON datos cargados, que es cuando el panel es más alto: la
     devolución ("Bogey", "en regulación") aparece recién ahí. */
  for (const [w, h] of [[320,568],[360,640],[375,667],[390,844],[430,932]]) {
    const t = await telefono(b, w, h);
    errores.push(...t.errs);
    const m = await t.p.evaluate(() => {
      R.scores[5] = 5; R.putts[5] = 2;
      S.tab = 'play'; S.cerrando = true; render();
      const s = document.getElementById('screen');
      const g = document.querySelector('#screen .guardar').getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      return { vis: s.clientHeight, total: s.scrollHeight,
               guardar: g.bottom <= sr.bottom + 1 && g.top >= sr.top - 1,
               nav: getComputedStyle(document.getElementById('nav')).display };
    });
    const sobra = m.total - m.vis;
    if (w === 320)
      /* Un SE de 2016 mide 568px: no entra sin bajar de 44px, y 44 no se
         negocia. Lo que no puede pasar es que el botón de guardar se escape. */
      ok(sobra <= 40, `${w}×${h}: sólo ${sobra}px de scroll en el teléfono más viejo`);
    else
      ok(sobra <= 0, `${w}×${h}: el panel entero entra sin scroll (${m.total}px en ${m.vis}px)`);
    ok(m.guardar, `${w}×${h}: el botón de guardar queda siempre a la vista`);
    ok(m.nav === 'none', `${w}×${h}: el nav se esconde y le deja el lugar al panel`);
    await t.ctx.close();
  }

  const t = await telefono(b, 360, 640);
  errores.push(...t.errs);
  const { p } = t;
  const texto = () => p.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g,' '));
  const tocar = async n => { await p.locator('#screen button', { hasText: new RegExp('^'+n+'$') }).first().click();
                             await p.waitForTimeout(90); };

  console.log('\n2. Está todo lo que el socio carga siempre');
  await p.evaluate(() => { S.tab='play'; S.cerrando=true; render(); });
  const t1 = await texto();
  for (const q of ['GOLPES','PUTTS','BUNKER','PENALIDADES','SALIDA'])
    ok(new RegExp(q,'i').test(t1), `está el bloque de ${q.toLowerCase()}`);
  ok(/Fairway/.test(t1) && /Izquierda/.test(t1) && /Derecha/.test(t1),
     'las flechas de dónde quedó la salida siguen ahí');
  ok(!/Green en regulaci[óo]n\?/.test(t1), 'y ya no se pregunta el green en regulación');

  console.log('\n3. El green en regulación se calcula, no se pregunta');
  await p.evaluate(() => { R.scores[5]=4; R.putts[5]=2; render(); });   // par 4: llegó en 2
  ok(/\ben regulaci[óo]n/.test(await texto()), 'par 4 en 4 golpes con 2 putts → en regulación');
  await p.evaluate(() => { R.scores[5]=6; R.putts[5]=2; render(); });   // llegó en 4
  ok(/fuera de regulaci[óo]n/i.test(await texto()), '6 golpes con 2 putts → fuera de regulación');
  ok(await p.evaluate(() => girDe(5) === false), 'y girDe() lo dice igual');
  await p.evaluate(() => { delete R.putts[5]; render(); });
  ok(await p.evaluate(() => girDe(5) === null), 'sin putts NO se calcula: la app no inventa');
  ok(!/regulaci[óo]n/.test(await texto()), 'y no muestra nada en pantalla');
  await p.evaluate(() => { cerrarHoyo(); });
  ok(await p.evaluate(() => R.gir[5] === undefined), 'y tampoco lo guarda');

  console.log('\n4. Bunker y penalidades: lo que se ve es lo que se guarda');
  await p.evaluate(() => { S.hole=6; R.scores={}; R.putts={}; R.bunker={}; R.penal={};
                           S.cerrando=true; render(); });
  const sinTocar = await p.evaluate(() => {
    const bs = [...document.querySelectorAll('#screen .grid4 .chip')];
    return { marcados: bs.filter(x=>x.classList.contains('on')).length, total: bs.length };
  });
  ok(sinTocar.marcados === 0,
     `ningún chip de bunker/penalidades viene marcado sin tocarlo (${sinTocar.marcados} de ${sinTocar.total})`);
  await p.evaluate(() => { fijar('bunker',0); });
  ok(await p.evaluate(() => R.bunker[6] === 0), 'tocar el 0 SÍ guarda un cero de verdad');

  console.log('\n5. Los toques de un hoyo completo');
  await p.evaluate(() => { S.hole=7; R.scores={}; R.putts={}; R.bunker={}; R.penal={}; R.fw={};
                           S.cerrando=false; S.tab='play'; render(); });
  await p.evaluate(() => abrirCierre(7));            // 1: abrir
  await p.waitForTimeout(150);
  await tocar(5);                                    // 2: golpes
  await p.locator('#screen .bloque', { hasText:'Putts' }).locator('button', { hasText:'2' }).first().click();
  await p.waitForTimeout(90);                        // 3: putts
  await p.locator('#screen .bloque', { hasText:'Bunker' }).locator('button', { hasText:'0' }).first().click();
  await p.waitForTimeout(90);                        // 4: bunker
  await p.locator('#screen .bloque', { hasText:'Penalidades' }).locator('button', { hasText:'0' }).first().click();
  await p.waitForTimeout(90);                        // 5: penalidades
  await p.locator('#screen button', { hasText:'Fairway' }).first().click();
  await p.waitForTimeout(90);                        // 6: salida
  const cargado = await p.evaluate(() => ({ sc:R.scores[7], pu:R.putts[7], bu:R.bunker[7],
                                            pe:R.penal[7], fw:R.fw[7] }));
  ok(cargado.sc===5 && cargado.pu===2 && cargado.bu===0 && cargado.pe===0 && cargado.fw==='fw',
     'seis toques dejan cargado todo lo que el socio carga siempre');
  const scrolleo = await p.evaluate(() => document.getElementById('screen').scrollTop);
  ok(scrolleo === 0, 'y no hizo falta scrollear ni una vez');

  console.log('\n6. La tarjeta del marcador es un segundo paso');
  ok(/Seguir · la tarjeta de/.test(await texto()), 'en torneo el botón lleva al paso del marcador');
  await p.locator('#screen button', { hasText:'Seguir' }).first().click();
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => S.cierrePaso === 2), 'y pasa al segundo paso');
  ok(await p.evaluate(() => S.hole === 7), 'sin cerrar el hoyo todavía');
  const t2 = await texto();
  ok(/La tarjeta de/.test(t2), 'ahí sí aparece la tarjeta del que marcás');
  ok(!/BUNKER|PENALIDADES/i.test(t2), 'y ya no está lo del hoyo propio, que es lo que liberó el espacio');
  const alto2 = await p.evaluate(() => { const s=document.getElementById('screen');
    return s.scrollHeight <= s.clientHeight + 1; });
  ok(alto2, 'el segundo paso también entra sin scroll');
  await p.locator('#screen button', { hasText:'Guardar y pasar' }).first().click();
  await p.waitForTimeout(250);
  ok(await p.evaluate(() => S.hole === 8 && !S.cerrando), 'y recién ahí guarda y pasa al hoyo 8');
  ok(await p.evaluate(() => S.cierrePaso === 1), 'el paso vuelve a uno para el hoyo siguiente');

  console.log('\n7. Sin torneo es un solo paso');
  await p.evaluate(() => { S.torneo=false; S.hole=9; R.scores={}; abrirCierre(9); });
  await p.waitForTimeout(150);
  ok(/Guardar y pasar al hoyo 10/.test(await texto()), 'el botón guarda directo, sin paso intermedio');

  console.log('\n8. Nada se rompió');
  const pant = await texto();
  ok(!/\bnull\b|\bNaN\b|undefined|Infinity|\[object/.test(pant), 'la pantalla sin basura');
  ok(await p.evaluate(() => { S.cerrando=false; render();
      return getComputedStyle(document.getElementById('nav')).display !== 'none'; }),
     'al salir del cierre, el nav vuelve');

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
})();
