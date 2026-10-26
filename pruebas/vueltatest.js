/* Para correrlo:  node pruebas/vueltatest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   No habla con ningún servidor de verdad: Neon se imita acá mismo,
   interceptando los pedidos. Si Playwright no encuentra Chromium solo,
   pasale la ruta en CHROME_PATH. */

/* LA VIDA DE UNA VUELTA.
   Hasta la v24 una vuelta no terminaba nunca: `S.playing` no volvía a false
   en ningún lado y la tarjeta no se vaciaba jamás. Después de la primera
   vuelta Inicio decía "Ronda en curso" para siempre, la vuelta nueva arrancaba
   con los golpes de la anterior, la segunda de torneo arrancaba "Certificada",
   la ronda compartida seguía consultando al servidor para siempre y la app no
   tomaba versiones nuevas. Ninguna suite lo veía porque ninguna terminaba una
   vuelta: todas siembran el estado y miran una pantalla. Ésta juega vueltas
   enteras, una detrás de otra. Lo encontró la simulación de la demo para la
   comisión, el 26/10/2026.

   El trato que cuida:
   · una vuelta empieza vacía y termina de verdad;
   · terminar no borra: la vuelta queda en "Mis rondas";
   · nunca se pisa una vuelta en silencio, tampoco las que quedaron abiertas
     en los teléfonos de antes;
   · lo que no llegó al grupo antes de terminar, llega después;
   · el resumen sólo dice lo que se jugó. */

const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { c ? pasaron++ : fallaron++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

const SOCIO = { v:1, onboarded:true, tipo:'socio', tee:'mixta', vuelta:9, hole:1, playing:false,
  torneo:false, user:{ name:'Socio Prueba', ini:'SP', hcp:12.4, socio:'—',
  club:'Trisquelia Golf Club', cat:'cab' } };

async function telefono(b, o = {}) {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
    permissions:['geolocation'], geolocation:{ latitude:-35.65628, longitude:-63.78597, accuracy:5 } });
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', e => errores.push(e.message));
  const red = { anotar: [], hayRed: o.hayRed !== false };
  await p.addInitScript(d => {
    window.confirm = () => (window.__confirmar !== undefined ? window.__confirmar : true);
    try {
      if (!localStorage.getItem('__sembrado')) {
        localStorage.setItem('__sembrado', '1');
        localStorage.setItem('trisquelia_v1', JSON.stringify(d.socio));
        if (d.ronda) localStorage.setItem('trisquelia_ronda', JSON.stringify(d.ronda));
        if (d.vueltas) localStorage.setItem('trisquelia_vueltas', d.vueltas);
      }
    } catch(e) {}
  }, { socio: o.socio || SOCIO, ronda: o.ronda || null, vueltas: o.vueltas || null });
  await p.route('**/token/anonymous', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ token:'x.y.z', expires_at: Date.now()/1000 + 3600 }) }));
  await p.route('**/rpc/club_estado', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ cancha:null, avisos:[], ahora:new Date().toISOString() }) }));
  await p.route('**/rpc/ronda_estado', r => red.hayRed
    ? r.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify({ jugadores:[], anotaciones:[], ahora:new Date().toISOString() }) })
    : r.abort('internetdisconnected'));
  await p.route('**/rpc/anotar', r => {
    if (!red.hayRed) return r.abort('internetdisconnected');
    red.anotar.push(JSON.parse(r.request().postData() || '{}'));
    r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
  });
  await p.route('https://api.open-meteo.com/**', r => r.abort('internetdisconnected'));
  await p.goto(APP, { waitUntil:'load' });
  await p.waitForTimeout(900);
  return { p, ctx, errores, red };
}

/* OJO CON LAS MAYÚSCULAS: el CSS pone los `h3` en versalitas e `innerText`
   devuelve lo que se VE —"RONDA EN CURSO"—, así que todo lo que es título se
   busca con /i. La primera versión de esta suite no lo hizo y sus
   comprobaciones de AUSENCIA pasaban por la razón equivocada: buscar
   "Ronda en curso" nunca encontraba nada, estuviera o no. Tercera vez que
   pasa en este proyecto (paneltest, capturas del PDF, ésta).
   Y la hoja que se abre desde jugar no se dibuja en #screen sino en #hoja. */
const pantalla = p => p.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g,' '));
const toastTxt = p => p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
const hoja = p => p.evaluate(() => { const e = document.getElementById('hoja');
  return e ? e.innerText.replace(/\s+/g,' ') : ''; });
const ir = (p, tab) => p.evaluate(t => { S.tab = t; render(); }, tab);
/* Anotar un hoyo por el camino de verdad: el que cierra el hoyo. */
const anotar = (p, h, golpes, putts) => p.evaluate(([h, g, pt]) => {
  S.hole = h; R.scores[h] = g; if (pt != null) R.putts[h] = pt; cerrarHoyo();
}, [h, golpes, putts]);
const basura = t => /\b(null|undefined|NaN|Infinity)\b|\[object/.test(t);

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  /* ══ 1 · Una vuelta de práctica, de punta a punta ═════════════════════ */
  console.log('\n1. Una vuelta de práctica, de punta a punta');
  {
    const t = await telefono(b);
    errores.push(...t.errores);
    await t.p.evaluate(() => empezarRonda(true));
    ok(await t.p.evaluate(() => S.playing === true && played().length === 0 && S.hole === 1),
       'empieza vacía, en el hoyo 1');
    await anotar(t.p, 1, 5, 2); await anotar(t.p, 2, 4, 1); await anotar(t.p, 3, 7, 3);
    ok(await t.p.evaluate(() => total() === 16), 'anota tres hoyos: 16 golpes');

    await t.p.evaluate(() => { window.__confirmar = false; finish(); });
    ok(await t.p.evaluate(() => S.playing === true && VUELTAS.length === 0),
       'si faltan hoyos pregunta, y si el socio dice que no, la vuelta sigue');

    await t.p.evaluate(() => { window.__confirmar = true; finish(); });
    ok(await t.p.evaluate(() => S.playing === false), 'terminar la vuelta la termina de verdad');
    ok(await t.p.evaluate(() => VUELTAS.length === 1 && VUELTAS[0].golpes === 16 && VUELTAS[0].hoyos === 3),
       'y queda guardada en Mis rondas: 16 golpes en 3 hoyos');
    /* En el resumen no: la recarga lo taparía. Fuera de él, sí. */
    ok(await t.p.evaluate(() => momentoDeActualizar() === false),
       'en el resumen la app NO se actualiza: la recarga lo taparía');
    ok(await t.p.evaluate(() => { const antes = S.tab; S.tab = 'home';
         const r = momentoDeActualizar(); S.tab = antes; return r === true; }),
       'con la vuelta terminada y fuera del resumen, la app puede tomar una versión nueva');

    const res = await pantalla(t.p);
    ok(/\b16\b/.test(res) && !/31 pts/.test(res) && !/Hoyo 6/.test(res) && !/Hoyo 2 — doble bogey/.test(res),
       'el resumen dice 16 y no inventa: ni "31 pts", ni "Hoyo 6", ni el doble bogey del 2');
    /* Lo esperado se calcula con el par de la propia app, no a ojo: 5 en el 1,
       4 en el 2 y 7 en el 3. El mejor es el que menos se pasó del par y el
       peor el que más. */
    const esperado = await t.p.evaluate(() => {
      const r = d => d<=-2?'eagle':d===-1?'birdie':d===0?'par':d===1?'bogey':d===2?'doble bogey':'+'+d;
      const d = { 1: 5 - par(1), 2: 4 - par(2), 3: 7 - par(3) };
      const hs = [1,2,3].sort((x,y) => d[x]-d[y] || x-y);
      return { mejor:`Hoyo ${hs[0]} — ${r(d[hs[0]])}`, peor:`Hoyo ${hs[2]} — ${r(d[hs[2]])}` };
    });
    ok(res.includes(esperado.mejor) && res.includes(esperado.peor),
       `lo mejor y lo peor salen de la tarjeta: "${esperado.mejor}" y "${esperado.peor}"`);
    ok(/6 putts en 3 hoyos/.test(res), 'los putts son los anotados: 6 en 3 hoyos');
    ok(/1 hoyo con tres putts/.test(res), 'y dice el tres putts del 3');
    ok(!basura(res), 'sin null, NaN ni undefined en el resumen');

    await ir(t.p, 'home');
    ok(!/Ronda en curso/i.test(await pantalla(t.p)), 'Inicio ya no dice "Ronda en curso"');

    await ir(t.p, 'me');
    const yo = await pantalla(t.p);
    ok(/Mis rondas/.test(yo) && /\b16\b/.test(yo) && !/\b84\b/.test(yo),
       'Mis rondas muestra la vuelta de verdad, no las cuatro de ejemplo (84, 79…)');

    /* La siguiente arranca de cero. */
    await ir(t.p, 'arranque');
    ok(!/vuelta sin terminar/i.test(await pantalla(t.p)), 'la pantalla de arranque no pregunta nada: no hay vuelta abierta');
    await t.p.evaluate(() => empezarRonda(true));
    ok(await t.p.evaluate(() => played().length === 0 && Object.keys(R.putts).length === 0 && S.hole === 1),
       'la vuelta siguiente arranca sin los golpes ni los putts de la anterior');
    await t.ctx.close();
  }

  /* ══ 2 · Torneo: la segunda vuelta no arranca firmada ═════════════════ */
  console.log('\n2. Torneo: la segunda vuelta no arranca firmada');
  {
    const t = await telefono(b, { socio: Object.assign({}, SOCIO, { torneo:true, marco:1, meMarca:2 }) });
    errores.push(...t.errores);
    await t.p.evaluate(() => empezarRonda(true));
    for (let h = 1; h <= 9; h++) await anotar(t.p, h, 4);
    await t.p.evaluate(() => { finish(); certificar(); firmarLaOtra(); });
    await t.p.waitForTimeout(200);
    /* Decía "le llegan a Félix al toque, sin caminar hasta la secretaría", y la
       entrega al club no está construida. */
    const antes = await pantalla(t.p);
    ok(/no está conectada/i.test(antes) && !/al toque/i.test(antes),
       'antes de entregar, la firma no promete que la tarjeta le llega al club');
    await t.p.evaluate(() => entregar());
    ok(/no está conectada/i.test(await toastTxt(t.p)), 'y al entregar lo dice de nuevo');
    ok(await t.p.evaluate(() => S.playing === false && VUELTAS.length === 1 && VUELTAS[0].estado === 'entregada'),
       'firmar y entregar termina la vuelta, y queda guardada como entregada');
    await t.p.evaluate(() => empezarRonda(true));
    ok(await t.p.evaluate(() => !S.certifico && !S.firmoLaOtra && !S.entregada && S.presento === null),
       'la vuelta de torneo siguiente arranca sin certificar ni firmar');
    await ir(t.p, 'firma');
    const f = await pantalla(t.p);
    ok(!/Certificada/i.test(f) && !/Firmada como marcador/i.test(f),
       'la pantalla de firma no muestra firmas de la vuelta anterior');
    await t.ctx.close();
  }

  /* ══ 3 · Las vueltas que quedaron abiertas en la v24 ══════════════════ */
  console.log('\n3. Las vueltas que quedaron abiertas en la v24');
  {
    /* Así quedó todo teléfono que jugó alguna vez: jugando para siempre, con
       la tarjeta llena. Al actualizar, nada de eso se puede perder. */
    const viejo = Object.assign({}, SOCIO, { playing:true, hole:4, fecha:'2026-10-20' });
    const t = await telefono(b, { socio: viejo });
    errores.push(...t.errores);
    await t.p.evaluate(() => { R.scores = {1:5, 2:4, 3:6}; guardarTodo(); render(); });
    ok(/Ronda en curso/i.test(await pantalla(t.p)), 'Inicio la muestra como lo que es: una vuelta sin terminar');
    await ir(t.p, 'arranque');
    const a = await pantalla(t.p);
    ok(/Tenés una vuelta sin terminar/i.test(a) && /Seguir con esa/i.test(a) && /Terminarla y empezar otra/i.test(a),
       'la pantalla de arranque pregunta antes de armar otra encima');
    ok(!/Salir a jugar|Empezar el torneo/i.test(a), 'y no deja empezar otra hasta decidir');
    await t.p.evaluate(() => terminarYSeguir());
    ok(await t.p.evaluate(() => VUELTAS.length === 1 && VUELTAS[0].golpes === 15 && VUELTAS[0].fecha === '2026-10-20'),
       'terminarla no la borra: queda en Mis rondas con sus 15 golpes y su fecha');
    ok(await t.p.evaluate(() => S.playing === false), 'y la vuelta queda terminada');
    ok(!/vuelta sin terminar/i.test(await pantalla(t.p)), 'ahora sí deja armar la nueva');
    await t.ctx.close();
  }

  /* ══ 4 · Que no se pierda nada ═════════════════════════════════════════ */
  console.log('\n4. Que no se pierda nada');
  {
    /* Una recarga de Android en el medio de un torneo. */
    const t = await telefono(b, { socio: Object.assign({}, SOCIO, { torneo:true, marco:1, meMarca:2 }) });
    errores.push(...t.errores);
    await t.p.evaluate(() => { empezarRonda(true); OTRO[1] = 5; OTRO[2] = 6; MARCA[1] = 4; guardarTodo(); });
    const p2 = await t.ctx.newPage();
    await p2.goto(APP, { waitUntil:'load' }); await p2.waitForTimeout(700);
    ok(await p2.evaluate(() => OTRO[1] === 5 && OTRO[2] === 6 && MARCA[1] === 4),
       'la tarjeta que llevás del otro y lo que anotó tu marcador sobreviven a una recarga');
    /* La copia lleva lo que HAY: primero tiene que haber una vuelta terminada. */
    await p2.evaluate(() => { R.scores[1] = 4; terminarVuelta(); });
    ok(await p2.evaluate(() => JSON.stringify(datosCopia()).includes('trisquelia_vueltas')),
       'Mis rondas viaja en la copia de seguridad');
    await t.ctx.close();
  }
  {
    /* Una vuelta guardada que llega rota —por ejemplo de una copia importada
       a mano— no entra a la pantalla. */
    const rota = JSON.stringify([
      { fecha:'2026-10-10', golpes:44, alPar:8, hoyos:9, club:'Trisquelia' },
      { fecha:'<img src=x onerror="window.__pwn=1">', golpes:'x', alPar:null, hoyos:9 },
      { fecha:'2026-10-11', golpes:'<b>99</b>', alPar:1, hoyos:9 } ]);
    const t = await telefono(b, { vueltas: rota });
    errores.push(...t.errores);
    await ir(t.p, 'me');
    const yo = await pantalla(t.p);
    ok(/\b44\b/.test(yo) && !/99/.test(yo) && !basura(yo) && !(await t.p.evaluate(() => window.__pwn === 1)),
       'una vuelta guardada rota se descarta: no entra a la pantalla ni se ejecuta');
    await t.ctx.close();
  }
  {
    /* Terminar el 18 sin señal es lo normal en la cancha. Lo que quedó sin
       mandar al grupo tiene que llegar después, y la vuelta siguiente no se
       tiene que mezclar con la ronda vieja. */
    const op = (h, g) => ({ fn:'anotar', clave:`yo|yo|${h}`, t:Date.now(),
      args:{ p_codigo:'ABCDEF', p_llave:'llave-vieja', p_por:'yo', p_de:'yo', p_hoyo:h, p_golpes:g,
             p_putts:null, p_bunker:null, p_penal:null, p_salida_fw:null } });
    const ronda = { codigo:'ABCDEF', yo:'yo', llave:'llave-vieja', jugadores:[], anot:{},
                    cola:[op(8, 5), op(9, 4)], desde:null, marcoA:null };
    const t = await telefono(b, { socio: Object.assign({}, SOCIO, { playing:true, hole:9 }),
                                  ronda, hayRed:false });
    errores.push(...t.errores);
    await t.p.evaluate(() => { R.scores = {1:4,2:4,3:4,4:4,5:4,6:4,7:4,8:5,9:4}; finish(); });
    ok(await t.p.evaluate(() => RONDA === null && _latido === null),
       'al terminar, el teléfono suelta la ronda del grupo y deja de consultar');
    ok(await t.p.evaluate(() => COLA_VIEJA.length === 2
         && JSON.parse(localStorage.getItem('trisquelia_cola_vieja') || '[]').length === 2),
       'lo que no llegó al grupo queda guardado aparte: 2 anotaciones');
    t.red.hayRed = true;
    await t.p.evaluate(() => window.dispatchEvent(new Event('online')));
    await t.p.waitForTimeout(900);
    ok(t.red.anotar.length === 2 && t.red.anotar.every(a => a.p_codigo === 'ABCDEF' && a.p_llave === 'llave-vieja'),
       `cuando vuelve la señal, llega a la ronda vieja con su llave (${t.red.anotar.length} enviadas)`);
    ok(await t.p.evaluate(() => COLA_VIEJA.length === 0 && localStorage.getItem('trisquelia_cola_vieja') === null),
       'y la cola vieja queda vacía');
    await t.p.evaluate(() => empezarRonda(true));
    await anotar(t.p, 1, 6);
    await t.p.waitForTimeout(400);
    ok(t.red.anotar.length === 2, 'la vuelta siguiente, sin ronda del grupo, no le manda nada a la vieja');
    await t.ctx.close();
  }

  /* ══ 5 · El último hoyo ════════════════════════════════════════════════ */
  console.log('\n5. El último hoyo');
  {
    const t = await telefono(b, { socio: Object.assign({}, SOCIO, { playing:true, hole:9 }) });
    errores.push(...t.errores);
    await t.p.evaluate(() => { for (let h = 1; h <= 8; h++) R.scores[h] = 4; S.tab = 'play'; render(); });
    await anotar(t.p, 9, 4);
    ok(await t.p.evaluate(() => S.hoja === 'tarjeta' && S.playing === true),
       'cerrar el último hoyo abre la tarjeta para revisarla y cerrarla, sin dar la vuelta por terminada');
    ok(/Guardar la tarjeta/i.test(await hoja(t.p)), 'y ahí está el botón para terminarla');
    await t.ctx.close();
  }

  /* ══ 6 · Lo que encontró la revisión adversaria ════════════════════════
     Un subagente con la orden de perder o falsear una tarjeta atacó la
     primera versión de la v25, que ya pasaba todo lo de arriba. Cada uno de
     estos casos es un agujero que encontró. */
  console.log('\n6. Lo que encontró la revisión adversaria');
  {
    /* "Jugar" del menú de abajo, después de terminar. */
    const t = await telefono(b);
    errores.push(...t.errores);
    await t.p.evaluate(() => { empezarRonda(true); for (let h=1; h<=9; h++){ S.hole=h; R.scores[h]=5; cerrarHoyo(); } finish(); });
    await t.p.evaluate(() => go('play'));
    ok(await t.p.evaluate(() => S.tab === 'arranque'),
       '"Jugar" del menú con la vuelta terminada lleva a empezar otra, no a la terminada');
    ok(!/Corregir el hoyo/i.test(await pantalla(t.p)), 'y no hay forma de seguir anotando sobre la terminada');
    await t.p.evaluate(() => { S.hole = 1; fijar('sc', 4); });
    ok(await t.p.evaluate(() => S.playing === false), 'anotar un golpe ya no "empieza" una vuelta por la puerta de atrás');

    /* Archivar dos veces la misma vuelta. */
    await t.p.evaluate(() => { archivarVuelta(); archivarVuelta(); });
    ok(await t.p.evaluate(() => VUELTAS.length === 1 && leerLista('trisquelia_vueltas').length === 1),
       'archivar dos veces la misma vuelta no la duplica en Mis rondas');

    /* La firma después de entregar, entrando derecho. */
    await t.p.evaluate(() => go('firma'));
    ok(await t.p.evaluate(() => S.tab !== 'firma'), 'la firma sin vuelta en curso no se abre: no hay nada que entregar dos veces');
    await t.ctx.close();
  }
  {
    /* Sin lugar en el teléfono. */
    const t = await telefono(b);
    errores.push(...t.errores);
    await t.p.evaluate(() => {
      const orig = Storage.prototype.setItem;
      window.__lleno = true;
      Storage.prototype.setItem = function(k, v){
        if (window.__lleno && k === 'trisquelia_vueltas') throw new DOMException('lleno', 'QuotaExceededError');
        return orig.call(this, k, v); };
      empezarRonda(true); for (let h=1; h<=9; h++){ S.hole=h; R.scores[h]=4; cerrarHoyo(); } finish();
    });
    ok(await t.p.evaluate(() => S.playing === true && VUELTAS.length === 0),
       'sin lugar para guardarla, la vuelta NO se termina: sigue abierta');
    ok(/No hay lugar/.test(await toastTxt(t.p)) && !/quedó guardada/.test(await toastTxt(t.p)),
       'y lo dice, en vez de decir "quedó guardada"');
    await t.p.evaluate(() => { window.__lleno = false; finish(); });
    ok(await t.p.evaluate(() => S.playing === false && leerLista('trisquelia_vueltas').length === 1),
       'con lugar otra vez, se termina y se guarda');
    await t.ctx.close();
  }
  {
    /* Una vuelta sin ningún hoyo. */
    const t = await telefono(b);
    errores.push(...t.errores);
    await t.p.evaluate(() => { empezarRonda(true); finish(); });
    ok(/no tenía ningún hoyo/.test(await toastTxt(t.p)), 'terminar sin ningún hoyo no dice "quedó guardada"');
    await t.ctx.close();
  }
  {
    /* Una copia de una versión anterior, sin Mis rondas. */
    const t = await telefono(b);
    errores.push(...t.errores);
    await t.p.evaluate(() => { empezarRonda(true); for (let h=1; h<=9; h++){ S.hole=h; R.scores[h]=5; cerrarHoyo(); } finish(); });
    const vieja = JSON.stringify({ que:'trisquelia-copia', v:1, fecha:new Date().toISOString(),
      datos:{ trisquelia_v1:{ v:1, onboarded:true, tipo:'socio', tee:'mixta', vuelta:9, playing:false,
        user:{ name:'Socio Prueba', ini:'SP', hcp:12.4, socio:'—', club:'x', cat:'cab' } } } });
    await Promise.all([ t.p.waitForNavigation({ waitUntil:'load' }),
                        t.p.evaluate(c => setTimeout(() => aplicarCopia(c), 10), vieja) ]);
    await t.p.waitForTimeout(600);
    ok(await t.p.evaluate(() => VUELTAS.length === 1 && VUELTAS[0].golpes === 45),
       'importar una copia vieja, sin Mis rondas, no las borra: se suman');
    await t.ctx.close();
  }
  {
    /* Una cola vieja con un pedido que el servidor rechaza para siempre. */
    const op = (h, codigo) => ({ fn:'anotar', clave:`yo|yo|${h}`, t:1,
      args:{ p_codigo:codigo, p_llave:'k', p_por:'yo', p_de:'yo', p_hoyo:h, p_golpes:4,
             p_putts:null, p_bunker:null, p_penal:null, p_salida_fw:null } });
    const t = await telefono(b, { hayRed:false });
    errores.push(...t.errores);
    await t.p.unroute('**/rpc/anotar');
    const llegaron = [];
    await t.p.route('**/rpc/anotar', r => {
      const a = JSON.parse(r.request().postData() || '{}');
      if (a.p_codigo === 'MALA00') return r.fulfill({ status:404, contentType:'application/json', body:'{}' });
      llegaron.push(a); r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
    });
    await t.p.evaluate(c => { localStorage.setItem('trisquelia_cola_vieja', JSON.stringify(c)); vaciarColaVieja(); },
                       [op(9, 'MALA00'), op(9, 'BUENA1')]);
    await t.p.waitForTimeout(900);
    ok(llegaron.length === 1 && llegaron[0].p_codigo === 'BUENA1'
       && await t.p.evaluate(() => leerLista('trisquelia_cola_vieja').length === 0),
       'un pedido rechazado para siempre (404) no traba la cola: lo de atrás llega igual');
    await t.ctx.close();
  }
  {
    /* Un pedido colgado cuando la vuelta termina y empieza otra con otro grupo. */
    const t = await telefono(b);
    errores.push(...t.errores);
    await t.p.unroute('**/rpc/anotar');
    let soltar; const colgado = new Promise(k => soltar = k);
    await t.p.route('**/rpc/anotar', async r => { await colgado;
      r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' }); });
    const quedo = await t.p.evaluate(async () => {
      const vieja = { codigo:'VIEJA1', yo:'yo', llave:'k1', jugadores:[], anot:{}, desde:null, marcoA:null,
        cola:[{ fn:'anotar', clave:'v', t:1, args:{ p_codigo:'VIEJA1', p_llave:'k1', p_por:'yo', p_de:'yo', p_hoyo:9, p_golpes:4 } }] };
      RONDA = vieja; const enVuelo = vaciarCola();
      await new Promise(k => setTimeout(k, 150));
      RONDA = { codigo:'NUEVA1', yo:'yo', llave:'k2', jugadores:[], anot:{}, desde:null, marcoA:null,
        cola:[{ fn:'anotar', clave:'n', t:2, args:{ p_codigo:'NUEVA1', p_llave:'k2', p_por:'yo', p_de:'yo', p_hoyo:1, p_golpes:5 } }] };
      window.__enVuelo = enVuelo; return true;
    });
    soltar(); await t.p.evaluate(() => window.__enVuelo); await t.p.waitForTimeout(200);
    ok(await t.p.evaluate(() => RONDA.codigo === 'NUEVA1' && RONDA.cola.some(o => o.args.p_codigo === 'NUEVA1')),
       'un pedido de la ronda vieja que vuelve tarde no le saca nada a la ronda nueva');
    await t.ctx.close();
  }
  {
    /* Una copia armada a mano con HTML y con "__proto__". */
    const armado = Object.assign({}, SOCIO, { playing:true, torneo:true, marco:1, meMarca:2, vueltaId:'x',
      R:{ scores:{ 1:'<img src=x onerror="window.__pwn=1">', 2:4, 99:3 }, putts:{}, fw:{}, gir:{}, shots:{}, bunker:{}, penal:{} } });
    const t = await telefono(b, { socio: armado });
    errores.push(...t.errores);
    await t.p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('trisquelia_v1'));
      d.marca = JSON.parse('{"__proto__":{"1":4,"2":4},"3":"<b>x</b>"}');
      d.otro  = { 1:'<img src=x onerror="window.__pwn=1">', 2:5 };
      localStorage.setItem('trisquelia_v1', JSON.stringify(d));
    });
    const p2 = await t.ctx.newPage(); p2.on('pageerror', e => errores.push(e.message));
    await p2.goto(APP, { waitUntil:'load' }); await p2.waitForTimeout(700);
    await p2.evaluate(() => { S.tab = 'firma'; render(); });
    const r = await p2.evaluate(() => ({ pwn: window.__pwn === 1, proto: Object.getPrototypeOf(MARCA) === Object.prototype,
      sc: JSON.stringify(R.scores), otro: JSON.stringify(OTRO), marca: JSON.stringify(MARCA) }));
    ok(!r.pwn, 'una copia con HTML en la tarjeta no ejecuta nada al abrir la firma');
    ok(r.proto && r.marca === '{}', 'ni le cambia el prototipo a lo que anotó el marcador');
    ok(r.sc === '{"2":4}' && r.otro === '{"2":5}', `lo que no es un número de golpes en un hoyo que existe, no entra (${r.sc} · ${r.otro})`);
    await t.ctx.close();
  }
  {
    /* Una fecha imposible en Mis rondas. */
    const t = await telefono(b, { vueltas: JSON.stringify([{ id:'a', fecha:'2026-13-45', golpes:40, alPar:4, hoyos:9 },
                                                          { id:'b', fecha:'2026-10-11', golpes:41, alPar:5, hoyos:9 },
                                                          { id:'c', fecha:'2026-10-12', golpes:1e21, alPar:0.5, hoyos:9 }]) });
    errores.push(...t.errores);
    await ir(t.p, 'me');
    const yo = await pantalla(t.p);
    ok(/\b41\b/.test(yo) && !/\b40\b/.test(yo) && !/e\+21/.test(yo) && /Mis rondas/i.test(yo),
       'una fecha que no existe o un número imposible se descartan, y Perfil se sigue dibujando');
    await t.ctx.close();
  }
  {
    /* "Borrar todo" borra todo lo de la persona. */
    const t = await telefono(b, { vueltas: JSON.stringify([{ id:'b', fecha:'2026-10-11', golpes:41, alPar:5, hoyos:9 }]) });
    errores.push(...t.errores);
    await Promise.all([ t.p.waitForNavigation({ waitUntil:'load' }),
                        t.p.evaluate(() => setTimeout(() => borrarTodoLocal(), 10)) ]);
    await t.p.waitForTimeout(500);
    ok(await t.p.evaluate(() => !localStorage.getItem('trisquelia_vueltas') && !localStorage.getItem('trisquelia_ronda')),
       '"Borrar todo" se lleva también Mis rondas y la ronda del grupo');
    await t.ctx.close();
  }
  {
    /* Una vuelta que quedó abierta en una versión anterior, con firmas viejas. */
    const t = await telefono(b, { socio: Object.assign({}, SOCIO, { playing:true, torneo:true,
      certifico:true, firmoLaOtra:true, entregada:true, presento:true }) });
    errores.push(...t.errores);
    ok(await t.p.evaluate(() => !!S.vueltaId && !S.certifico && !S.firmoLaOtra && !S.entregada && S.presento === null),
       'una vuelta abierta de una versión anterior pierde las firmas viejas al actualizar, una sola vez');
    await t.ctx.close();
  }
  {
    /* Certificar y después cambiar un golpe. Venía de antes de la v25. */
    const t = await telefono(b, { socio: Object.assign({}, SOCIO, { torneo:true, marco:1, meMarca:2 }) });
    errores.push(...t.errores);
    await t.p.evaluate(() => { empezarRonda(true); for (let h=1; h<=9; h++){ S.hole=h; R.scores[h]=4; OTRO[h]=5; cerrarHoyo(); }
      finish(); certificar(); firmarLaOtra(); });
    await t.p.evaluate(() => { S.hole = 3; fijar('sc', 2); });
    ok(await t.p.evaluate(() => S.certifico === false), 'cambiar un golpe después de certificar descertifica la tarjeta');
    await t.p.evaluate(() => { S.hole = 4; fijar('otro', 6); });
    ok(await t.p.evaluate(() => S.firmoLaOtra === false), 'y cambiar la del otro después de firmarla, la desfirma');
    await t.p.evaluate(() => { S.hole = 5; fijar('sc', 4); });
    ok(await t.p.evaluate(() => { certificar(); S.hole = 5; fijar('sc', 4); return S.certifico === true; }),
       'tocar el mismo número que ya estaba no descertifica nada');
    await t.ctx.close();
  }
  {
    /* La actualización no entra con el cierre del hoyo abierto. */
    const t = await telefono(b);
    errores.push(...t.errores);
    ok(await t.p.evaluate(() => { empezarRonda(true); S.playing = false; S.cerrando = true; S.tab = 'play';
         return momentoDeActualizar() === false; }),
       'con el cierre del hoyo abierto, la app no se actualiza');
    await t.ctx.close();
  }

  console.log(`\n${pasaron} bien · ${fallaron} mal`);
  console.log('Errores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
  process.exit(fallaron ? 1 : 0);
})();
