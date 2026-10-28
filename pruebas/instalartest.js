/* Para correrlo:  node pruebas/instalartest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   No sale a internet: todo lo que no es localhost se corta acá mismo.
   Si Playwright no encuentra Chromium solo, pasale la ruta en CHROME_PATH. */

/* AGREGARLA AL TELÉFONO, ANTES QUE NADA.
   Hasta la v26 el aviso de "agregala a la pantalla de inicio" aparecía en
   Inicio, chico, después de pasar por el alta. Mau lo vio el 28/10/2026, con
   el QR de la reunión en la mano: la gente que escanea tiene que ver eso
   primero, y grande. En iPhone, además, no es comodidad: la app del ícono no
   comparte los datos con Safari, así que el que pone su nombre en el navegador
   y después la agrega arranca de cero en el ícono. Y las instrucciones del
   iPhone estaban viejas: decían "Tocá Compartir abajo", y desde iOS 26 ese
   botón ya no está abajo.

   Lo que cuida esta suite:
   · en un teléfono, en el navegador, lo primero es "Agregala a tu teléfono",
     con los pasos de ese teléfono y la salida a la vista;
   · cuando Chrome habilita el botón de un toque, aparece sin redibujar la
     pantalla, y sin borrarle a nadie lo que está escribiendo;
   · "Ahora no" no vuelve a preguntar, y queda un recordatorio arriba en Inicio;
   · instalada, en el navegador de WhatsApp o en una computadora, no aparece. */

const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = process.env.APP || 'http://localhost:8000/index.html';
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { c ? pasaron++ : fallaron++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

const IPHONE  = devices['iPhone 13'];
const PIXEL   = devices['Pixel 7'];
const SAMSUNG = { ...PIXEL, userAgent: PIXEL.userAgent.replace(/Chrome\/[\d.]+/, 'SamsungBrowser/27.0 Chrome/125.0.0.0') };
const WHATSAPP = { ...PIXEL, userAgent: PIXEL.userAgent + ' WhatsApp/2.24.21.80' };

/* Un teléfono nuevo. `o.antes`: lo que hay guardado; `o.instalada`: abierta
   desde el ícono (se imita la pregunta de "display-mode"). */
async function telefono(b, disp, o = {}) {
  const ctx = await b.newContext({ ...disp });
  await ctx.route(u => u.hostname !== 'localhost', r => r.abort());
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', e => errores.push(e.message));
  await p.addInitScript(d => {
    try {
      if (!localStorage.getItem('__sembrado')) {
        localStorage.setItem('__sembrado', '1');
        if (d.antes) localStorage.setItem('trisquelia_v1', JSON.stringify(d.antes));
      }
    } catch (e) {}
    if (d.instalada) {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = q => /display-mode:\s*standalone/.test(q)
        ? { matches: true, media: q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }
        : mm(q);
    }
  }, { antes: o.antes || null, instalada: !!o.instalada });
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  return { ctx, p, errores };
}
const pantalla = p => p.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g, ' '));
const esPrimera = p => p.evaluate(() => !!document.querySelector('.instPrimero'));
const sinScrollDeCostado = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/* Un botón se ve sin scrollear si su borde de abajo queda adentro de la pantalla. */
const aLaVista = (p, txt) => p.evaluate(t => {
  const bt = [...document.querySelectorAll('#screen button')].find(x => x.innerText.trim() === t);
  if (!bt) return false;
  const r = bt.getBoundingClientRect(), s = document.getElementById('screen').getBoundingClientRect();
  return r.top >= s.top && r.bottom <= s.bottom + 1;
}, txt);
/* El aviso de Chrome, de mentira: cuenta las veces que se pidió. */
const avisoDeChrome = (p, resultado = 'dismissed') => p.evaluate(res => {
  const e = new Event('beforeinstallprompt');
  e.prompt = () => { window.__pidio = (window.__pidio || 0) + 1; };
  e.userChoice = Promise.resolve({ outcome: res });
  window.dispatchEvent(e);
}, resultado);

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  /* ══ 1 · iPhone, recién escaneado el QR ═══════════════════════════ */
  console.log('\n1. iPhone, recién escaneado el QR');
  {
    const t = await telefono(b, IPHONE); errores.push(...t.errores);
    const txt = await pantalla(t.p);
    ok(await esPrimera(t.p) && /Agregala a tu tel[ée]fono/i.test(txt), 'lo primero que ve es "Agregala a tu teléfono"');
    ok(/Toc[áa] Compartir/.test(txt) && /Agregar a inicio/.test(txt), 'con los pasos del iPhone: Compartir y Agregar a inicio');
    ok(/men[úu] de al lado de la direcci[óo]n/.test(txt),
       'y dice dónde está Compartir si no está a la vista (desde iOS 26 no está abajo)');
    ok(/antes de poner tu nombre/.test(txt), 'avisa que conviene hacerlo antes de poner el nombre');
    ok(!/Crear mi cuenta|Ya tengo cuenta/.test(txt), 'la bienvenida espera: primero esto');
    ok(await t.p.evaluate(() => !!document.querySelector('.dibInst svg')), 'los botones a buscar van dibujados');
    ok(await aLaVista(t.p, 'Ahora no, seguir en el navegador'), '"Ahora no" se ve sin scrollear en un iPhone 13');
    ok(await sinScrollDeCostado(t.p), 'no se corre de costado');

    await t.p.getByText('Ahora no, seguir en el navegador').click();
    const bienv = await pantalla(t.p);
    ok(/Ya tengo cuenta/.test(bienv) && !(await esPrimera(t.p)), '"Ahora no" lleva a la bienvenida');
    ok(/C[óo]mo agregarla al tel[ée]fono/.test(bienv), 'y la bienvenida deja volver a los pasos');
    await t.p.reload({ waitUntil: 'load' }); await t.p.waitForTimeout(400);
    ok(!(await esPrimera(t.p)) && await t.p.evaluate(() => S.instalarSalteado === true),
       'al volver a abrir no pregunta de nuevo');
    await t.p.getByText('Cómo agregarla al teléfono').click();
    ok(await esPrimera(t.p), '"Cómo agregarla al teléfono" vuelve a los pasos');

    /* El camino entero de alguien nuevo, hasta Inicio. */
    await t.p.getByText('Ahora no, seguir en el navegador').click();
    await t.p.getByText('Ya tengo cuenta · entrar').click();
    await t.p.fill('#inNombre', 'Ana Prueba');
    await t.p.getByText('Entrar a la app').click();
    await t.p.waitForTimeout(300);
    const ini = await t.p.evaluate(() => {
      const el = document.querySelector('.instalar'), pad = document.querySelector('#screen .pad');
      return { tab: S.tab, hay: !!el, primero: !!pad && pad.firstElementChild === el,
               txt: el ? el.innerText.replace(/\s+/g, ' ') : '' };
    });
    ok(ini.tab === 'home' && ini.hay, 'en Inicio queda el recordatorio');
    ok(ini.primero, 'arriba de todo, antes del handicap');
    ok(/Compartir/.test(ini.txt) && /arranca de cero/.test(ini.txt), 'con los pasos y el aviso de que el ícono arranca de cero');
    await t.p.click('.instalar .x');
    await t.p.reload({ waitUntil: 'load' }); await t.p.waitForTimeout(400);
    ok(await t.p.evaluate(() => !document.querySelector('.instalar')), 'cerrado con la cruz, no vuelve');
    await t.ctx.close();
  }

  /* ══ 2 · Un iPhone chico ══════════════════════════════════════════ */
  console.log('\n2. Un iPhone chico (320 de ancho)');
  {
    const t = await telefono(b, { ...IPHONE, viewport: { width: 320, height: 568 } }); errores.push(...t.errores);
    ok(await esPrimera(t.p) && await sinScrollDeCostado(t.p), 'entra a lo ancho');
    const llega = await t.p.evaluate(() => {
      const s = document.getElementById('screen'); s.style.scrollBehavior = 'auto'; s.scrollTop = s.scrollHeight;
      const bt = [...s.querySelectorAll('button')].find(x => /Ahora no/.test(x.innerText));
      const r = bt.getBoundingClientRect(), q = s.getBoundingClientRect();
      return r.bottom <= q.bottom + 1;
    });
    ok(llega, 'scrolleando se llega a "Ahora no"');
    await t.p.getByText('Ahora no, seguir en el navegador').click();
    await t.p.waitForTimeout(700);                    // el scroll de la app es suave
    const arriba = await t.p.evaluate(() => {
      const s = document.getElementById('screen');
      const img = s.querySelector('img'); const r = img.getBoundingClientRect();
      return { desde: s.scrollTop, entero: r.top >= s.getBoundingClientRect().top - 1 };
    });
    ok(arriba.desde === 0, 'la bienvenida arranca arriba de todo, no por la mitad');
    ok(arriba.entero, 'y no se corta arriba (antes el escudo quedaba afuera, sin poder scrollear)');
    await t.ctx.close();
  }

  /* ══ 3 · Android con Chrome ═══════════════════════════════════════ */
  console.log('\n3. Android con Chrome');
  {
    const t = await telefono(b, PIXEL); errores.push(...t.errores);
    let txt = await pantalla(t.p);
    ok(await esPrimera(t.p), 'lo primero también es "Agregala a tu teléfono"');
    ok(/tres puntitos/.test(txt) && /Agregar a la pantalla principal/.test(txt) && /Instalar app/.test(txt),
       'con los pasos del menú de Chrome, que andan siempre');
    ok(!/antes de poner tu nombre/.test(txt), 'sin el aviso del iPhone: en Android la app instalada comparte los datos');
    ok(await aLaVista(t.p, 'Ahora no, seguir en el navegador'), '"Ahora no" a la vista');

    /* Chrome habilita el botón recién después de un toque y 30 segundos. */
    await t.p.evaluate(() => { document.querySelector('.instPrimero').dataset.marca = 'sigue'; });
    await avisoDeChrome(t.p);
    const r = await t.p.evaluate(() => ({
      marca: (document.querySelector('.instPrimero') || {}).dataset?.marca,
      boton: !!document.querySelector('#comoInstalar .instBtn') }));
    ok(r.boton, 'cuando Chrome lo habilita, aparece el botón de un toque');
    ok(r.marca === 'sigue', 'sin redibujar la pantalla entera');
    await t.p.click('#comoInstalar .instBtn');
    await t.p.waitForTimeout(100);
    ok(await t.p.evaluate(() => window.__pidio === 1), 'el botón le pide a Chrome que la instale');
    ok(await t.p.evaluate(() => !document.querySelector('#comoInstalar .instBtn') && /tres puntitos/.test(document.getElementById('comoInstalar').innerText)),
       'si la persona dice que no, vuelven los pasos del menú (el aviso de Chrome se usa una vez)');

    await t.p.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    txt = await pantalla(t.p);
    ok(/Listo, ya est[áa] en tu pantalla de inicio/.test(txt), 'cuando se instaló, lo dice');
    ok(await t.p.evaluate(() => JSON.parse(localStorage.getItem('trisquelia_v1')).seInstalo === true),
       'y queda anotado en el teléfono');
    await t.p.getByText('Seguir acá igual').click();
    ok(/Ya tengo cuenta/.test(await pantalla(t.p)), '"Seguir acá igual" lleva a la bienvenida');
    ok(!/C[óo]mo agregarla/.test(await pantalla(t.p)), 'y ahí ya no ofrece agregarla');
    await t.ctx.close();
  }

  /* ══ 4 · El botón llega mientras alguien escribe su nombre ════════ */
  console.log('\n4. El aviso de Chrome llega mientras alguien escribe');
  {
    const t = await telefono(b, PIXEL); errores.push(...t.errores);
    await t.p.getByText('Ahora no, seguir en el navegador').click();
    await t.p.getByText('Ya tengo cuenta · entrar').click();
    await t.p.click('#inNombre');
    await t.p.keyboard.type('Ana Pru');
    await avisoDeChrome(t.p);
    const r = await t.p.evaluate(() => ({ v: document.getElementById('inNombre').value,
      foco: document.activeElement && document.activeElement.id }));
    ok(r.v === 'Ana Pru' && r.foco === 'inNombre', 'no le borra lo que venía escribiendo');
    await t.p.keyboard.type('eba');
    await t.p.getByText('Entrar a la app').click();
    await t.p.waitForTimeout(300);
    const ini = await t.p.evaluate(() => ({ nombre: S.user.name,
      boton: !!document.querySelector('.instalar .instBtn') }));
    ok(ini.nombre === 'Ana Prueba', 'entra con su nombre');
    ok(ini.boton, 'y el recordatorio de Inicio ya trae el botón de un toque');
    await t.p.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await t.p.waitForTimeout(200);
    ok(await t.p.evaluate(() => !document.querySelector('.instalar')), 'instalada, el recordatorio se va');
    await t.ctx.close();
  }

  /* ══ 5 · Otros navegadores de Android ═════════════════════════════ */
  console.log('\n5. Otros navegadores de Android');
  {
    const t = await telefono(b, SAMSUNG); errores.push(...t.errores);
    const txt = await pantalla(t.p);
    ok(await esPrimera(t.p) && /men[úu] del navegador/.test(txt) && /pantalla de inicio/.test(txt),
       'el de Samsung tiene pasos generales, no los del menú de Chrome');
    ok(!/Agregar a la pantalla principal/.test(txt), 'sin nombrar un botón que ahí no existe');
    await t.ctx.close();
  }

  /* ══ 6 · Donde no tiene que aparecer ═════════════════════════════ */
  console.log('\n6. Donde no tiene que aparecer');
  {
    let t = await telefono(b, IPHONE, { instalada: true }); errores.push(...t.errores);
    ok(!(await esPrimera(t.p)) && /Ya tengo cuenta/.test(await pantalla(t.p)),
       'abierta desde el ícono, va derecho a la bienvenida');
    ok(!/C[óo]mo agregarla/.test(await pantalla(t.p)), 'sin ofrecer agregarla otra vez');
    await t.ctx.close();

    t = await telefono(b, WHATSAPP); errores.push(...t.errores);
    ok(/Abrila en el navegador/.test(await pantalla(t.p)), 'desde WhatsApp, primero le dice que salga al navegador');
    await t.p.getByText('Seguir igual, sin GPS').click();
    ok(!(await esPrimera(t.p)) && /Ya tengo cuenta/.test(await pantalla(t.p)),
       'y si sigue igual, no le pide algo que ahí no se puede');
    await t.ctx.close();

    t = await telefono(b, { viewport: { width: 1280, height: 800 } }); errores.push(...t.errores);
    ok(!(await esPrimera(t.p)) && /Ya tengo cuenta/.test(await pantalla(t.p)), 'en una computadora, tampoco');
    await t.ctx.close();
  }

  /* ══ 7 · Lo guardado entra sano ══════════════════════════════════ */
  console.log('\n7. Lo guardado entra sano');
  {
    const t = await telefono(b, PIXEL, { antes: { v: 1, instalarSalteado: '<img src=x onerror=alert(1)>', seInstalo: 'si' } });
    errores.push(...t.errores);
    ok(await t.p.evaluate(() => S.instalarSalteado === false && S.seInstalo === false),
       'un valor que no es sí o no, es no');
    ok(await esPrimera(t.p), 'y la pantalla de agregarla aparece igual');
    await t.ctx.close();
  }

  /* ══ 8 · Ninguna instrucción vieja ════════════════════════════════ */
  console.log('\n8. Ninguna instrucción vieja');
  {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    const fuente = await (await p.request.get(APP)).text();
    ok(!/Compartir(<\/b>)?\s+abajo/.test(fuente), 'ya no dice "Tocá Compartir abajo" (desde iOS 26 no está ahí)');
    await ctx.close();
  }

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  console.log(`\n${pasaron} ✓ · ${fallaron} ✗`);
  await b.close();
  process.exitCode = fallaron || errores.length ? 1 : 0;
})();
