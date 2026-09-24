/* Para correrlo:  node pruebas/identidadtest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */

/* LA APP NO ARRANCA SIENDO NADIE.
   Durante meses la maqueta venía cargada con un nombre y un index escritos a
   mano —"Mauro Domina", 7.4— para poder verla llena sin registrarse. El día que
   apareció la ronda compartida eso dejó de ser cosmético: el nombre VIAJA al
   servidor, así que el socio que entraba a una ronda aparecía en la tarjeta del
   grupo con el nombre del que había armado la app. Y una tarjeta que no dice
   quién la firmó no sirve para nada.

   Esta prueba fija el trato:
   · instalación nueva = sin nombre, sin index, sin ser socio de nadie
   · ninguna pantalla de jugador nombra a una persona que no cargó la persona
   · ningún atajo entra a la app sin nombre
   · sin nombre no se entra a una ronda compartida
   · sin index no se inventan netos ni stablefords
   · el panel del club no se le abre a cualquiera que baja la app */

const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
let pasaron = 0, fallaron = 0;
const ok = (c, m) => { c ? pasaron++ : fallaron++;
  console.log((c ? '  ✓ ' : '  ✗ ') + m); };

/* Un teléfono recién instalado: contexto nuevo, sin nada en localStorage. */
async function telefono(b, semilla) {
  const ctx = await b.newContext({ ...devices['Pixel 7'], permissions:['geolocation'],
    geolocation:{ latitude:-35.65628, longitude:-63.78597, accuracy:5 } });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  await p.addInitScript(s => {
    window.confirm = () => true;
    if(s) try { localStorage.setItem('trisquelia_v1', JSON.stringify(s)); } catch(e) {}
  }, semilla || null);
  await p.goto(APP, { waitUntil:'load' });
  await p.waitForTimeout(1300);
  return { p, ctx, errores };
}

/* El texto visible de una pantalla, sin etiquetas. */
const pantalla = p => p.evaluate(() =>
  document.getElementById('screen').innerText.replace(/\s+/g,' '));

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const errores = [];

  /* ══ 1 · Una instalación nueva no es nadie ══════════════════════════ */
  console.log('\n1. Una instalación nueva no es nadie');
  const t1 = await telefono(b);
  errores.push(...t1.errores);

  ok(await t1.p.evaluate(() => S.user.name === null && S.user.ini === null),
     'no hay nombre cargado');
  ok(await t1.p.evaluate(() => S.user.hcp === null), 'no hay index cargado');
  ok(await t1.p.evaluate(() => S.tipo === null && esSocio() === false),
     'y la app no supone que sos socio del club');
  ok(await t1.p.evaluate(() => S.onboarded === false), 'arranca en el alta, no adentro');

  const bienvenida = await pantalla(t1.p);
  ok(!/Mauro/.test(bienvenida), 'la bienvenida no nombra a nadie');

  /* El barrido que importa: ninguna pantalla de jugador puede tener el nombre
     de una persona de verdad escrito a mano. Las del panel del club quedan
     afuera a propósito: ahí la comisión sí son nombres reales. */
  const DEL_JUGADOR = ['home','play','stats','club','social','me','notif','summary',
                       'bag','handicap','firma','arranque','tarjeta','prueba','copia'];
  const conNombreAjeno = await t1.p.evaluate(vistas => {
    const sucias = [];
    vistas.forEach(k => {
      try { if(/Mauro|Domina/.test(VIEWS[k]())) sucias.push(k); }
      catch(e){ sucias.push(k + ' (excepción: ' + e.message + ')'); }
    });
    return sucias;
  }, DEL_JUGADOR);
  ok(conNombreAjeno.length === 0,
     `ninguna de las ${DEL_JUGADOR.length} pantallas del jugador nombra a otro` +
     (conNombreAjeno.length ? ' — aparece en: ' + conNombreAjeno.join(', ') : ''));

  /* ══ 2 · Ningún atajo entra sin nombre ═════════════════════════════ */
  console.log('\n2. Ningún atajo entra sin nombre');
  await t1.p.evaluate(() => skipOnb());          // "Ya tengo cuenta · entrar"
  await t1.p.waitForTimeout(150);
  ok(await t1.p.evaluate(() => S.onboarded === false), 'el atajo no abre la app');
  const pide = await pantalla(t1.p);
  ok(/C[óo]mo te llam[áa]s/.test(pide), 'antes te pregunta cómo te llamás');

  await t1.p.evaluate(() => { S.nombreIn = 'An'; guardarNombre(); });
  ok(await t1.p.evaluate(() => S.onboarded === false && S.user.name === null),
     'dos letras no son un nombre');

  await t1.p.evaluate(() => { S.nombreIn = '  Ana   Pérez  '; guardarNombre(); });
  await t1.p.waitForTimeout(200);
  ok(await t1.p.evaluate(() => S.onboarded === true && S.tab === 'home'),
     'con nombre y apellido entra');
  ok(await t1.p.evaluate(() => S.user.name === 'Ana Pérez'),
     'y lo guarda limpio, sin los espacios de más');
  ok(await t1.p.evaluate(() => S.user.ini === 'AP'), 'las iniciales salen del nombre');

  const casa = await pantalla(t1.p);
  ok(/Hola, Ana/.test(casa), 'la app saluda por el nombre de pila');
  ok(await t1.p.evaluate(() => /AP/.test(document.getElementById('screen').innerHTML)),
     'y el avatar lleva las iniciales');

  await t1.p.reload({ waitUntil:'load' });
  await t1.p.waitForTimeout(1200);
  ok(await t1.p.evaluate(() => S.user.name === 'Ana Pérez' && S.onboarded === true),
     'el nombre sobrevive a cerrar y abrir la app');

  /* ══ 3 · Todas las pantallas dicen quién sos ════════════════════════ */
  console.log('\n3. Todas las pantallas dicen quién sos, no quién soy yo');
  /* Una vuelta cargada, que es cuando la tarjeta tiene algo que mostrar. */
  await t1.p.evaluate(() => {
    for(let h=1; h<=9; h++){ R.scores[h] = par(h); R.putts[h] = 2; }
    S.playing = true; S.hole = 10; S.torneo = true; render();
  });

  const tarjeta = await t1.p.evaluate(() => VIEWS.tarjeta());
  ok(/Ana Pérez/.test(tarjeta), 'la tarjeta la firma Ana Pérez');
  ok((tarjeta.match(/Ana Pérez/g) || []).length >= 2,
     'en los datos del jugador y en las firmas');

  const grupo = await t1.p.evaluate(() => HOJAS.grupo.c());
  ok(/Ana P\./.test(grupo), 'en la tarjeta del grupo va abreviada, como en el papel');

  const torneo = await t1.p.evaluate(() => { S.clubTab='torneo'; return VIEWS.club(); });
  ok(/Ana Pérez/.test(torneo), 'el leaderboard del torneo te marca a vos');
  /* El ranking de Comunidad manda al Torneo de Invierno y no arma tabla propia:
     lo que se revisa acá es que no haya quedado ningún nombre suelto. */
  const ranking = await t1.p.evaluate(() => { S.socialTab='ranking'; S.tipo='socio'; return VIEWS.social(); });
  ok(!/Mauro|Domina/.test(ranking), 'el ranking de Comunidad no nombra a nadie a mano');
  const invierno = await t1.p.evaluate(() => { S.clubTab='invierno'; return VIEWS.club(); });
  ok(/Ana Pérez/.test(invierno), 'y la Copa de Invierno también');
  const cuenta = await t1.p.evaluate(() => VIEWS.me());
  ok(/Ana Pérez/.test(cuenta) && /AP/.test(cuenta), 'Mi cuenta muestra nombre e iniciales');

  /* Cambiar el nombre: antes no había forma de hacerlo desde adentro. */
  await t1.p.evaluate(() => { S.editNombre = true; S.nombreIn = 'Ana Gómez'; guardarNombre(); });
  ok(await t1.p.evaluate(() => S.user.name === 'Ana Gómez' && S.user.ini === 'AG'
                             && S.editNombre === false),
     'se puede cambiar el nombre desde Mi cuenta, y se recalculan las iniciales');

  /* ══ 4 · Sin index no se inventan números ══════════════════════════ */
  console.log('\n4. Sin index no se inventan netos ni stablefords');
  const sinIndex = await t1.p.evaluate(() => {
    S.user.hcp = null; S.tab = 'tarjeta';
    return { tarjeta: VIEWS.tarjeta(), grupo: HOJAS.grupo.c(), arranque: VIEWS.arranque() };
  });
  const texto = h => { const d = { innerHTML:'' };
    return h.replace(/<[^>]*>/g,' ').replace(/\s+/g,' '); };
  ok(/Neto\s*–/.test(texto(sinIndex.tarjeta)),
     'el neto de la tarjeta queda en raya, no repite el gross');
  ok(/Sin index/.test(texto(sinIndex.tarjeta)), 'y la tarjeta explica por qué');
  ok(!/\bnull\b|\bNaN\b/.test(texto(sinIndex.grupo)),
     'la tarjeta del grupo no muestra basura');
  ok(/Sin index cargado/.test(texto(sinIndex.arranque)),
     'el arranque dice "sin index" en vez de un handicap inventado');

  const conIndex = await t1.p.evaluate(() => {
    S.user.cat = 'cab'; S.user.hcp = 12.0; S.tee = 'mixta'; S.vuelta = 18;
    return { hcp: hcpJuego(), tarjeta: VIEWS.tarjeta().replace(/<[^>]*>/g,' ') };
  });
  ok(conIndex.hcp === 11, `con index 12.0 de blancas el handicap de cancha es 11 (dio ${conIndex.hcp})`);
  ok(/Neto\s*(\d+)/.test(conIndex.tarjeta), 'y ahí sí aparece el neto');

  /* ══ 5 · A una ronda compartida no se entra con nombre prestado ═════ */
  console.log('\n5. A una ronda compartida no se entra con nombre prestado');
  const t2 = await telefono(b);
  errores.push(...t2.errores);
  /* Entramos a la app salteando el nombre a propósito, como si un día se
     colara un camino nuevo: la ronda tiene que frenarlo igual. */
  const frenada = await t2.p.evaluate(async () => {
    S.onboarded = true; S.tab = 'arranque'; render();
    window.__pedidos = [];
    window.rpc = async (fn, args) => { window.__pedidos.push({ fn, args });
                                       return { error:'no debería llegar acá' }; };
    await crearRonda();
    await unirseRonda();
    return { pedidos: window.__pedidos.length, ronda: RONDA, tab: S.tab,
             edit: S.editNombre === true };
  });
  ok(frenada.pedidos === 0, 'sin nombre no sale ni un pedido al servidor');
  ok(frenada.ronda === null, 'y no queda ninguna ronda abierta');
  ok(frenada.tab === 'me' && frenada.edit,
     'te manda derecho a poner tu nombre, en vez de un error suelto');

  const mandado = await t2.p.evaluate(async () => {
    S.nombreIn = 'Félix Córdoba'; guardarNombre();
    S.user.cat = 'cab'; S.user.hcp = 7.4; S.tee = 'negras'; S.vuelta = 18;
    window.__pedidos = [];
    await crearRonda();
    return window.__pedidos[0];
  });
  ok(mandado && mandado.args.p_nombre === 'Félix Córdoba',
     'con nombre cargado, lo que viaja al servidor es TU nombre');
  ok(mandado && mandado.args.p_iniciales === 'FC', 'con tus iniciales');
  ok(mandado && mandado.args.p_index === 7.4 && mandado.args.p_hcp === 10,
     `y tu handicap de la vuelta que estás jugando (index 7.4 de negras = 10, dio ${mandado&&mandado.args.p_hcp})`);

  /* ══ 6 · El panel del club no se le abre a cualquiera ══════════════ */
  console.log('\n6. El panel del club no se le abre a cualquiera');
  const puertas = await t1.p.evaluate(() => {
    const ver = n => { ponerNombre(n); S.comoQuien = null; S.tipo = 'socio';
      return { puerta: /Abrir panel del club/.test(VIEWS.me()),
               rol: quien().rol, comision: esComision() }; };
    return { ana: ver('Ana Gómez'), mauro: ver('Mauro Domina'), felix: ver('Félix Córdoba') };
  });
  ok(!puertas.ana.puerta && !puertas.ana.comision,
     'un socio cualquiera no ve la puerta al panel');
  ok(puertas.mauro.puerta && puertas.mauro.rol === 'admin',
     'el que está en la comisión sí, y con su rol');
  ok(puertas.felix.puerta && puertas.felix.rol === 'salidas',
     'y cada uno entra con el suyo: Félix maneja salidas, no es administrador');

  /* ══ 7 · El alta pide el nombre por los dos caminos ════════════════ */
  console.log('\n7. El alta pide el nombre por los dos caminos');
  const t3 = await telefono(b);
  errores.push(...t3.errores);
  ok(await t3.p.evaluate(() => { S.onb = 1; S.tipo = null; seguirDesdeTipo(); return S.onb === 1; }),
     'hay que elegir socio o invitado: no viene elegido de fábrica');

  const invitado = await t3.p.evaluate(() => {
    S.tipo = 'invitado'; seguirDesdeTipo();
    const html = vOnboard();
    S.email = 'ana@correo.com'; S.clave = 12; S.claveOk = true;
    crearCuenta();                                  // sin nombre todavía
    const trabada = S.onb === 3;
    S.nombreIn = 'Ana Gómez'; crearCuenta();
    return { pide:/Tu nombre/.test(html), trabada, nombre:S.user.name, paso:S.onb };
  });
  ok(invitado.pide, 'al invitado, que no pasa por el padrón, el paso "Tu usuario" le pide el nombre');
  ok(invitado.trabada, 'y sin nombre no crea la cuenta');
  ok(invitado.nombre === 'Ana Gómez' && invitado.paso === 4,
     'con el nombre puesto, sigue al handicap');

  const socio = await t3.p.evaluate(() => {
    S.user.name = null; S.user.ini = null;
    S.onb = 2; S.tipo = 'socio'; S.padronEstado = 'verificado';
    S.hallado = { n:'—', socio:'—', deMentira:true };
    S.nombrePrueba = 'Chelo Caballero'; usarNombrePrueba();
    return { nombre:S.user.name, ini:S.user.ini, paso:S.onb };
  });
  ok(socio.nombre === 'Chelo Caballero' && socio.ini === 'CC' && socio.paso === 3,
     'y el socio escribe el suyo en el paso del padrón');

  const delPadron = await t3.p.evaluate(() => {
    S.user.name = null; S.user.ini = null; S.user.socio = null;
    S.codigo = '123456';
    S.hallado = { n:'Daniel Rodríguez', socio:'118', mail:'d@x.com' };  // padrón de verdad
    verificarCodigo();
    return { nombre:S.user.name, ini:S.user.ini, socio:S.user.socio };
  });
  ok(delPadron.nombre === 'Daniel Rodríguez' && delPadron.ini === 'DR' && delPadron.socio === '118',
     'con padrón de verdad, el nombre verificado se copia solo: nadie lo escribe dos veces');

  await t1.ctx.close(); await t2.ctx.close(); await t3.ctx.close();
  console.log(`\n${pasaron} bien · ${fallaron} mal`);
  console.log('Errores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
  process.exit(fallaron ? 1 : 0);
})();
