/* Para correrlo:  node pruebas/afueratest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   No habla con ningún servidor de verdad: Neon y Open-Meteo se imitan acá
   mismo, interceptando los pedidos. Si Playwright no encuentra Chromium solo,
   pasale la ruta en CHROME_PATH. */

/* LO QUE LLEGA DE AFUERA.
   Dos cosas le llegan solas a la app, sin que el socio toque nada: lo que
   dice el club (estado de cancha y avisos) y el clima. Esta suite cuida las
   dos mitades del mismo trato:

   · LO QUE LLEGA, SE VE. Hasta la v22 el estado del club se pedía al abrir,
     pero la pantalla ya estaba dibujada cuando llegaba la respuesta y nadie la
     volvía a dibujar: el dato quedaba en memoria y la pantalla seguía diciendo
     "El club todavía no publicó el estado". Lo encontró una medición del
     23/10/2026, preparando la presentación a la comisión. En el teléfono de
     Mauro se veía bien sólo porque ya tenía el dato guardado de antes.

   · LO QUE NO LLEGÓ, SE DICE. Sin respuesta no se afirma nada: ni que el club
     no publicó, ni una temperatura, ni una dirección de viento. Y un dato
     viejo se muestra con su hora o no se muestra. */

const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { c ? pasaron++ : fallaron++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

const SOCIO = { v:1, onboarded:true, tipo:'socio', tee:'mixta', vuelta:18, hole:1, playing:false,
  user:{ name:'Socio Prueba', ini:'SP', hcp:12.4, socio:'—', club:'Trisquelia Golf Club', cat:'cab' } };
const COMISION = { llave:'x'.repeat(64), puesto:'Administración', persona:'Socio Prueba', rol:'admin',
  permisos:['salidas','result','torneos','avisos','cancha','padron','cuotas','admin'] };

/* Lo que contestaría Open-Meteo. La forma sale de su documentación: un objeto
   `current` con un número por cada variable pedida. */
const METEO = {
  bueno:   { temperature_2m:22.4, weather_code:3, wind_speed_10m:18.3, wind_direction_10m:45,  wind_gusts_10m:24.0 },
  calmo:   { temperature_2m:15.0, weather_code:0, wind_speed_10m:1.2,  wind_direction_10m:0,   wind_gusts_10m:3.1 },
  rafagas: { temperature_2m:19.0, weather_code:2, wind_speed_10m:18.0, wind_direction_10m:225, wind_gusts_10m:41.0 },
  veneno:  { temperature_2m:'<img src=x onerror="window.__pwn=1">', weather_code:3,
             wind_speed_10m:10, wind_direction_10m:90, wind_gusts_10m:12 }
};

async function telefono(b, o = {}) {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', e => errores.push(e.message));
  const meteo = { pedidos:[] };
  await p.addInitScript(d => {
    window.confirm = () => true;
    try {
      localStorage.setItem('trisquelia_v1', JSON.stringify(d.socio));
      if (d.comision) localStorage.setItem('trisquelia_comision', JSON.stringify(d.comision));
      if (d.climaGuardado) localStorage.setItem('trisquelia_clima', JSON.stringify(d.climaGuardado));
    } catch(e) {}
  }, { socio: o.socio || SOCIO, comision: o.comision || null, climaGuardado: o.climaGuardado || null });

  /* Neon: el token anónimo y club_estado. `respuestas` es una lista: cada
     pedido se lleva la siguiente, y la última se repite. */
  await p.route('**/token/anonymous', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ token:'x.y.z', expires_at: Date.now()/1000 + 3600 }) }));
  const club = o.club || ['nada'];
  let nClub = 0;
  await p.route('**/rpc/club_estado', async r => {
    const que = club[Math.min(nClub++, club.length - 1)];
    if (que === 'caido') return r.abort('internetdisconnected');
    await new Promise(k => setTimeout(k, o.demoraClub ?? 300));
    const cancha = que === 'nada' ? null
      : { abierta: que === 'abierta', nota: que === 'abierta' ? 'Juegan normal' : 'Lluvia',
          por:'Chelo', desde:new Date().toISOString() };
    r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ cancha, avisos:[], ahora:new Date().toISOString() }) });
  });

  /* Open-Meteo. */
  await p.route('https://api.open-meteo.com/**', async r => {
    meteo.pedidos.push(r.request().url());
    const que = o.clima || 'caido';
    if (que === 'caido') return r.abort('internetdisconnected');
    await new Promise(k => setTimeout(k, o.demoraClima ?? 300));
    if (que === 'error200') return r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ error:true, reason:'Parameter error' }) });
    if (que === 'sincurrent') return r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ latitude:-35.6, longitude:-63.8 }) });
    r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ latitude:-35.625, longitude:-63.75,
        current: Object.assign({ time:'2026-10-23T14:00', interval:900 }, METEO[que]) }) });
  });

  await p.goto(APP, { waitUntil:'load' });
  return { p, ctx, errores, meteo };
}

/* El texto de una tarjeta de Inicio, por su título (sin distinguir
   mayúsculas: el CSS pone los títulos en versalitas y `innerText` devuelve
   lo que se VE). */
const tarjeta = (p, titulo) => p.evaluate(t => {
  const c = [...document.querySelectorAll('#screen .card')]
    .find(e => e.innerText.toLowerCase().includes(t));
  return c ? c.innerText.replace(/\s+/g,' ').trim() : '(no está la tarjeta)';
}, titulo.toLowerCase());
const cancha = p => tarjeta(p, 'estado de la cancha');
const clima  = p => tarjeta(p, 'clima en cancha');
const basura = t => /\b(null|undefined|NaN|Infinity)\b|\[object/.test(t);
const conNumero = t => /-?\d+\s*°|km\/h/.test(t);

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  /* ══ 1 · Lo que dice el club aparece apenas llega ════════════════════ */
  console.log('\n1. Lo que dice el club aparece apenas llega');
  {
    const t = await telefono(b, { club:['cerrada'], demoraClub:900 });
    errores.push(...t.errores);
    await t.p.waitForTimeout(250);
    const mientras = await cancha(t.p);
    ok(/Preguntando al club/.test(mientras) && !/no publicó/.test(mientras),
       `mientras pregunta dice "Preguntando al club…" y no afirma nada (${mientras})`);
    await t.p.waitForTimeout(1800);
    const despues = await cancha(t.p);
    ok(/Cerrada/.test(despues) && /Lluvia/.test(despues) && /Chelo/.test(despues),
       `al llegar se ve solo, sin tocar nada: "Cerrada · Lluvia · Chelo" (${despues})`);
    await t.ctx.close();
  }
  {
    const t = await telefono(b, { club:['nada'] });
    errores.push(...t.errores);
    await t.p.waitForTimeout(1200);
    ok(/El club todavía no publicó el estado/.test(await cancha(t.p)),
       'si el servidor contesta que no hay nada, recién ahí dice "todavía no publicó"');
    await t.ctx.close();
  }
  {
    const t = await telefono(b, { club:['caido'] });
    errores.push(...t.errores);
    await t.p.waitForTimeout(1200);
    const txt = await cancha(t.p);
    ok(/Hace falta señal/.test(txt) && !/no publicó/.test(txt),
       `sin señal y sin nada guardado dice que hace falta señal, no que el club no publicó (${txt})`);
    await t.ctx.close();
  }
  {
    /* En el panel, la nota de la cancha es un campo de texto. Un redibujo
       mientras alguien la escribe le borraría lo tecleado. */
    const t = await telefono(b, { club:['abierta', 'cerrada'], comision:COMISION });
    errores.push(...t.errores);
    await t.p.waitForTimeout(900);
    await t.p.evaluate(() => { S.mode = 'club'; S.tab = 'dash'; render(); });
    await t.p.waitForTimeout(300);
    await t.p.click('#notaCancha');
    await t.p.fill('#notaCancha', 'Aireación de greens hasta el');
    await t.p.evaluate(() => traerClubYDibujar(true));
    await t.p.waitForTimeout(900);
    const sigue = await t.p.evaluate(() => {
      const i = document.getElementById('notaCancha'); return i ? i.value : null; });
    ok(sigue === 'Aireación de greens hasta el',
       `en el panel, si llega un cambio mientras se escribe la nota, no se la borra (quedó "${sigue}")`);
    await t.ctx.close();
  }

  {
    /* Alguien que abre la app por primera vez ve la bienvenida, no Inicio.
       Cuando llegan los datos no hay nada que mostrar ahí, y redibujarla la
       hace parpadear: es la primera pantalla que ve, y la de la demo. */
    const t = await telefono(b, { club:['cerrada'], clima:'bueno', demoraClub:600, demoraClima:500,
      socio:{ v:1, onboarded:false, user:{ name:null, ini:null, hcp:null } } });
    errores.push(...t.errores);
    await t.p.waitForTimeout(350);
    await t.p.evaluate(() => { const e = document.querySelector('#screen .fade'); if (e) e.__marca = 1; });
    await t.p.waitForTimeout(1600);
    const quieta = await t.p.evaluate(() => {
      const e = document.querySelector('#screen .fade'); return !!(e && e.__marca); });
    ok(quieta, 'la bienvenida no se redibuja sola cuando llegan los datos de afuera');
    /* Y al entrar, lo que llegó mientras tanto está. */
    await t.p.getByText('Ya tengo cuenta · entrar').click();
    await t.p.fill('#inNombre', 'Socio Prueba');
    await t.p.getByText('Entrar a la app').click();
    await t.p.waitForTimeout(400);
    const c = await cancha(t.p), k = await clima(t.p);
    ok(/Cerrada/.test(c) && /\b22°/.test(k),
       `al terminar el alta ya está todo lo que llegó: "Cerrada" y "22°" (${c} · ${k})`);
    await t.ctx.close();
  }

  /* ══ 2 · El clima, cuando hay ══════════════════════════════════════════ */
  console.log('\n2. El clima, cuando hay');
  {
    const t = await telefono(b, { clima:'bueno', demoraClima:500 });
    errores.push(...t.errores);
    await t.p.waitForTimeout(200);
    ok(/Preguntando/.test(await clima(t.p)), 'mientras pregunta, lo dice');
    await t.p.waitForTimeout(1500);
    const txt = await clima(t.p);
    ok(/\b22°/.test(txt), `aparece solo, con la temperatura redondeada: 22° (${txt})`);
    ok(/Nublado/.test(txt), 'el cielo en palabras: el código 3 es "Nublado"');
    ok(/Viento del NE 18 km\/h/.test(txt), 'el viento dice de dónde VIENE: 45° es "del NE"');
    ok(!/ráfagas/.test(txt), 'ráfagas de 24 con 18 de viento no se mencionan: es ruido');
    ok(await t.p.evaluate(() => [...document.querySelectorAll('#screen a')]
         .some(a => a.href.replace(/\/$/,'') === 'https://open-meteo.com' && /Open-Meteo/i.test(a.innerText))),
       'está el link a open-meteo.com que pide la licencia CC BY');
    const u = new URL(t.meteo.pedidos[0] || 'http://x/');
    const lat = +u.searchParams.get('latitude'), lon = +u.searchParams.get('longitude');
    ok(Math.abs(lat + 35.655) < 0.01 && Math.abs(lon + 63.789) < 0.01,
       `le pregunta por el centro de la cancha medida (${lat}, ${lon})`);
    ok(!basura(txt), 'sin null, NaN ni undefined');

    /* Volver a la app enseguida no vuelve a preguntar: el dato se renueva
       cada 15 minutos y preguntar antes es gastar batería.
       Se cuentan los pedidos NUEVOS, no el total: la primera vez que se abre
       la app, el service worker se instala, toma el control y la página se
       recarga una vez sola (`controllerchange` → `location.reload()`), así que
       una instalación nueva hace dos pedidos al arrancar —uno por cada carga—
       y eso no es el freno fallando. La primera versión de esta prueba contaba
       el total y daba rojo por eso. */
    const yaHabia = t.meteo.pedidos.length;
    await t.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await t.p.evaluate(() => window.dispatchEvent(new Event('online')));
    await t.p.waitForTimeout(800);
    const nuevos = t.meteo.pedidos.length - yaHabia;
    ok(yaHabia >= 1 && nuevos === 0,
       `volver a la app no pregunta de nuevo antes de 15 minutos (${nuevos} pedido/s nuevo/s)`);

    ok(await t.p.evaluate(() => !JSON.stringify(datosCopia()).includes('"temp"')),
       'el clima no viaja en la copia de seguridad');
    await t.ctx.close();
  }
  {
    const t = await telefono(b, { clima:'calmo' });
    errores.push(...t.errores);
    await t.p.waitForTimeout(1300);
    const txt = await clima(t.p);
    ok(/Sin viento/.test(txt) && !/Viento del/.test(txt),
       `con viento calmo no inventa dirección: "Sin viento", no "del N" (${txt})`);
    ok(/Despejado/.test(txt), 'el código 0 es "Despejado"');
    await t.ctx.close();
  }
  {
    const t = await telefono(b, { clima:'rafagas' });
    errores.push(...t.errores);
    await t.p.waitForTimeout(1300);
    const txt = await clima(t.p);
    ok(/Viento del SO 18 km\/h, ráfagas de 41/.test(txt),
       `con ráfagas fuertes las dice, y 225° es "del SO" (${txt})`);
    await t.ctx.close();
  }

  /* ══ 3 · El clima, cuando no hay ═══════════════════════════════════════ */
  console.log('\n3. El clima, cuando no hay');
  for (const [modo, que] of [['caido', 'sin señal y sin nada guardado'],
                             ['error200', 'con un 200 que trae {error}'],
                             ['sincurrent', 'con una respuesta sin "current"']]) {
    const t = await telefono(b, { clima: modo });
    errores.push(...t.errores);
    await t.p.waitForTimeout(1300);
    const txt = await clima(t.p);
    ok(/Sin datos/.test(txt) && !conNumero(txt) && !basura(txt),
       `${que}: "Sin datos", ningún número inventado (${txt})`);
    await t.ctx.close();
  }
  {
    const t = await telefono(b, { clima:'veneno' });
    errores.push(...t.errores);
    await t.p.waitForTimeout(1300);
    const txt = await clima(t.p);
    const pwn = await t.p.evaluate(() => window.__pwn === 1);
    ok(!pwn && /Sin datos/.test(txt),
       'si en vez de un número llega HTML, no entra a la pantalla ni se ejecuta');
    await t.ctx.close();
  }
  {
    const hace20 = Date.now() - 20 * 60e3;
    const t = await telefono(b, { clima:'caido',
      climaGuardado:{ temp:17.6, cod:1, kmh:12, grados:180, rafaga:null, hora:hace20 } });
    errores.push(...t.errores);
    await t.p.waitForTimeout(1300);
    const txt = await clima(t.p);
    ok(/\b18°/.test(txt) && /hace 20 min/.test(txt) && /Viento del S 12/.test(txt),
       `un dato de hace 20 minutos, sin señal, se muestra con su hora (${txt})`);
    await t.ctx.close();
  }
  {
    const hace4h = Date.now() - 4 * 3600e3;
    const t = await telefono(b, { clima:'caido',
      climaGuardado:{ temp:31, cod:0, kmh:5, grados:90, rafaga:null, hora:hace4h } });
    errores.push(...t.errores);
    await t.p.waitForTimeout(1300);
    const txt = await clima(t.p);
    ok(/Sin datos recientes/.test(txt) && !/31°/.test(txt),
       `un dato de hace 4 horas no se muestra: el clima de la mañana no es el de ahora (${txt})`);
    await t.ctx.close();
  }

  console.log(`\n${pasaron} bien · ${fallaron} mal`);
  console.log('Errores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
  process.exit(fallaron ? 1 : 0);
})();
