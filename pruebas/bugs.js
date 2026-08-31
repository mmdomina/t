/* Para correrlo:  node pruebas/<archivo>.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
/* Barrido de todas las pantallas buscando errores y basura visible. */
const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;   // si está vacío, Playwright busca solo

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'],
    geolocation: { latitude: -35.6563, longitude: -63.7859, accuracy: 5 } });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push('CONSOLE: ' + m.text()); });

  await p.goto('http://localhost:8000/', { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  const informe = await p.evaluate(() => {
    const hallazgos = [];
    const anota = (donde, tipo, det) => hallazgos.push({ donde, tipo, det });

    // texto visible de un HTML, sin etiquetas
    const texto = html => {
      const d = document.createElement('div');
      d.innerHTML = html;
      return (d.innerText || d.textContent || '').replace(/\s+/g, ' ');
    };

    /* basura que nunca debería llegar a la pantalla */
    const SOSPECHAS = [
      [/\bundefined\b/, 'undefined en pantalla'],
      [/\bNaN\b/, 'NaN en pantalla'],
      [/\bnull\b/, 'null en pantalla'],
      [/\[object Object\]/, '[object Object]'],
      [/\bInfinity\b/, 'Infinity']
    ];

    const revisar = (donde, fn) => {
      let html;
      try { html = fn(); }
      catch (e) { anota(donde, 'EXCEPCIÓN', e.message); return; }
      if (typeof html !== 'string') { anota(donde, 'NO DEVUELVE HTML', typeof html); return; }
      const t = texto(html);
      SOSPECHAS.forEach(([re, nombre]) => {
        const m = t.match(new RegExp('.{0,45}' + re.source + '.{0,45}'));
        if (m) anota(donde, nombre, m[0].trim());
      });
    };

    /* ---------- estados de prueba ---------- */
    const limpiar = () => {
      Object.keys(R).forEach(k => R[k] = {});
      S.playing = false; S.cerrando = false; S.hole = 1; S.chequeoRonda = false;
    };
    const cargarRonda = (hasta) => {
      limpiar();
      for (let h = 1; h <= hasta; h++) {
        R.scores[h] = par(h) + (h % 3 === 0 ? 1 : h % 5 === 0 ? -1 : 0);
        R.putts[h] = 2; R.fw[h] = h % 2 ? 'fw' : 'izq';
        R.gir[h] = h % 2 === 0; R.bunker[h] = h % 4 === 0 ? 1 : 0; R.penal[h] = 0;
        R.shots[h] = [{ c: '7i', lat: -35.6563, lon: -63.7859, d: 150 }];
      }
      S.playing = true; S.hole = Math.min(hasta + 1, S.vuelta);
    };

    const vistas = Object.keys(VIEWS);

    /* 1 · cada vista, ronda vacía y ronda cargada, con cada salida */
    ['mixta', 'negras', 'damas'].forEach(teeId => {
      S.tee = teeId;
      [['vacía', () => limpiar()], ['jugando', () => cargarRonda(7)], ['terminada', () => cargarRonda(18)]]
        .forEach(([estado, preparar]) => {
          preparar();
          vistas.forEach(k => revisar(`${k} · ${teeId} · ${estado}`, VIEWS[k]));
        });
    });
    S.tee = 'mixta'; limpiar();

    /* 2 · las solapas internas */
    ['general', 'bolsa', 'juego', 'corto', 'plan'].forEach(t => {
      S.statTab = t; revisar(`stats/${t}`, VIEWS.stats);
    });
    ['tee', 'invierno', 'resultados', 'torneo', 'shop', 'cancha'].forEach(t => {
      S.clubTab = t; revisar(`club/${t}`, VIEWS.club);
    });
    ['amigos', 'retos', 'ranking', 'logros'].forEach(t => {
      S.socialTab = t; revisar(`social/${t}`, VIEWS.social);
    });

    /* 3 · el panel de cierre y el de golpes, hoyo por hoyo */
    cargarRonda(5);
    for (let h = 1; h <= 18; h++) {
      revisar(`panelCierre h${h}`, () => { S.hole = h; S.cerrando = true; return panelCierre(); });
      revisar(`shotPanel h${h}`, () => { S.cerrando = false; return shotPanel(h); });
      revisar(`holeSVG h${h}`, () => holeSVG(h));
    }
    S.cerrando = false; S.hole = 1;

    /* 4 · modo club, con cada persona del equipo */
    S.mode = 'club';
    EQUIPO.forEach((m, i) => {
      S.comoQuien = i;
      ['dash', 'tees', 'socios', 'torneo', 'permisos'].forEach(k => {
        if (VIEWS[k]) revisar(`club:${m.rol}/${k}`, VIEWS[k]);
      });
    });
    S.mode = 'player'; S.comoQuien = 0;

    /* 5 · el alta de cuenta, paso por paso */
    const onbGuardado = S.onboarded;
    S.onboarded = false;
    for (let i = 0; i <= 6; i++) {
      S.onb = i;
      ['socio', 'invitado'].forEach(tipo => {
        S.tipo = tipo;
        revisar(`onboarding paso ${i} · ${tipo}`, vOnboard);
      });
    }
    S.onboarded = onbGuardado; S.onb = 0; S.tipo = 'socio';

    /* 6 · firma y resumen, con y sin tarjeta presentada */
    cargarRonda(18);
    [[true, true], [true, false], [false, true]].forEach(([cert, firmo]) => {
      S.certifico = cert; S.firmoLaOtra = firmo;
      revisar(`firma cert=${cert} firmo=${firmo}`, vFirma);
      revisar(`resumen cert=${cert}`, vSummary);
    });
    S.presento = false;
    revisar('firma · no presenta', vFirma);
    S.presento = null;

    /* 7 · cálculos que tienen que dar número */
    const calculos = [];
    ['mixta', 'negras', 'damas'].forEach(id => {
      const t = CLUB.tees.find(x => x.id === id);
      calculos.push({ salida: id, rating: t.r, slope: t.s,
        hcpCancha18: hcpCancha(7.4, t, 18), hcpCancha9: hcpCancha(7.4, t, 9),
        yardasTotal: ydsDe(t), yardaHoyo1: yardaDe(t, 1) });
    });

    limpiar();
    return { hallazgos, calculos, vistas };
  });

  console.log('\n═══ VISTAS REVISADAS ═══');
  console.log(informe.vistas.join(' · '));

  console.log('\n═══ CÁLCULOS POR SALIDA ═══');
  console.table(informe.calculos);

  console.log('\n═══ HALLAZGOS ═══');
  if (!informe.hallazgos.length) console.log('  (ninguno)');
  const porTipo = {};
  informe.hallazgos.forEach(h => { (porTipo[h.tipo] = porTipo[h.tipo] || []).push(h); });
  Object.entries(porTipo).forEach(([tipo, lista]) => {
    console.log(`\n── ${tipo} (${lista.length}) ──`);
    const porDet = {};
    lista.forEach(h => { (porDet[h.det] = porDet[h.det] || []).push(h.donde); });
    Object.entries(porDet).forEach(([det, dondes]) => {
      console.log(`  ${det}`);
      console.log(`    en: ${dondes.join(' | ')}`);
    });
  });

  console.log('\n═══ ERRORES DE JAVASCRIPT ═══');
  console.log(errores.length ? errores.join('\n') : '  (ninguno)');
  await b.close();
})();
