/* Para correrlo:  node pruebas/<archivo>.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
/* Prueba del modo prueba: que grabe, que sobreviva a un reinicio y que las cuentas cierren. */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const EXE = process.env.CHROME_PATH || undefined;   // si está vacío, Playwright busca solo
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m);

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'],
    geolocation: { latitude: -35.65565, longitude: -63.79215, accuracy: 5 },
    acceptDownloads: true });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });

  await p.addInitScript(() => {
    window.prompt = () => 'El botón de cerrar el hoyo queda muy abajo';
    try { localStorage.setItem('trisquelia_v1', JSON.stringify({ v:1, onboarded:true, tipo:'socio',
      tee:'mixta', vuelta:18, hole:7, playing:true,
      user:{name:'Mauro Domina',ini:'MD',hcp:7.4,socio:'#1',club:'Trisquelia Golf Club',cat:'cab'} })); } catch(e){}
  });
  await p.goto('http://localhost:8000/', { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  console.log('\n1. Prender la prueba');
  await p.evaluate(() => go('prueba'));
  await p.waitForTimeout(400);
  const antes = await p.evaluate(() => document.getElementById('screen').innerText.slice(0, 90).replace(/\s+/g, ' '));
  ok(/Modo prueba/.test(antes), `la pantalla abre · "${antes.slice(0, 60)}…"`);

  await p.evaluate(() => arrancarPrueba());
  await p.waitForTimeout(600);
  const arranco = await p.evaluate(() => ({
    abierta: PRUEBA && PRUEBA.abierta,
    muestras: PRUEBA ? PRUEBA.muestras.length : 0,
    punto: !!document.getElementById('grabando'),
    guardado: !!localStorage.getItem('trisquelia_prueba')
  }));
  ok(arranco.abierta && arranco.muestras >= 1, `graba desde el arranque · ${arranco.muestras} medición`);
  ok(arranco.punto, 'aparece el punto rojo arriba');
  ok(arranco.guardado, 'queda guardado en el teléfono al instante');

  console.log('\n2. En la pantalla de jugar');
  await p.evaluate(() => go('play'));
  await p.waitForTimeout(500);
  const panel = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find(x => /modo prueba/i.test(x.innerText));
    return c ? { txt: c.innerText.replace(/\s+/g, ' ').slice(0, 80),
                 botones: [...c.querySelectorAll('.chip')].map(x => x.innerText.trim()) } : null;
  });
  ok(panel && panel.botones.some(x => x === '150'),
     `el panel de estacas está a mano · botones: ${panel ? panel.botones.join(' ') : '—'}`);

  console.log('\n3. Marcar una estaca');
  const dice = await p.evaluate(() => gps(S.hole).mid);
  await p.evaluate(() => marcarEstaca(150));
  await p.waitForTimeout(400);
  const est = await p.evaluate(() => PRUEBA.estacas[0]);
  ok(est && est.estaca === 150 && est.centro === dice,
     `guardó la estaca de 150 contra lo que decía la app (${est && est.centro}) en el hoyo ${est && est.hoyo}`);
  ok(est && est.acc != null && est.gpsReal === true, `con la precisión del momento (±${est && est.acc} m) y GPS real`);

  console.log('\n4. Anotar algo que molesta');
  await p.evaluate(() => anotarPrueba());
  await p.waitForTimeout(300);
  const nota = await p.evaluate(() => PRUEBA.notas[0]);
  ok(nota && /muy abajo/.test(nota.txt) && nota.hoyo === 7,
     `queda la nota con el hoyo · "${nota && nota.txt.slice(0, 45)}…"`);

  console.log('\n5. Sobrevivir a que el teléfono mate la app');
  await p.evaluate(() => { for (let i = 0; i < 40; i++) muestraPrueba(); });
  await p.waitForTimeout(500);
  const preMuestras = await p.evaluate(() => PRUEBA.muestras.length);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const post = await p.evaluate(() => ({
    abierta: PRUEBA && PRUEBA.abierta,
    muestras: PRUEBA ? PRUEBA.muestras.length : 0,
    reinicios: PRUEBA ? PRUEBA.reinicios : null,
    estacas: PRUEBA ? PRUEBA.estacas.length : 0,
    notas: PRUEBA ? PRUEBA.notas.length : 0,
    punto: !!document.getElementById('grabando')
  }));
  ok(post.abierta && post.muestras >= preMuestras, `sigue grabando después de recargar · ${post.muestras} mediciones`);
  ok(post.reinicios === 1, `cuenta el reinicio (${post.reinicios})`);
  ok(post.estacas === 1 && post.notas === 1, 'no perdió la estaca ni la nota');
  ok(post.punto, 'el punto rojo vuelve solo');

  console.log('\n6. Las cuentas');
  // simulamos un rato sin señal y una caída de batería, para ver si las detecta
  await p.evaluate(() => {
    const t0 = PRUEBA.desde;
    PRUEBA.muestras = [];
    for (let i = 0; i < 90; i++) {
      const sinSenal = (i > 30 && i < 34) || (i > 60 && i < 62);
      PRUEBA.muestras.push({ t: t0 + i * 20000, hoyo: 1 + Math.floor(i / 5), hay: !sinSenal,
        acc: sinSenal ? undefined : 4 + (i % 9), bat: 100 - Math.floor(i / 6) });
    }
    PRUEBA.muestras[70].t += 240000;      // un hueco de 4 minutos: el teléfono durmió
    for (let i = 71; i < 90; i++) PRUEBA.muestras[i].t += 240000;
    guardarPrueba();
  });
  const r = await p.evaluate(() => resumenPrueba());
  ok(r.cortes === 2, `detecta 2 cortes de señal (contó ${r.cortes})`);
  ok(r.huecoMayor === 260, `detecta el hueco largo: ${r.huecoMayor} s`);
  ok(r.conSenal === 96, `${r.conSenal}% del tiempo con señal`);
  ok(r.precision && r.precision.mediana === 8, `precisión típica ±${r.precision && r.precision.mediana} m`);
  ok(r.bateria && r.bateria.caida === 14, `batería: ${r.bateria.desde}% → ${r.bateria.hasta}% (${r.bateria.caida} puntos)`);
  ok(r.bateria && r.bateria.porHora > 0, `gasto por hora: ${r.bateria.porHora}%`);
  ok(r.estacas.marcadas === 1, `1 estaca marcada · diferencia ${r.estacas.errorMedio} yds`);

  console.log('\n7. Terminar y bajar el archivo');
  await p.evaluate(() => pararPrueba());
  await p.waitForTimeout(400);
  ok(await p.evaluate(() => !PRUEBA.abierta && !!PRUEBA.hasta), 'queda cerrada, con hora de fin');
  ok(!(await p.evaluate(() => !!document.getElementById('grabando'))), 'el punto rojo se apaga');

  const [dl] = await Promise.all([
    p.waitForEvent('download'),
    p.evaluate(() => bajarPrueba())
  ]);
  const ruta = '/tmp/' + dl.suggestedFilename();
  await dl.saveAs(ruta);
  const json = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  ok(dl.suggestedFilename() === 'trisquelia-prueba.json', `baja "${dl.suggestedFilename()}" (${fs.statSync(ruta).size} bytes)`);
  ok(json.resumen && json.muestras.length === 90 && json.estacas.length === 1,
     `el archivo trae resumen + ${json.muestras.length} mediciones + ${json.estacas.length} estaca + ${json.notas.length} nota`);
  ok(json.cancha === 'Trisquelia — 18 hoyos (dos vueltas)', `identifica la cancha: "${json.cancha}"`);

  console.log('\n8. La pantalla del resumen');
  await p.evaluate(() => go('prueba'));
  await p.waitForTimeout(500);
  const pant = await p.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g, ' '));
  ok(!/\bnull\b|\bNaN\b|undefined|Infinity/.test(pant), 'sin huecos ni basura en pantalla');
  ok(/el gps/i.test(pant) && /aguanta el tel/i.test(pant) && /estacas/i.test(pant),
     'muestra las tres secciones');
  await p.screenshot({ path: '/tmp/prueba.png', fullPage: false });

  console.log('\n9. Borrar');
  await p.evaluate(() => { window.confirm = () => true; tirarPrueba(); });
  await p.waitForTimeout(400);
  const fin = await p.evaluate(() => ({ p: PRUEBA, ls: localStorage.getItem('trisquelia_prueba'),
    ronda: !!localStorage.getItem('trisquelia_v1') }));
  ok(fin.p === null && fin.ls === null, 'la prueba se borra entera');
  ok(fin.ronda, 'y no se lleva puesta la ronda ni la cuenta');

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
})();
