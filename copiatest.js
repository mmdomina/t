/* Para correrlo:  node pruebas/copia-test.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
/* La copia de seguridad: sacarla del teléfono y volver a meterla. */
const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m);

const SEMILLA = {
  v:1, ts:Date.now(), onboarded:true, tipo:'socio', tee:'mixta', vuelta:18, hole:7,
  R:{ scores:{1:4,2:5,3:3,4:6}, putts:{1:2}, fw:{}, gir:{}, shots:{}, bunker:{}, penal:{} },
  user:{ name:'Mauro Domina', ini:'MD', hcp:7.4, socio:'—', club:'Trisquelia Golf Club', cat:'cab' }
};

/* aplicarCopia() recarga la página. Si lo llamamos derecho, el evaluate muere
   con "execution context destroyed": lo disparamos en un setTimeout y esperamos
   la navegación. */
async function importar(p, texto) {
  await Promise.all([
    p.waitForNavigation({ waitUntil: 'load' }),
    p.evaluate(t => { setTimeout(() => aplicarCopia(t), 0); }, texto)
  ]);
  await p.waitForTimeout(900);
}

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const ctx = await b.newContext({ ...devices['Pixel 7'], acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });

  /* addInitScript corre en CADA carga, y esta suite recarga tres veces (importar y
     deshacer). Si sembrara siempre, pisaría justo lo que se acaba de restaurar y la
     prueba se mentiría sola. Sembramos sólo cuando el teléfono está vacío. */
  await p.addInitScript(s => {
    window.confirm = () => true;
    try {
      if (!localStorage.getItem('trisquelia_v1'))
        localStorage.setItem('trisquelia_v1', JSON.stringify(s));
    } catch (e) {}
  }, SEMILLA);
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { S.tab = 'copia'; render(); });

  console.log('\n1. La copia que sale');
  const c = await p.evaluate(() => datosCopia());
  ok(c.que === 'trisquelia-copia' && c.v === 1, 'lleva marca y número de versión');
  ok(!!c.fecha && !!c.club && !!c.telefono, 'lleva fecha, club y qué teléfono la hizo');
  ok(!!c.datos['trisquelia_v1'], 'trae la cuenta, la bolsa y la ronda en curso');
  ok(c.datos['trisquelia_dispositivo'] === undefined,
     'NO se lleva el identificador del teléfono (dos teléfonos no pueden ser el mismo)');
  const r = await p.evaluate(() => resumenCopia(datosCopia()));
  ok(r.cuenta === 'Mauro Domina' && r.hoyos === 4,
     `el resumen dice qué hay adentro: ${r.cuenta} · ${r.hoyos} hoyos · ${r.palos} palos`);

  console.log('\n2. Los cuatro caminos para sacarla');
  const compartido = await p.evaluate(async () => {
    let visto = null;
    navigator.canShare = () => true;
    navigator.share = d => { visto = { n: d.files[0].name, size: d.files[0].size }; return Promise.resolve(); };
    await compartirCopia();
    return visto;
  });
  ok(compartido && /^trisquelia-copia-\d{4}-\d{2}-\d{2}\.json$/.test(compartido.n),
     `compartir manda "${compartido && compartido.n}"`);
  ok(compartido && compartido.size > 200, `y pesa ${compartido && compartido.size} bytes`);

  const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => bajarCopia())]);
  ok(/^trisquelia-copia-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()),
     `bajar el archivo lo nombra con la fecha: ${dl.suggestedFilename()}`);

  await p.evaluate(() => copiarCopia());
  await p.waitForTimeout(300);
  const pegado = await p.evaluate(() => navigator.clipboard.readText());
  ok(pegado.includes('"trisquelia-copia"'), 'copiar al portapapeles deja la copia entera');

  await p.evaluate(() => { S.verCopia = false; verCopiaTexto(); });
  const enPantalla = await p.evaluate(() => { const t = document.getElementById('salidaCopia'); return t ? t.value.length : 0; });
  ok(enPantalla > 200, `ver el texto muestra ${enPantalla} caracteres para copiar a mano`);
  await p.evaluate(() => verCopiaTexto());
  ok(await p.evaluate(() => !document.getElementById('salidaCopia')), 'y se cierra tocando de nuevo');

  console.log('\n3. Traerla de vuelta');
  const guardada = await p.evaluate(() => copiaEnTexto());
  const idAntes = await p.evaluate(() => localStorage.getItem('trisquelia_dispositivo'));
  /* Ensuciamos el teléfono: otro nombre y otra tarjeta. */
  await p.evaluate(() => {
    S.user.name = 'Otro Socio'; R.scores = { 1: 9 }; guardarTodo();
  });
  const sucio = await p.evaluate(() => resumenCopia(datosCopia()));
  ok(sucio.cuenta === 'Otro Socio' && sucio.hoyos === 1, 'ensuciamos el teléfono a propósito');

  await importar(p, guardada);
  const vuelto = await p.evaluate(() => ({ nombre: S.user.name, hoyos: Object.keys(R.scores).length,
    hole: S.hole, id: localStorage.getItem('trisquelia_dispositivo') }));
  ok(vuelto.nombre === 'Mauro Domina', 'la copia devuelve la cuenta');
  ok(vuelto.hoyos === 4, 'y los cuatro hoyos anotados');
  ok(vuelto.hole === 7, 'y en qué hoyo iba');
  ok(vuelto.id === idAntes, 'el teléfono que importa conserva SU identificador');

  console.log('\n4. Deshacer');
  ok(await p.evaluate(() => hayDeshacer()), 'quedó guardado cómo estaba antes de importar');
  await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.evaluate(() => { setTimeout(() => deshacerCopia(), 0); })]);
  await p.waitForTimeout(900);
  const deshecho = await p.evaluate(() => ({ nombre: S.user.name, hoyos: Object.keys(R.scores).length }));
  ok(deshecho.nombre === 'Otro Socio' && deshecho.hoyos === 1, 'volver atrás recupera lo que había');
  ok(!await p.evaluate(() => hayDeshacer()), 'y el respaldo se consume: no se deshace dos veces');

  console.log('\n5. Lo que NO se importa');
  await p.evaluate(() => { S.tab = 'copia'; render(); });
  const antes = await p.evaluate(() => S.user.name);
  const malos = [
    ['{no es json', 'un archivo que no se entiende'],
    [JSON.stringify({ hola: 1 }), 'un JSON que no es una copia de Trisquelia'],
    [JSON.stringify({ que: 'trisquelia-copia', v: 99, datos: { trisquelia_v1: { v: 1 } } }), 'una copia de una versión más nueva'],
    [JSON.stringify({ que: 'trisquelia-copia', v: 1, datos: {} }), 'una copia sin nada adentro'],
    [JSON.stringify({ que: 'trisquelia-copia', v: 1 }), 'una copia sin el campo datos']
  ];
  for (const [texto, que] of malos) {
    const res = await p.evaluate(t => aplicarCopia(t), texto);
    ok(res === false, `rechaza ${que}`);
  }
  ok(await p.evaluate(() => S.user.name) === antes, 'y ninguno tocó lo que había en el teléfono');

  console.log('\n6. Nada se rompió');
  const pantalla = await p.evaluate(() => document.getElementById('screen').innerText);
  ok(!/\bnull\b|\bNaN\b|undefined|Infinity|\[object/.test(pantalla), 'la pantalla sin basura');

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
})();
