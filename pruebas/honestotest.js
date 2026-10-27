/* Para correrlo:  node pruebas/honestotest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   No habla con ningún servidor de verdad: Neon se imita acá mismo,
   interceptando los pedidos. Si Playwright no encuentra Chromium solo,
   pasale la ruta en CHROME_PATH. */

/* NADA INVENTADO CON CARA DE REAL.
   La regla más vieja del proyecto es "nunca mostrar un número inventado", y
   hasta la v25 se rompía en cuarenta y pico lugares del lado del socio: la
   bolsa decía "Golpes que cargaste: 368 · medidas por vos" en un teléfono
   recién instalado, las estadísticas eran un dibujo escrito a mano
   ("Score promedio 86.4", "Handicap 14.2 ↓ desde 16.1"), las notificaciones
   eran seis inventadas ("Cuota de octubre $150.000"), la cancha decía
   "Greens · Excelente" aunque el club la hubiera cerrado, el alta decía
   "Código enviado" e "Identidad verificada" sin mandar ni verificar nada, y
   en el panel —que es un dibujo— un botón publicaba de verdad un aviso para
   todos los socios. Lo encontraron un relevamiento y una revisión del PDF para
   la comisión, el 26/10/2026.

   El trato que cuida esta suite:
   · lo que se puede calcular, se calcula de lo que el socio hizo de verdad;
   · lo que todavía es de ejemplo, lo dice arriba;
   · un botón que no hace nada dice "así se vería", y no manda nada;
   · lo que publica para todos, pregunta antes;
   · ninguna pantalla dice que pasó algo que no pasó. */

const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = process.env.APP || 'http://localhost:8000/index.html';
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { c ? pasaron++ : fallaron++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const HOY = (d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'))(new Date());

const SOCIO = { v:1, onboarded:true, tipo:'socio', tee:'mixta', vuelta:18, hole:1, playing:false,
  torneo:false, indexFecha:HOY, user:{ name:'Socio Prueba', ini:'SP', hcp:12.4, socio:'—',
  club:'Trisquelia Golf Club', cat:'cab' } };
const COMISION = { llave:'x'.repeat(64), puesto:'Administración', persona:'Persona Prueba', rol:'admin',
  permisos:['salidas','result','torneos','avisos','cancha','padron','cuotas','admin'] };
const ahora = () => new Date().toISOString();

/* Un teléfono con lo que haga falta sembrado. `o.gps`: una sola posición y
   después nada —como un GPS que deja de mandar sin avisar—. */
async function telefono(b, o = {}) {
  const ctx = await b.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true,
    permissions: o.gps ? ['geolocation'] : [] });
  const p = await ctx.newPage();
  const errores = []; p.on('pageerror', e => errores.push(e.message));
  const red = { llamadas: [] };
  await p.addInitScript(d => {
    window.confirm = () => (window.__confirmar !== undefined ? window.__confirmar : true);
    try {
      if (!localStorage.getItem('__sembrado')) {
        localStorage.setItem('__sembrado', '1');
        if (d.socio) localStorage.setItem('trisquelia_v1', JSON.stringify(d.socio));
        if (d.club) localStorage.setItem('trisquelia_club', JSON.stringify(d.club));
        if (d.comision) localStorage.setItem('trisquelia_comision', JSON.stringify(d.comision));
        if (d.ronda) localStorage.setItem('trisquelia_ronda', JSON.stringify(d.ronda));
        if (d.vueltas) localStorage.setItem('trisquelia_vueltas', JSON.stringify(d.vueltas));
      }
    } catch (e) {}
    if (d.gps) {
      navigator.geolocation.watchPosition = ok => {
        setTimeout(() => ok({ coords:{ latitude:-35.65628, longitude:-63.78597, accuracy:4 } }), 150);
        return 1;
      };
    }
  }, { socio: o.socio === undefined ? SOCIO : o.socio, club: o.club || null, comision: o.comision || null,
       ronda: o.ronda || null, vueltas: o.vueltas || null, gps: !!o.gps });
  await p.route('**/token/anonymous', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ token:'x.y.z', expires_at: Date.now()/1000 + 3600 }) }));
  await p.route('**/rpc/**', r => {
    const fn = r.request().url().split('/rpc/')[1].split('?')[0];
    let args = {}; try { args = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    red.llamadas.push({ fn, args });
    if (fn === 'club_estado') return r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify(Object.assign({ cancha:null, avisos:[] }, o.club || {}, { ahora: ahora() })) });
    if (fn === 'ronda_estado') return r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ jugadores: (o.ronda && o.ronda.jugadores) || [], anotaciones:[], ahora: ahora() }) });
    r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true}' });
  });
  await p.route('https://api.open-meteo.com/**', r => r.abort('internetdisconnected'));
  await p.goto(APP, { waitUntil:'load' });
  await p.waitForTimeout(900);
  return { p, ctx, errores, red };
}

/* OJO CON LAS MAYÚSCULAS: el CSS pone los títulos en versalitas e `innerText`
   devuelve lo que se VE. Todo lo que es título se busca con /i. */
const pantalla = p => p.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g,' '));
const hoja = p => p.evaluate(() => (document.getElementById('hoja').innerText || '').replace(/\s+/g,' '));
const toastTxt = p => p.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
const ir = (p, tab, extra) => p.evaluate(([t, x]) => { Object.assign(S, x || {}); S.tab = t; render(); }, [tab, extra]);
const tocar = (p, texto) => p.evaluate(t => {
  const b = [...document.querySelectorAll('#screen button, #hoja button')]
    .find(x => x.textContent.replace(/\s+/g,' ').trim().includes(t));
  if (!b) return false; b.click(); return true; }, texto);

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  /* ══ 1 · La bolsa arranca vacía ═════════════════════════════════════════ */
  console.log('\n1. La bolsa arranca vacía');
  {
    const t = await telefono(b);
    errores.push(...t.errores);
    ok(await t.p.evaluate(() => BAG.every(x => x.shots.length === 0)),
       'en un teléfono nuevo ningún palo tiene golpes');
    await ir(t.p, 'stats', { statTab:'bolsa' });
    const st = await pantalla(t.p);
    ok(/Golpes medidos/i.test(st) && /Todavía ninguno/.test(st) && !/368/.test(st) && !/medidas por vos/.test(st),
       'Stats → Mi bolsa: "Golpes medidos 0 · todavía ninguno", sin los 368 ni "medidas por vos"');
    await ir(t.p, 'bag');
    const bolsa = await pantalla(t.p);
    ok(/Sin golpes medidos todavía/.test(bolsa) && !/Media 0 yds/.test(bolsa),
       'la bolsa dice "sin golpes medidos todavía", no "Media 0 yds"');
    await ir(t.p, 'me');
    const yo = await pantalla(t.p);
    ok(/0 golpes medidos/.test(yo) && !/368/.test(yo), 'Perfil: "0 golpes medidos"');
    await t.p.evaluate(() => { S.playing = true; S.hole = 1; S.tab = 'play'; render(); });
    const caddie = await t.p.evaluate(() => (document.querySelector('.palo.flota') || {}).textContent || '');
    ok(/estimado/.test(caddie) && !/tuyo/.test(caddie),
       `el caddie dice "estimado", no "tuyo · 34 golpes": "${caddie.replace(/\s+/g,' ').trim()}"`);
    await t.ctx.close();
  }

  /* ══ 2 · Lo que quedó guardado de antes se limpia ══════════════════════ */
  console.log('\n2. Los golpes inventados que quedaron guardados se van');
  {
    /* Hasta la v25 `guardarTodo()` grababa los 368 inventados en el teléfono de
       todos. Se arma lo que guardaba aquella versión —la lista de mentira de
       cada palo— y atrás, lo medido de verdad. */
    const t = await telefono(b);
    errores.push(...t.errores);
    await t.p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('trisquelia_v1'));
      d.bag = BAG.map((x, i) => ({ c:x.c, on:x.on, shots: golpesDeMentira(x, i) }));
      d.bag.find(x => x.c === 'Dr').shots.push(245, 250);          // lo medido de verdad
      d.bag.find(x => x.c === '3w').shots.push(-5, 9999, 'x');      // basura de una copia armada
      d.bag.find(x => x.c === '5i').shots = [171, 176];             // sin prefijo inventado: no se toca
      localStorage.setItem('trisquelia_v1', JSON.stringify(d));
    });
    await t.p.reload({ waitUntil:'load' });
    await t.p.waitForTimeout(700);
    const r = await t.p.evaluate(() => ({ dr: palo('Dr').shots, w3: palo('3w').shots, i5: palo('5i').shots,
      total: golpesMedidos() }));
    ok(JSON.stringify(r.dr) === '[245,250]', `el Driver se queda sólo con lo medido de verdad: ${JSON.stringify(r.dr)}`);
    ok(r.w3.length === 0, 'lo inventado y lo imposible (−5, 9999, "x") no vuelven a entrar');
    ok(JSON.stringify(r.i5) === '[171,176]', 'una lista que no empieza con la de mentira no se toca');
    ok(r.total === 4, `en total quedan 4 golpes medidos (${r.total})`);
    await t.ctx.close();
  }

  /* ══ 3 · Tus números, de tus vueltas ═══════════════════════════════════ */
  console.log('\n3. Las estadísticas salen de Mis rondas');
  {
    const t = await telefono(b);
    errores.push(...t.errores);
    await ir(t.p, 'stats', { statTab:'general' });
    const vacio = await pantalla(t.p);
    ok(/Todavía no terminaste ninguna vuelta/.test(vacio)
       && !/86\.4|14\.2|16\.1|\+0\.8|−2\.1|Últimas 20 rondas/.test(vacio),
       'sin vueltas lo dice, y no aparece ninguno de los números escritos a mano');
    /* Dos vueltas de 18 completas, armadas con el par de la cancha:
       A = un golpe sobre el par en cada hoyo, 2 putts, fairway, green en regulación;
       B = par en los impares y +1 en los pares, 2 putts salvo dos de 3, drive a la derecha, sin green. */
    await t.p.evaluate(() => {
      const hs = Array.from({ length:18 }, (_, i) => i + 1);
      const arma = (golpes, putts, fw, gir, fecha) => {
        const R_ = { scores:{}, putts:{}, fw:{}, gir:{}, shots:{}, bunker:{}, penal:{} };
        hs.forEach(h => { R_.scores[h] = golpes(h); R_.putts[h] = putts(h);
          if (par(h) > 3) R_.fw[h] = fw; R_.gir[h] = gir; });
        const tot = hs.reduce((a, h) => a + R_.scores[h], 0);
        return { id: fecha, fecha, club: CLUB.corto, salida: tee().n, vuelta: 18, torneo: false, estado: 'práctica',
                 golpes: tot, alPar: tot - parTotal(), hoyos: 18, R: R_, otro: {}, marca: {}, terminada: fecha + 'T18:00:00Z' };
      };
      const A = arma(h => par(h) + 1, () => 2, 'fw', true, '2026-10-10');
      const B = arma(h => par(h) + (h % 2 ? 0 : 1), h => (h === 3 || h === 7) ? 3 : 2, 'der', false, '2026-10-17');
      localStorage.setItem('trisquelia_vueltas', JSON.stringify([A, B]));
      window.__esperado = { prom: (A.golpes + B.golpes) / 2, mejor: Math.min(A.golpes, B.golpes) };
    });
    await t.p.reload({ waitUntil:'load' });
    await t.p.waitForTimeout(700);
    const esp = await t.p.evaluate(() => { const A = VUELTAS[0].golpes, B = VUELTAS[1].golpes;
      return { prom: ((A + B) / 2).toFixed(1), mejor: String(Math.min(A, B)) }; });
    await ir(t.p, 'stats', { statTab:'general' });
    const g = await pantalla(t.p);
    ok(g.includes(esp.prom) && g.includes(esp.mejor) && /2 vueltas en este teléfono/i.test(g),
       `General: promedio ${esp.prom} y mejor vuelta ${esp.mejor}, de las 2 vueltas guardadas`);
    await ir(t.p, 'stats', { statTab:'juego' });
    const j = await pantalla(t.p);
    ok(/Fairways 50%/i.test(j) && /Greens en regulación 50%/i.test(j),
       'Juego largo: fairways y greens en regulación, 50% (una vuelta sí, la otra no)');
    await ir(t.p, 'stats', { statTab:'corto' });
    const c = await pantalla(t.p);
    ok(/Putts por vuelta 37\.0/i.test(c) && /3 putts 1\.0/i.test(c),
       'Juego corto: 37.0 putts por vuelta y 1.0 de tres putts, de los putts anotados');
    await ir(t.p, 'stats', { statTab:'plan' });
    ok(/Así se vería · todavía no está hecho/.test(await pantalla(t.p)) && !/Bajás a 12/.test(await pantalla(t.p)),
       'el plan de práctica dice que todavía no está hecho');
    await t.ctx.close();
  }

  /* ══ 4 · Lo de ejemplo lo dice ═════════════════════════════════════════ */
  console.log('\n4. Lo que es de ejemplo, lo dice');
  {
    const club = { cancha:{ abierta:false, nota:'Lluvia hasta el mediodía', por:'Persona', desde: ahora() },
                   avisos:[{ id:1, ic:'🏆', titulo:'Copa del Club', detalle:'Inscripción en secretaría',
                             por:'Persona', creado: ahora(), socios:false, borrado_en:null }] };
    const t = await telefono(b, { club });
    errores.push(...t.errores);
    for (const [k, rx] of [['invierno', /de ejemplo/i], ['torneo', /de ejemplo/i], ['result', /así se va a ver/i], ['shop', /de ejemplo/i]]) {
      await ir(t.p, 'club', { clubTab:k });
      ok(rx.test(await pantalla(t.p)), `Club → ${k}: lo dice arriba`);
    }
    await ir(t.p, 'club', { clubTab:'tee' });
    const tee = await pantalla(t.p), hoy = await t.p.evaluate(() => hoyTxt());
    ok(/La cancha en vivo · así se va a ver/i.test(tee) && tee.toLowerCase().includes(hoy.toLowerCase()) && !/Hoy · viernes/i.test(tee),
       `La cancha hoy: el día del reloj ("${hoy}") y la cancha en vivo marcada como ejemplo`);
    await ir(t.p, 'club', { clubTab:'cancha' });
    const cancha = await pantalla(t.p);
    ok(/Cerrada/.test(cancha) && /Lluvia hasta el mediodía/.test(cancha) && !/velocidad 10\.5/.test(cancha),
       'Club → Cancha: el estado que publicó el club, no "Greens · Excelente"');
    for (const k of ['amigos', 'retos', 'ranking', 'logros']) {
      await ir(t.p, 'social', { socialTab:k });
      ok(/Social · así se va a ver/i.test(await pantalla(t.p)), `Social → ${k}: lo dice arriba`);
    }
    await ir(t.p, 'home');
    ok(await t.p.evaluate(() => !!document.querySelector('[aria-label="Avisos"] span')),
       'la campanita se prende: hay un aviso del club que no viste');
    await ir(t.p, 'notif');
    const n = await pantalla(t.p);
    ok(/Copa del Club/.test(n) && !/Tu tee time|Quedan 11 lugares|Cuota de/.test(n),
       'Notificaciones: el aviso del club, y ninguno de los seis inventados');
    await ir(t.p, 'home');
    ok(await t.p.evaluate(() => !document.querySelector('[aria-label="Avisos"] span')),
       'después de mirarlos, la campanita se apaga');
    await ir(t.p, 'me');
    const yo = await pantalla(t.p);
    ok(!/Garmin conectado|2 pases disponibles|\$150\.000/.test(yo), 'Perfil: ni "Garmin conectado", ni pases, ni la cuota escrita a mano');
    await t.ctx.close();
  }

  /* ══ 5 · En el panel, un dibujo no publica ══════════════════════════════ */
  console.log('\n5. En el panel, un dibujo no publica y lo de verdad pregunta');
  {
    const t = await telefono(b, { comision: COMISION });
    errores.push(...t.errores);
    await ir(t.p, 'dash', { mode:'club' });
    const antes = t.red.llamadas.length;
    ok(await tocar(t.p, 'Cargar y avisar en un paso'), 'está el botón de la cuota (en una pantalla que es un dibujo)');
    await t.p.waitForTimeout(300);
    ok(/^Así se vería/.test(await toastTxt(t.p)) && !t.red.llamadas.slice(antes).some(x => x.fn === 'aviso_poner'),
       '"Cargar y avisar en un paso" dice "así se vería" y no publica nada');
    const rapidos = await t.p.evaluate(() => [...document.querySelectorAll('#screen button.chip')].map(x => x.textContent.replace(/\s+/g,' ').trim()));
    ok(!rapidos.some(x => /^Cancha cerrada$/.test(x)), 'ya no hay un aviso rápido "Cancha cerrada": eso lo dice el estado de la cancha');
    await t.p.evaluate(() => { window.__confirmar = false; });
    await tocar(t.p, 'Aireación de greens');
    await t.p.waitForTimeout(300);
    ok(!t.red.llamadas.some(x => x.fn === 'aviso_poner'), 'un aviso rápido pregunta antes, y si se dice que no, no sale');
    await t.p.evaluate(() => { window.__confirmar = true; });
    await tocar(t.p, 'Aireación de greens');
    await t.p.waitForTimeout(500);
    const pub = t.red.llamadas.filter(x => x.fn === 'aviso_poner');
    ok(pub.length === 1 && pub[0].args.p_titulo === 'Aireación de greens', 'y si se dice que sí, sale una vez');
    for (const [tab, boton] of [['dash', 'Revisar una'], ['cargaaag', 'Copiar datos'], ['cargaaag', 'Bajar planilla de la fecha']]) {
      await ir(t.p, tab, { mode:'club' });
      const n0 = t.red.llamadas.length;
      const hay = await tocar(t.p, boton);
      await t.p.waitForTimeout(200);
      ok(hay && /^Así se vería/.test(await toastTxt(t.p)) && t.red.llamadas.length === n0,
         `"${boton}" dice "así se vería" y no manda nada`);
    }
    await t.ctx.close();
  }

  /* ══ 6 · La aclaración de la cancha es de un estado ════════════════════ */
  console.log('\n6. Al reabrir la cancha no queda la aclaración de cuando estaba cerrada');
  {
    const club = { cancha:{ abierta:false, nota:'Prueba en la reunión', por:'Persona', desde: ahora() }, avisos:[] };
    const t = await telefono(b, { comision: COMISION, club });
    errores.push(...t.errores);
    await ir(t.p, 'dash', { mode:'club' });
    await t.p.evaluate(() => setCancha(true));
    ok(await t.p.evaluate(() => document.getElementById('notaCancha').value === ''),
       'al pasarla a Abierta, "Prueba en la reunión" se vacía');
    await t.p.evaluate(() => publicarCancha());
    await t.p.waitForTimeout(500);
    const pc = t.red.llamadas.filter(x => x.fn === 'cancha_poner').pop();
    ok(pc && pc.args.p_abierta === true && pc.args.p_nota === '', 'y se publica abierta y sin la aclaración vieja');
    await t.ctx.close();
    const t2 = await telefono(b, { comision: COMISION, club });
    await ir(t2.p, 'dash', { mode:'club' });
    await t2.p.evaluate(() => { document.getElementById('notaCancha').value = 'Abre a las 8'; setCancha(true); });
    ok(await t2.p.evaluate(() => document.getElementById('notaCancha').value === 'Abre a las 8'),
       'lo que se escribió a mano antes de elegir, se respeta');
    await t2.ctx.close();
  }

  /* ══ 7 · El alta dice lo que es ════════════════════════════════════════ */
  console.log('\n7. El alta, mientras no esté conectada, lo dice');
  {
    const t = await telefono(b, { socio: null });
    errores.push(...t.errores);
    await t.p.evaluate(() => { S.tipo = 'socio'; S.onb = 2; render(); });
    ok(/Así se va a ver el alta/.test(await pantalla(t.p)), 'el paso del DNI dice que el alta todavía no está conectada');
    await t.p.evaluate(() => { S.dni = '28456123'; buscarPadron(); });
    const tz = await toastTxt(t.p), pz = await pantalla(t.p);
    ok(/todavía no se manda/.test(tz) && !/Código enviado/.test(tz), `con cualquier DNI no dice "Código enviado": "${tz}"`);
    ok(/Así se vería el código/.test(pz) && !/Te mandamos un código/.test(pz) && !/pr•+@/.test(pz),
       'ni muestra un contacto inventado como si fuera el que tiene el club');
    await t.p.evaluate(() => { S.codigo = '123456'; verificarCodigo(); });
    ok(/todavía no se verifica nada/.test(await toastTxt(t.p)), 'con cualquier código no dice "Identidad verificada"');
    ok(await t.p.evaluate(() => !S.email), 'y el mail inventado del socio de prueba no pasa a ser tu cuenta');
    await t.p.evaluate(() => { S.nombrePrueba = 'Ana Gómez'; usarNombrePrueba(); S.onb = 3; render(); });
    ok(!/Usá el mismo mail que tiene el club/.test(await pantalla(t.p)), 'el paso del usuario no ofrece "el mail que tiene el club"');
    await t.p.evaluate(() => entrarConCodigo());
    ok(await t.p.evaluate(() => S.email !== 'socio@trisquelia.com'), '"Entrar con código" no inventa un mail');
    await t.p.evaluate(() => { S.onb = 6; render(); });
    const listo = await pantalla(t.p);
    ok(!/Socio verificado/.test(listo) && /todavía sin verificar/.test(listo), 'la pantalla final no dice "Socio verificado"');
    await t.ctx.close();
  }

  /* ══ 8 · El GPS que deja de mandar ═════════════════════════════════════ */
  console.log('\n8. Un GPS que deja de mandar no se sigue mostrando como vivo');
  {
    const t = await telefono(b, { gps:true, socio: Object.assign({}, SOCIO, { playing:true }) });
    errores.push(...t.errores);
    await ir(t.p, 'play');
    await t.p.waitForTimeout(800);
    const vivo = await t.p.evaluate(() => document.getElementById('gpsPill').textContent);
    ok(/GPS ±/.test(vivo), `con posición, la pantalla dice "${vivo.trim()}"`);
    /* Una posición de hace 31 segundos, y ninguna nueva: `gpsVivo()` vence. */
    await t.p.evaluate(() => { POS_T = Date.now() - 31000; });
    await t.p.waitForTimeout(6000);
    const viejo = await t.p.evaluate(() => ({ pill: document.getElementById('gpsPill').textContent,
      unid: (document.getElementById('dUnid') || {}).textContent || '' }));
    ok(!/GPS ±/.test(viejo.pill) && /estimadas/.test(viejo.unid),
       `a los pocos segundos lo dice: "${viejo.pill.trim()}" · "${viejo.unid.trim()}"`);
    await t.ctx.close();
  }

  /* ══ 9 · Nueve hoyos, handicap de nueve ════════════════════════════════ */
  console.log('\n9. En una vuelta de 9 hoyos, el handicap es el de 9');
  {
    const t = await telefono(b, { socio: Object.assign({}, SOCIO, { vuelta:9, playing:true, R:{ scores:{ 1:5 },
      putts:{}, fw:{}, gir:{}, shots:{}, bunker:{}, penal:{} } }) });
    errores.push(...t.errores);
    const h = await t.p.evaluate(() => ({ juego: hcpJuego(), de18: hcpCancha(S.user.hcp), grupo: GROUP()[0].hcp }));
    ok(h.juego !== h.de18, `el de 9 (${h.juego}) no es el de 18 (${h.de18})`);
    ok(h.grupo === h.juego, 'la tarjeta del grupo usa el de 9');
    await ir(t.p, 'tarjeta');
    ok((await pantalla(t.p)).includes('cancha ' + h.juego), 'la tarjeta oficial muestra el de 9');
    await ir(t.p, 'summary');
    ok((await pantalla(t.p)).includes('cancha ' + h.juego), 'el resumen también');
    await t.p.evaluate(() => { S.tab = 'play'; render(); abrirHoja('grupo'); });
    const g = await hoja(t.p);
    ok(/Al par/i.test(g) && !/\bNeto\b/i.test(g), 'la columna del grupo dice "Al par": golpes contra el par no es el neto');
    await t.ctx.close();
  }

  /* ══ 10 · El torneo con la ronda del grupo, con nombres de verdad ══════ */
  console.log('\n10. En torneo con la ronda compartida, los nombres son los del grupo');
  {
    const ronda = { codigo:'ABCDEF', yo:'yo', llave:'llave-del-telefono', anot:{}, cola:[], desde:null, marcoA:'otro',
      jugadores:[ { id:'yo', nombre:'Socio Prueba', iniciales:'SP', marca_a:'otro' },
                  { id:'otro', nombre:'<img src=x onerror="window.__pwn=1">Ana Gómez', iniciales:'AG', marca_a:'yo' } ] };
    const t = await telefono(b, { ronda, socio: Object.assign({}, SOCIO, { torneo:true, playing:true, marco:1, meMarca:2,
      R:{ scores:{ 1:4 }, putts:{ 1:2 }, fw:{}, gir:{}, shots:{}, bunker:{}, penal:{} } }) });
    errores.push(...t.errores);
    await t.p.evaluate(() => { S.tab = 'play'; render(); abrirCierre(1); });
    await t.p.waitForTimeout(300);
    const cierre = await pantalla(t.p);
    ok(/Seguir · la tarjeta de/.test(cierre) && /Ana Gómez/.test(cierre) && !/Socio U\./.test(cierre),
       'cerrar el hoyo lleva a la tarjeta de quien marcás de verdad, no a "Socio U."');
    await t.p.evaluate(() => { S.cerrando = false; S.tab = 'firma'; render(); });
    const firma = await pantalla(t.p);
    ok(/la que anotó/i.test(firma) && /Ana Gómez/.test(firma) && !/de ejemplo/.test(firma) && !/Socio C\./.test(firma),
       'la firma dice quién te marcó de verdad');
    ok(!/al toque/.test(firma) && !/firmada por AG/.test(firma), 'y no da por firmado lo que firma el otro en su teléfono');
    ok(await t.p.evaluate(() => window.__pwn === undefined), 'un nombre con HTML no se ejecuta en ninguna de las dos');
    await t.ctx.close();
  }

  /* ══ 11 · La primera visita no se recarga ══════════════════════════════ */
  console.log('\n11. La primera visita no se recarga sola');
  {
    const ctx = await b.newContext({ viewport:{ width:390, height:844 } });
    const p = await ctx.newPage();
    let cargas = 0;
    p.on('framenavigated', f => { if (f === p.mainFrame()) cargas++; });
    await p.route('https://api.open-meteo.com/**', r => r.abort('internetdisconnected'));
    await p.route('**/*neon.tech/**', r => r.abort('internetdisconnected'));
    await p.goto(APP, { waitUntil:'load' });
    /* Se espera a que el service worker tome el control: en la v25 eso
       recargaba la página, y al que estaba escribiendo su nombre se le borraba. */
    for (let i = 0; i < 40; i++) {
      if (await p.evaluate(() => !!navigator.serviceWorker.controller).catch(() => false)) break;
      await p.waitForTimeout(250);
    }
    await p.waitForTimeout(1200);
    ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'el service worker tomó el control');
    ok(cargas === 1, `y la página se cargó una sola vez (${cargas})`);
    await p.waitForTimeout(600);
    const ver = await p.evaluate(() => APP_VERSION);
    ok(/^trisquelia-v\d+$/.test(ver || ''), `y sabe qué versión quedó guardada, sin recargar (${ver})`);
    await ctx.close();
  }

  /* ══ 12 · Ninguna pantalla dice que pasó algo que no pasó ═════════════ */
  console.log('\n12. Barrido de todas las pantallas: ningún cartel de los que mentían');
  {
    /* Se dibuja cada pantalla, del socio y del panel, y se junta el texto que
       se ve y lo que hace cada botón (`onclick`). Ahí no puede aparecer
       ninguna de las frases que decían que algo pasó, o que presentaban un
       dato inventado como del socio. */
    const PROHIBIDO = ['Garmin conectado','2 pases disponibles','velocidad 10.5','Hoy · viernes','medidas por vos',
      'Tus distancias reales','Golpes que cargaste','Últimas 20 rondas','Generado con tus últimas','Tu tee time es en',
      'Quedan 11 lugares','le llegan solas','al toque','Invitación enviada','Link de invitación copiado','Felicitaste a',
      'Reto enviado','Garmin sincronizado','Cuota al día','Pase de invitado enviado','Cambiado a metros','Reporte enviado',
      'Reglamento completo descargado','Se debita de tu cuenta','Liquidación enviada','Inscripto al','Siguiendo la ronda',
      'Avisaste que salís','Código reenviado','Te mandamos un link','Aviso enviado al club','Pedido enviado',
      'Datos copiados','Planilla generada',"toast('Rechazado')",'Tarjeta abierta ·','socio@trisquelia.com',
      'Sale de la grilla que armó el club','en el celular del otro aparece igual','golpes cargados','Estás anotado'];
    const t = await telefono(b, { comision: COMISION, socio: Object.assign({}, SOCIO, { playing:true, torneo:true,
      R:{ scores:{ 1:4, 2:5 }, putts:{ 1:2, 2:2 }, fw:{}, gir:{}, shots:{}, bunker:{}, penal:{} } }) });
    errores.push(...t.errores);
    const visto = await t.p.evaluate(() => {
      let txt = '';
      const juntar = () => { txt += ' ' + document.getElementById('screen').innerText + ' '
        + [...document.querySelectorAll('[onclick]')].map(x => x.getAttribute('onclick')).join(' '); };
      const jugador = Object.keys(VIEWS).filter(k => !esPantallaClub(k));
      jugador.forEach(k => { S.mode = 'player'; S.tab = k; try { render(); juntar(); } catch (e) { txt += ' ERROR ' + k; } });
      ['clubTab', 'statTab', 'socialTab'].forEach(() => {});
      ['tee','invierno','torneo','result','shop','cancha'].forEach(k => { S.clubTab = k; S.tab = 'club'; render(); juntar(); });
      ['general','bolsa','juego','corto','plan'].forEach(k => { S.statTab = k; S.tab = 'stats'; render(); juntar(); });
      ['amigos','retos','ranking','logros'].forEach(k => { S.socialTab = k; S.tab = 'social'; render(); juntar(); });
      Object.keys(HOJAS).forEach(k => { S.mode = 'player'; S.tab = 'play'; render(); try { abrirHoja(k); txt += ' ' + document.getElementById('hoja').innerText; } catch (e) {} });
      PANTALLAS_CLUB.forEach(k => { S.mode = 'club'; S.tab = k; render(); juntar(); });
      [0,1,2,3,4].forEach(n => { S.onboarded = false; S.onb = n; render(); juntar(); });
      return txt.replace(/\s+/g, ' ');
    });
    const halladas = PROHIBIDO.filter(f => visto.includes(f));
    ok(halladas.length === 0, halladas.length ? `aparecen: ${halladas.join(' · ')}` : `ninguna de las ${PROHIBIDO.length} frases aparece en ninguna pantalla`);
    ok(!/ERROR /.test(visto), 'y todas las pantallas se dibujan sin romperse');
    await t.ctx.close();
  }

  /* ══ 13 · Lo que encontró la revisión adversaria de la v26 ═════════════ */
  console.log('\n13. Lo que encontró la revisión adversaria de la v26');
  {
    /* El nombre de tu marcador lo escribe él. Con HTML adentro, el aviso del
       cruce lo ejecutaba en TU teléfono, con la llave del panel a mano. */
    const malo = '<img src=x onerror="window.__pwn=1">Ana';
    const ronda = { codigo:'ABCDEF', yo:'yo', llave:'llave-del-telefono', cola:[], desde:null, marcoA:'otro',
      anot:{ 'yo|otro|1': { ronda:'ABCDEF', de:'yo', por:'otro', hoyo:1, golpes:5 } },
      jugadores:[ { id:'yo', nombre:'Socio Prueba', iniciales:'SP', marca_a:'otro' },
                  { id:'otro', nombre: malo, iniciales:'AG', marca_a:'yo' } ] };
    const t = await telefono(b, { ronda, socio: Object.assign({}, SOCIO, { torneo:true, playing:true, hole:1,
      R:{ scores:{ 1:4 }, putts:{ 1:2 }, fw:{}, gir:{}, shots:{}, bunker:{}, penal:{} } }) });
    errores.push(...t.errores);
    await ir(t.p, 'play');
    await t.p.evaluate(() => abrirHoja('grupo'));
    await t.p.waitForTimeout(300);
    ok(/No coinciden en el hoyo 1/i.test(await pantalla(t.p)) && await t.p.evaluate(() => window.__pwn === undefined),
       'el aviso del cruce y la hoja del grupo muestran el nombre del marcador sin ejecutarlo');
    await t.p.evaluate(() => { cerrarHoja(); S.tab = 'firma'; render(); });
    const f = await pantalla(t.p);
    ok(/No coincide en 1 hoyo/.test(f) && !/todavía no anotó nada/.test(f),
       'la firma ve lo que anotó el marcador en la ronda compartida, no un "todavía no anotó nada"');
    await t.p.evaluate(() => certificar());
    ok(await t.p.evaluate(() => S.certifico === false), 'y con el cruce abierto no deja certificar');
    await t.ctx.close();
  }
  {
    /* Una copia armada a mano: HTML en lo que se guarda de `S`, y un index de texto. */
    const x = '<img src=x onerror="window.__pwn=1">';
    const socio = Object.assign({}, SOCIO, { hole: x, nsocio: x, mat: x, email: x, dni: x,
      user: Object.assign({}, SOCIO.user, { club: x, hcp: '7.4', socio: x }) });
    const t = await telefono(b, { socio });
    errores.push(...t.errores);
    let vio = '';
    for (const [tab, extra] of [['home'], ['club', { clubTab:'tee' }], ['me'], ['handicap'], ['arranque'], ['copia']]) {
      await ir(t.p, tab, extra);
      vio += await pantalla(t.p);
    }
    ok(await t.p.evaluate(() => window.__pwn === undefined), 'una copia con HTML en lo guardado no ejecuta nada en ninguna pantalla');
    ok(await t.p.evaluate(() => S.user.hcp === 7.4 && S.hole === 1), 'un index guardado como texto se lee como número, y un hoyo imposible vuelve al 1');
    ok(vio.length > 200 && !/\bundefined\b|NaN/.test(vio), 'y la app se dibuja entera, no queda en blanco');
    await t.ctx.close();
  }
  {
    /* El último palo del hoyo no se mide hasta el tee siguiente. */
    const t = await telefono(b, { gps:true, socio: Object.assign({}, SOCIO, { playing:true, hole:1 }) });
    errores.push(...t.errores);
    await ir(t.p, 'play');
    await t.p.waitForTimeout(600);
    const r = await t.p.evaluate(() => {
      const A = [-35.65628, -63.78597];
      const mover = (lat, lon) => { POS = { lat, lon, acc:4 }; POS_T = Date.now(); };
      mover(A[0], A[1]);
      registrarGolpe(1, 'PW');
      mover(A[0] + 0.00106, A[1]);                 // ~129 yardas al norte: el tee del 2
      abrirCierre(1);
      const alCerrar = { d: R.shots[1][0].d, bolsa: palo('PW').shots.length };
      S.cerrando = false;
      registrarGolpe(1, '9i');                       // el golpe siguiente sí mide el anterior
      return { alCerrar, despues: R.shots[1][0].d, bolsa: palo('PW').shots.length };
    });
    ok(r.alCerrar.d === null && r.alCerrar.bolsa === 0, 'cerrar el hoyo no mide el último palo hasta donde estás parado');
    ok(r.despues > 100 && r.despues < 160 && r.bolsa === 1, `el golpe siguiente sí lo mide, desde donde quedó la bola (${r.despues} yds)`);
    const imposible = await t.p.evaluate(() => {
      POS = { lat:-35.65628, lon:-63.78597, acc:4 }; POS_T = Date.now();
      registrarGolpe(2, 'LW');
      POS = { lat:-35.65628 + 0.003, lon:-63.78597, acc:4 }; POS_T = Date.now();   // ~360 yardas con un lob
      registrarGolpe(2, 'Pt');
      return { d: R.shots[2][0].d, bolsa: palo('LW').shots.length };
    });
    ok(imposible.d === null && imposible.bolsa === 0, 'un lob de 360 yardas no es un golpe: no entra a la bolsa');
    await t.ctx.close();
  }
  {
    /* Con hoyos de la vuelta anotados no se pasa a 9; y el borrador de la
       cancha no sobrevive a que otro la cambie. */
    const club = { cancha:{ abierta:false, nota:'Lluvia', por:'Persona', desde:'2026-10-27T10:00:00Z' }, avisos:[] };
    const t = await telefono(b, { comision: COMISION, club, socio: Object.assign({}, SOCIO, { playing:true,
      R:{ scores:{ 1:4, 10:5 }, putts:{}, fw:{}, gir:{}, shots:{}, bunker:{}, penal:{} } }) });
    errores.push(...t.errores);
    await t.p.evaluate(() => setVuelta(9));
    ok(await t.p.evaluate(() => S.vuelta === 18), 'con el hoyo 10 anotado no deja pasar la tarjeta a 9 hoyos');
    await ir(t.p, 'dash', { mode:'club' });
    const r = await t.p.evaluate(() => {
      setCancha(false);
      document.getElementById('notaCancha').value = 'Se evalúa a las 10'; notaCanchaTipeada('Se evalúa a las 10');
      /* Mientras tanto, otro de la comisión la reabre. */
      CLUB_VIVO.cancha = { abierta:true, nota:'Reabrimos a las 14', por:'Otro', desde:'2026-10-27T13:00:00Z' };
      render();
      return { estado: canchaEditando(), nota: document.getElementById('notaCancha').value };
    });
    ok(r.estado === true && r.nota === 'Reabrimos a las 14', 'si otro cambió la cancha, el borrador viejo no la vuelve a cerrar');
    await t.p.evaluate(() => { notaCanchaTipeada('Abre a las 8'); render(); });
    ok(await t.p.evaluate(() => document.getElementById('notaCancha').value === 'Abre a las 8'),
       'y lo que se escribe en la aclaración no se pierde al redibujar');
    await t.ctx.close();
  }

  console.log('\nErrores de JavaScript:', errores.length ? errores : 'ninguno');
  console.log(`\n${pasaron} ✓ · ${fallaron} ✗`);
  await b.close();
  process.exitCode = fallaron ? 1 : 0;
})();
