/* Para correrlo:  node pruebas/<archivo>.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
/* Dos teléfonos jugando la misma vuelta. */
const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;   // si está vacío, Playwright busca solo
const APP = 'http://localhost:8000/';
const MOCK = 'http://localhost:8100';
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m);
const esperar = ms => new Promise(r => setTimeout(r, ms));

/* Espera hasta que la condición se cumpla en la página, o se rinde. */
async function hasta(p, fn, arg, tope = 14000) {
  const t0 = Date.now();
  while (Date.now() - t0 < tope) {
    if (await p.evaluate(fn, arg)) return true;
    await esperar(250);
  }
  return false;
}

(async () => {
  await fetch(MOCK + '/__test?reset=1');
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  /* un teléfono: cuenta creada, servidor apuntando al falso */
  const telefono = async (nombre, ini) => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'],
      geolocation: { latitude: -35.65565, longitude: -63.79215, accuracy: 5 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errores.push(`${nombre}: ${e.message}`));
    p.on('console', m => { const x = m.text();
      // los cortes de red los provocamos nosotros en el paso 7: no cuentan
      if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(x))
        errores.push(`${nombre}: ${x}`); });
    await p.addInitScript(([n, i]) => {
      window.confirm = () => true;
      try { localStorage.setItem('trisquelia_v1', JSON.stringify({ v:1, onboarded:true, tipo:'socio',
        tee:'mixta', vuelta:18, hole:1, torneo:true,
        user:{ name:n, ini:i, hcp:7.4, socio:'#1', club:'Trisquelia Golf Club', cat:'cab' } })); } catch(e){}
    }, [nombre, ini]);
    await p.goto(APP, { waitUntil: 'load' });
    await p.waitForTimeout(1200);
    await p.evaluate(u => { NUBE.url = u; NUBE.llave = 'llave-de-prueba'; }, MOCK);
    return { ctx, p, nombre };
  };

  console.log('\n1. Uno abre la ronda, el otro entra con el código');
  const A = await telefono('Mauro Domina', 'MD');
  const B = await telefono('Félix Córdoba', 'FC');

  await A.p.evaluate(() => crearRonda());
  ok(await hasta(A.p, () => !!(RONDA && RONDA.codigo)), 'el primero abre la ronda');
  const codigo = await A.p.evaluate(() => RONDA.codigo);
  ok(/^[A-Z2-9]{6}$/.test(codigo), `código de seis letras dictables: ${codigo}`);

  await B.p.evaluate(c => { S.codigoIn = c; unirseRonda(); }, codigo);
  ok(await hasta(B.p, () => !!(RONDA && RONDA.codigo)), 'el segundo entra con ese código');

  ok(await hasta(A.p, () => (RONDA.jugadores || []).length === 2),
     'el primero ve al segundo aparecer, sin recargar nada');
  const nombres = await A.p.evaluate(() => RONDA.jugadores.map(j => j.nombre).sort());
  ok(nombres.length === 2, `en el grupo: ${nombres.join(' y ')}`);

  console.log('\n2. Un código que no existe');
  const C = await telefono('Chelo Caballero', 'CC');
  await C.p.evaluate(() => { S.codigoIn = 'ZZZZZZ'; unirseRonda(); });
  await esperar(1200);
  ok(await C.p.evaluate(() => RONDA === null), 'no lo deja entrar a una ronda inventada');
  await C.ctx.close();

  console.log('\n3. Elegir quién le lleva la tarjeta a quién');
  const idA = await A.p.evaluate(() => RONDA.yo);
  const idB = await B.p.evaluate(() => RONDA.yo);
  await A.p.evaluate(id => elegirAQuienMarco(id), idB);   // A anota la de B
  await B.p.evaluate(id => elegirAQuienMarco(id), idA);   // B anota la de A
  ok(await hasta(B.p, i => (RONDA.jugadores || []).some(j => j.id === i && j.marca_a === RONDA.yo), idA),
     'cada uno ve en su teléfono quién lo está marcando');

  console.log('\n4. Lo que carga uno aparece en el otro');
  await A.p.evaluate(() => { R.scores[1] = 4; R.putts[1] = 2; OTRO[1] = 5; cerrarHoyo(); });
  ok(await hasta(B.p, () => {
    const c = cruceHoyo(1); return !!c;
  }), 'lo que anotó el marcador llega al otro teléfono');
  const visto = await B.p.evaluate(() => cruceHoyo(1));
  ok(visto.golpes === 5 && /Mauro/.test(visto.quien),
     `el segundo ve que su marcador le puso ${visto.golpes} en el hoyo 1`);

  console.log('\n5. El cruce: cuando no coinciden');
  await B.p.evaluate(() => { R.scores[1] = 4; cerrarHoyo(); });   // él dice 4, su marcador puso 5
  await esperar(400);
  const dif = await B.p.evaluate(() => cruceHoyo(1));
  ok(dif && dif.coincide === false && dif.mio === 4 && dif.golpes === 5,
     `avisa la diferencia en el hoyo: él ${dif.mio}, su marcador ${dif.golpes}`);
  const aviso = await B.p.evaluate(() => { S.hole = 1; go('play');
    return document.getElementById('screen').innerText.replace(/\s+/g, ' '); });
  ok(/No coinciden en el hoyo 1/.test(aviso), 'y lo muestra en la pantalla de jugar, no al final');

  console.log('\n6. Corregir y que quede en paz');
  await B.p.evaluate(() => { R.scores[1] = 5; cerrarHoyo(); });
  await esperar(400);
  const arreglado = await B.p.evaluate(() => cruceHoyo(1));
  ok(arreglado.coincide === true, 'al corregir, el cruce queda coincidiendo');
  ok(await hasta(A.p, () => {
    const sc = scoresDe(RONDA.jugadores.find(j => j.id !== RONDA.yo).id);
    return sc[1] && sc[1].golpes === 5 && sc[1].propio === true;
  }), 'y el otro ve el número corregido, marcado como propio del jugador');

  console.log('\n7. Sin señal: nada se pierde');
  await B.ctx.setOffline(true);
  await B.p.evaluate(() => { R.scores[2] = 3; OTRO[2] = 4; cerrarHoyo(); });
  await B.p.evaluate(() => { R.scores[3] = 6; OTRO[3] = 5; cerrarHoyo(); });
  await esperar(600);
  const cola = await B.p.evaluate(() => ({ n: RONDA.cola.length, conectado: NUBE_ESTADO.conectado }));
  ok(cola.n >= 2 && !cola.conectado, `quedan ${cola.n} anotaciones en la cola y avisa que no hay señal`);
  const pill = await B.p.evaluate(() => pillNube().replace(/<[^>]*>/g, ''));
  ok(/sin mandar/.test(pill), `y se ve en pantalla: "${pill.trim()}"`);

  await B.ctx.setOffline(false);
  ok(await hasta(B.p, () => RONDA.cola.length === 0, null, 16000), 'al volver la señal, la cola se vacía sola');
  ok(await hasta(A.p, () => {
    const sc = scoresDe(RONDA.jugadores.find(j => j.id !== RONDA.yo).id);
    return sc[2] && sc[3];
  }), 'y los dos hoyos que se cargaron sin señal llegan al otro teléfono');

  console.log('\n8. El servidor caído no rompe la app');
  await fetch(MOCK + '/__test?caido=1');
  await A.p.evaluate(() => { S.hole = 4; R.scores[4] = 4; cerrarHoyo(); });
  await esperar(1500);
  const conCaida = await A.p.evaluate(() => ({
    score: R.scores[4], cola: RONDA.cola.length,
    pantalla: document.getElementById('screen').innerText.length
  }));
  ok(conCaida.score === 4 && conCaida.cola >= 1 && conCaida.pantalla > 500,
     'seguís jugando igual: el score queda guardado y la app no se cae');
  await fetch(MOCK + '/__test?caido=0');
  ok(await hasta(A.p, () => RONDA.cola.length === 0, null, 16000), 'cuando el servidor vuelve, se pone al día solo');

  console.log('\n9. Cerrar la app y volver');
  await B.p.reload({ waitUntil: 'load' });
  await B.p.waitForTimeout(1500);
  await B.p.evaluate(u => { NUBE.url = u; NUBE.llave = 'llave-de-prueba'; arrancarLatido(); }, MOCK);
  await esperar(800);
  const tras = await B.p.evaluate(() => ({ codigo: RONDA && RONDA.codigo, js: (RONDA.jugadores||[]).length }));
  ok(tras.codigo === codigo && tras.js === 2, `sigue en la ronda ${tras.codigo} con ${tras.js} jugadores`);

  console.log('\n10. La tarjeta del grupo en vivo');
  const tabla = await B.p.evaluate(() => { S.hoja = 'grupo'; render();
    return document.getElementById('hoja').innerText.replace(/\s+/g, ' '); });
  ok(/Mauro/.test(tabla) && /Félix/.test(tabla), 'muestra a los dos jugadores');
  ok(!/\bnull\b|\bNaN\b|undefined|Infinity/.test(tabla), 'sin huecos ni basura');
  console.log('    ' + tabla.slice(0, 150) + '…');

  const estado = await (await fetch(MOCK + '/__test')).json();
  console.log(`\n    en el servidor: ${estado.rondas} ronda · ${estado.jugadores} jugadores · ${estado.anotaciones} anotaciones`);

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
})();
