/* Para correrlo:  node pruebas/paneltest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */

/* EL PANEL DE LA COMISIÓN NO SE ABRE SIN SER DE LA COMISIÓN.

   El 22/10/2026 se descubrió que sí se abría. Dos cosas chicas se juntaban mal:

   1. El acceso directo del ícono aceptaba CUALQUIER pantalla que viniera en la
      dirección (`?ir=permisos`), sin preguntar nada.
   2. `quienK()` hacía `Math.max(0, enComision())`. Cuando la persona no estaba
      en la comisión eso daba 0 — o sea, el PRIMERO del equipo, que es el
      administrador.

   Juntas: cualquiera que hubiera escrito un nombre abría `?ir=permisos` y la
   app le decía "Sos el administrador", con los ocho permisos.

   Entonces no alcanzaba con tapar una: hay que probar las dos, y probar que la
   puerta es UNA SOLA. Eso es lo que hace esta suite — entra por la URL, por el
   estado guardado en el teléfono y por el simulador de "ver como", y las tres
   tienen que rebotar. Y después comprueba que al que SÍ corresponde se le abre
   lo suyo y nada más. */

const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
let bien = 0, mal = 0;
const ok = (c, m) => { c ? bien++ : mal++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

const PANTALLAS_CLUB = ['dash', 'tees', 'socios', 'torneo', 'permisos', 'cargaaag'];

/* Un teléfono recién instalado, con el nombre que se le pida. */
const guardado = nombre => ({
  v: 1, onboarded: !!nombre, tipo: 'socio', tee: 'mixta', vuelta: 18, hole: 1,
  user: nombre
    ? { name: nombre, ini: 'XX', hcp: 18.0, socio: '—', club: 'Trisquelia Golf Club', cat: 'cab' }
    : { name: null, ini: null, hcp: null, socio: null, club: 'Trisquelia Golf Club', cat: null }
});

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  /* Abre la app como una persona concreta, opcionalmente forzando pantalla
     por la URL o dejando una pantalla de club ya guardada en el teléfono. */
  async function abrir(nombre, { ir, tabGuardada, comoQuien } = {}) {
    const ctx = await b.newContext({ ...devices['Pixel 7'] });
    const p = await ctx.newPage();
    p.on('pageerror', e => errores.push(e.message));
    await p.addInitScript(([n, t]) => {
      try {
        const d = JSON.parse(n);
        if (t) { d.tab = t; d.mode = 'club'; }
        localStorage.setItem('trisquelia_v1', JSON.stringify(d));
      } catch (e) {}
    }, [JSON.stringify(guardado(nombre)), tabGuardada || '']);
    await p.goto(APP + (ir ? '?ir=' + ir : ''), { waitUntil: 'load' });
    await p.waitForTimeout(700);
    if (comoQuien != null) await p.evaluate(k => { S.comoQuien = k; render(); }, comoQuien);
    const r = await p.evaluate(() => ({
      tab: S.tab, mode: S.mode,
      esComision: esComision(),
      quien: quien() ? quien().n : null,
      rol: quien() ? quien().rol : null,
      entra: puedeEntrarAlPanel(),
      permisos: ['salidas','torneos','result','avisos','cancha','padron','cuotas','admin']
                  .filter(k => puede(k)),
      texto: document.querySelector('#screen').innerText,
      nav: [...document.querySelectorAll('#nav button')].map(x => x.textContent.trim())
    }));
    await ctx.close();
    return r;
  }

  console.log('\n1. UN SOCIO CUALQUIERA · el que descubrió el agujero');
  /* "Juan Perez" no está en EQUIPO. Es el caso exacto que se reprodujo. */
  for (const t of PANTALLAS_CLUB) {
    const r = await abrir('Juan Perez', { ir: t });
    ok(r.tab !== t && r.mode === 'player',
       `?ir=${t} no lo deja entrar (quedó en "${r.tab}", modo ${r.mode})`);
  }
  const jp = await abrir('Juan Perez', { ir: 'permisos' });
  ok(jp.quien === null, 'la app NO lo confunde con el primero del equipo');
  ok(jp.rol === null && jp.entra === false, 'no tiene rol ni entra al panel');
  ok(jp.permisos.length === 0, `y no tiene ni uno de los ocho permisos`);
  ok(!/administrador/i.test(jp.texto), 'en ninguna parte de la pantalla le dicen "administrador"');
  ok(!/Quién puede qué/i.test(jp.texto), 'ni ve la pantalla de permisos');

  console.log('\n2. Las otras dos puertas, que son las que se olvidan');
  const g = await abrir('Juan Perez', { tabGuardada: 'permisos' });
  ok(g.tab !== 'permisos' && g.mode === 'player',
     `una pantalla del club guardada en el teléfono tampoco abre (quedó en "${g.tab}")`);
  const c = await abrir('Juan Perez', { ir: 'dash', comoQuien: 0 });
  ok(c.quien === null && c.permisos.length === 0,
     'y el simulador de "ver como" puesto a mano no le da el rol de nadie');

  console.log('\n3. Un teléfono recién instalado, sin nombre');
  const sn = await abrir(null, { ir: 'permisos' });
  ok(sn.quien === null && sn.tab !== 'permisos', 'sin nombre cargado, el panel no existe');

  console.log('\n4. El nombre parecido no alcanza');
  for (const n of ['mauro domina ', 'Mauro Dómina', 'Mauro', 'Mauro Domina Jr']) {
    const r = await abrir(n, { ir: 'permisos' });
    const debeEntrar = n.trim().toLowerCase() === 'mauro domina';
    ok((r.tab === 'permisos') === debeEntrar,
       `"${n}" ${debeEntrar ? 'SÍ' : 'no'} entra — ${debeEntrar
         ? 'sólo cambian espacios y mayúsculas' : 'no es el nombre del equipo'}`);
  }

  console.log('\n5. AL QUE SÍ LE CORRESPONDE, se le abre lo suyo y nada más');
  /* Félix tiene el rol `salidas`: salidas y resultados. Nada de permisos ni padrón. */
  const fx = await abrir('Félix Córdoba', { ir: 'tees' });
  ok(fx.tab === 'tees' && fx.mode === 'club', 'Félix entra a las salidas, que es lo suyo');
  ok(fx.rol === 'salidas' && fx.quien === 'Félix Córdoba', 'y la app sabe que es él, no otro');
  const fx2 = await abrir('Félix Córdoba', { ir: 'permisos' });
  ok(fx2.tab !== 'permisos', 'pero NO entra a dar permisos, aunque sea de la comisión');
  const fx3 = await abrir('Félix Córdoba', { ir: 'socios' });
  ok(fx3.tab !== 'socios', 'ni al padrón');

  /* Chelo tiene avisos, cancha, padrón y cuotas. Lo contrario de Félix. */
  const ch = await abrir('Chelo Caballero', { ir: 'socios' });
  ok(ch.tab === 'socios', 'Chelo sí entra al padrón');
  const ch2 = await abrir('Chelo Caballero', { ir: 'tees' });
  ok(ch2.tab !== 'tees', 'y NO a las salidas, que son de Félix');

  console.log('\n6. El administrador sigue teniendo todo (no rompimos el panel)');
  for (const t of PANTALLAS_CLUB) {
    const r = await abrir('Mauro Domina', { ir: t });
    ok(r.tab === t && r.mode === 'club', `el admin entra a ${t}`);
  }
  const md = await abrir('Mauro Domina', { ir: 'dash' });
  ok(md.permisos.length === 8, `y tiene los ocho permisos`);
  /* Ojo: el CSS pone ese título en mayúsculas, así que la búsqueda va sin
     distinguir — con `indexOf` esta comprobación pasaba por el motivo
     equivocado y no habría detectado nada. */
  ok(/estás viendo el panel como/i.test(md.texto), 've el selector de "ver como"');
  ok(md.nav.length === 5, `y el nav del club con sus ${md.nav.length} solapas: ${md.nav.join(' · ')}`);

  console.log('\n7. El nav no ofrece lo que la persona no puede abrir');
  const fnav = await abrir('Félix Córdoba', { ir: 'dash' });
  ok(fnav.nav.indexOf('Permisos') < 0 && fnav.nav.indexOf('Socios') < 0,
     `a Félix el nav le muestra sólo: ${fnav.nav.join(' · ')}`);
  ok(!/estás viendo el panel como/i.test(fnav.texto),
     'y no le ofrece mirar el panel con los ojos de otro: eso es del administrador');

  console.log('\n8. El botón del panel en Perfil');
  const jm = await abrir('Juan Perez');
  ok(!/Abrir panel del club/.test(jm.texto) || jm.tab !== 'me',
     'a un socio común no le aparece el botón del panel en Perfil');

  console.log(`\n${bien} bien · ${mal} mal`);
  console.log('Errores de JavaScript:', errores.length ? [...new Set(errores)] : 'ninguno');
  await b.close();
  process.exit(mal || errores.length ? 1 : 0);
})();
