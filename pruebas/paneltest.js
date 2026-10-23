/* Para correrlo:  node pruebas/paneltest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */

/* AL PANEL DE LA COMISIÓN SE ENTRA CON UNA LLAVE, NO CON UN NOMBRE.

   Historia corta, porque explica cada sección de abajo:

   Hasta la v20 la app te reconocía comparando el nombre que habías tecleado
   contra una lista de cuatro personas escrita en el código. El 22/10/2026 se
   descubrió que además se podía saltear por completo: `?ir=permisos` abría el
   panel y la app te decía "sos el administrador". Se cerró ese mismo día.

   Pero el fondo seguía mal: **un servidor no le puede creer a un nombre**.
   Cualquiera escribe "Chelo Caballero". Mientras el panel no escribía nada,
   daba igual; desde la v21 publica avisos a nombre del club.

   Así que ahora cada PUESTO tiene una llave que da el servidor, y la app
   guarda lo que el servidor le contesta: puesto, persona, rol y la lista de
   permisos. Esta suite comprueba las dos mitades:

   · que sin llave no se entra por ninguna de las tres puertas (sección 1 a 3),
   · que escribir el nombre de alguien de la comisión ya no abre nada (4),
   · y que con llave se entra sólo a lo propio (5 a 7).

   Los nombres de persona de acá son inventados. Desde la v21 el código de la
   app no tiene ninguno, y eso también se comprueba (sección 8). */

const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
let bien = 0, mal = 0;
const ok = (c, m) => { c ? bien++ : mal++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

const PANTALLAS_CLUB = ['dash', 'tees', 'socios', 'torneo', 'permisos', 'cargaaag'];

/* Lo que devuelve `comision_entrar()` en el servidor, tal cual. Si esto se
   desincroniza de `roles_srv()` en `club.sql`, la suite prueba un servidor
   que no existe — la misma trampa que está anotada para el mock de la nube. */
const ROLES_SRV = {
  admin:   ['salidas','result','torneos','avisos','cancha','padron','cuotas','admin'],
  salidas: ['salidas','result'],
  avisos:  ['avisos','cancha','padron','cuotas'],
  torneos: ['torneos'],
  sin:     []
};
const llaveDe = (rol, puesto, persona) => ({
  llave: 'k'.repeat(64), puesto, persona, rol, permisos: ROLES_SRV[rol]
});

const guardado = nombre => ({
  v: 1, onboarded: !!nombre, tipo: 'socio', tee: 'mixta', vuelta: 18, hole: 1,
  user: nombre
    ? { name: nombre, ini: 'XX', hcp: 18.0, socio: '—', club: 'Trisquelia Golf Club', cat: 'cab' }
    : { name: null, ini: null, hcp: null, socio: null, club: 'Trisquelia Golf Club', cat: null }
});

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  /* Abre la app con —o sin— una credencial de comisión guardada, y
     opcionalmente forzando pantalla por la URL o dejando una pantalla de
     club ya guardada de una sesión anterior. */
  async function abrir({ nombre = 'Juan Perez', cred = null, ir, tabGuardada } = {}) {
    const ctx = await b.newContext({ ...devices['Pixel 7'] });
    const p = await ctx.newPage();
    p.on('pageerror', e => errores.push(e.message));
    await p.addInitScript(([g, c, t]) => {
      try {
        const d = JSON.parse(g);
        if (t) { d.tab = t; d.mode = 'club'; }
        localStorage.setItem('trisquelia_v1', JSON.stringify(d));
        if (c) localStorage.setItem('trisquelia_comision', c);
      } catch (e) {}
    }, [JSON.stringify(guardado(nombre)), cred ? JSON.stringify(cred) : '', tabGuardada || '']);
    await p.goto(APP + (ir ? '?ir=' + ir : ''), { waitUntil: 'load' });
    await p.waitForTimeout(650);
    const r = await p.evaluate(() => ({
      tab: S.tab, mode: S.mode,
      esComision: esComision(),
      puesto: quien() ? quien().puesto : null,
      persona: quien() ? quien().persona : null,
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

  console.log('\n1. SIN LLAVE · un socio cualquiera');
  for (const t of PANTALLAS_CLUB) {
    const r = await abrir({ ir: t });
    ok(r.tab !== t && r.mode === 'player',
       `?ir=${t} no lo deja entrar (quedó en "${r.tab}", modo ${r.mode})`);
  }
  const sl = await abrir({ ir: 'permisos' });
  ok(sl.puesto === null && sl.rol === null, 'para la app no es nadie de la comisión');
  ok(sl.permisos.length === 0, 'y no tiene ni uno de los ocho permisos');
  ok(!/administrador/i.test(sl.texto), 'en ninguna parte le dicen "administrador"');

  console.log('\n2. Las otras dos puertas, que son las que se olvidan');
  const g = await abrir({ tabGuardada: 'permisos' });
  ok(g.tab !== 'permisos' && g.mode === 'player',
     `una pantalla del club guardada en el teléfono tampoco abre (quedó en "${g.tab}")`);
  const vacio = await abrir({ ir: 'dash', cred: { llave: 'k'.repeat(64) } });
  ok(vacio.esComision === false,
     'una credencial a medias, sin lista de permisos, se descarta entera');

  console.log('\n3. Un teléfono recién instalado, sin nombre ni llave');
  const sn = await abrir({ nombre: null, ir: 'permisos' });
  ok(sn.puesto === null && sn.tab !== 'permisos', 'sin nada cargado, el panel no existe');

  console.log('\n4. EL NOMBRE YA NO ABRE NADA · el cambio de fondo de la v21');
  /* Antes, escribir exactamente "Mauro Domina" te daba el panel entero.
     Ahora el nombre es sólo el nombre: lo que abre es la llave. */
  for (const n of ['Mauro Domina', 'Chelo Caballero', 'Félix Córdoba', 'Daniel Rodríguez']) {
    const r = await abrir({ nombre: n, ir: 'permisos' });
    ok(r.tab !== 'permisos' && r.permisos.length === 0,
       `escribir "${n}" no abre el panel: el nombre no es una credencial`);
  }

  console.log('\n5. CON LLAVE · cada puesto entra sólo a lo suyo');
  const pro = llaveDe('salidas', 'Profesional de la cancha', 'Pablo Prueba');
  const fx = await abrir({ cred: pro, ir: 'tees' });
  ok(fx.tab === 'tees' && fx.mode === 'club', 'el profesional entra a las salidas, que es lo suyo');
  ok(fx.puesto === 'Profesional de la cancha' && fx.persona === 'Pablo Prueba',
     'y la app sabe qué puesto es y quién lo ocupa');
  ok((await abrir({ cred: pro, ir: 'permisos' })).tab !== 'permisos',
     'pero NO entra a los permisos, aunque tenga llave válida');
  ok((await abrir({ cred: pro, ir: 'socios' })).tab !== 'socios', 'ni al padrón');

  const cd = llaveDe('avisos', 'Comisión Directiva', 'Carla Prueba');
  ok((await abrir({ cred: cd, ir: 'socios' })).tab === 'socios', 'la Directiva sí entra al padrón');
  ok((await abrir({ cred: cd, ir: 'tees' })).tab !== 'tees',
     'y NO a las salidas, que son del profesional');

  const sin = llaveDe('sin', 'Puesto sin permisos', 'Sandra Prueba');
  const rs = await abrir({ cred: sin, ir: 'dash' });
  ok(rs.tab !== 'dash' && rs.entra === false,
     'una llave con rol "sin" no abre nada: tener llave no alcanza');

  console.log('\n6. El administrador tiene todo (no rompimos el panel)');
  const adm = llaveDe('admin', 'Administración', 'Ana Prueba');
  for (const t of PANTALLAS_CLUB) {
    const r = await abrir({ cred: adm, ir: t });
    ok(r.tab === t && r.mode === 'club', `el admin entra a ${t}`);
  }
  const md = await abrir({ cred: adm, ir: 'dash' });
  ok(md.permisos.length === 8, 'y tiene los ocho permisos');
  ok(md.nav.length === 5, `con el nav completo: ${md.nav.join(' · ')}`);
  ok(!/estás viendo el panel como/i.test(md.texto),
     'y ya NO existe el selector de "ver el panel como otro": era de la maqueta');

  console.log('\n7. El nav no ofrece lo que la persona no puede abrir');
  const fnav = await abrir({ cred: pro, ir: 'dash' });
  ok(fnav.nav.indexOf('Permisos') < 0 && fnav.nav.indexOf('Socios') < 0,
     `al profesional el nav le muestra sólo: ${fnav.nav.join(' · ')}`);

  console.log('\n8. Ningún nombre de persona decide quién entra');
  /* La versión estricta de esto —"que no aparezca ningún nombre en todo el
     archivo"— no es la prueba correcta, y conviene decir por qué. Quedan
     nombres en tres lugares legítimos: los comentarios que cuentan la
     historia, el acta de decisiones del club (que nombra a quién le
     corresponde cada cosa, y es su sentido), y `CLUB.pro`, que es el
     profesional del club y es un dato público del club, no una credencial.

     Lo que sí tiene que ser cierto es esto: que ningún nombre funcione como
     llave, y que el panel no liste personas. */
  const fuente = await (await fetch(APP)).text();
  ok(!/const\s+EQUIPO\s*=/.test(fuente), 'la constante EQUIPO ya no existe');
  ok(!/enComision|quienK|S\.comoQuien/.test(fuente),
     'ni las funciones que reconocían a la persona por el nombre tecleado');

  /* Y el panel, con una llave cualquiera, no muestra a nadie más. */
  const panel = await abrir({ cred: adm, ir: 'permisos' });
  for (const n of ['Félix', 'Chelo', 'Daniel']) {
    ok(panel.texto.indexOf(n) < 0,
       `el panel no nombra a "${n}": la app ya no tiene la lista del equipo`);
  }
  ok(panel.texto.indexOf('Ana Prueba') >= 0,
     'sólo aparece quien ocupa TU puesto, y eso lo mandó el servidor');

  console.log('\n9. La llave no viaja en la copia de seguridad');
  /* Es la credencial de una persona, no un dato de la app: si viajara, una
     copia compartida le daría el panel del club a cualquiera. */
  ok(!/COPIA_CLAVES[\s\S]{0,400}trisquelia_comision/.test(fuente),
     'la clave de la comisión no está en la lista de lo que se copia');

  console.log(`\n${bien} bien · ${mal} mal`);
  console.log('Errores de JavaScript:', errores.length ? [...new Set(errores)] : 'ninguno');
  await b.close();
  process.exit(mal || errores.length ? 1 : 0);
})();
