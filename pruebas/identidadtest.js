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
  /* La pantalla de arranque se mira SIN una vuelta abierta. Desde la v25, con
     una vuelta a medio jugar —la que dejó cargada la sección 3— el arranque no
     muestra la preparación sino la pregunta de qué hacer con esa vuelta, y el
     "sin index" vive en la preparación, que es lo que se quiere revisar. */
  const sinIndex = await t1.p.evaluate(() => {
    S.user.hcp = null; S.tab = 'tarjeta';
    const jugando = S.playing; S.playing = false;
    const arranque = VIEWS.arranque(); S.playing = jugando;
    return { tarjeta: VIEWS.tarjeta(), grupo: HOJAS.grupo.c(), arranque };
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
    const aMedias = VIEWS.tarjeta().replace(/<[^>]*>/g,' ');
    /* El neto es de la vuelta entera: restarle el handicap completo a medio
       recorrido daba un número que no existe (desde la v26). */
    const antes = Object.assign({}, R.scores);
    for (let h = 1; h <= 18; h++) if (R.scores[h] === undefined) R.scores[h] = par(h);
    const entera = VIEWS.tarjeta().replace(/<[^>]*>/g,' ');
    R.scores = antes;
    return { hcp: hcpJuego(), aMedias, entera };
  });
  ok(conIndex.hcp === 11, `con index 12.0 de blancas el handicap de cancha es 11 (dio ${conIndex.hcp})`);
  ok(/Neto\s*–/.test(conIndex.aMedias) && /con la vuelta completa/.test(conIndex.aMedias),
     'a mitad de la vuelta el neto queda en raya, y dice por qué');
  ok(/Neto\s*(\d+)/.test(conIndex.entera), 'y con la vuelta entera sí aparece el neto');

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
  /* Desde la v21 el nombre ya no abre nada: lo que abre es la llave que da
     el servidor. Acá sólo se comprueba el lado de la identidad —que escribir
     el nombre de alguien de la comisión no te convierta en esa persona—; el
     resto del portón lo prueba `paneltest` a fondo. */
  const puertas = await t1.p.evaluate(() => {
    const ver = n => { ponerNombre(n); S.tipo = 'socio';
      return { puerta: /Abrir panel del club/.test(VIEWS.me()),
               ofrece: /Sos de la comisión/.test(VIEWS.me()),
               quien: quien(), comision: esComision() }; };
    COMISION = null;
    const a = ver('Ana Gómez'), m = ver('Mauro Domina');
    /* Y ahora con una llave, que es lo único que sí abre. */
    COMISION = { llave:'k'.repeat(64), puesto:'Administración', persona:'Ana Prueba',
                 rol:'admin', permisos:['salidas','result','torneos','avisos','cancha','padron','cuotas','admin'] };
    const conLlave = ver('Ana Gómez');
    COMISION = null;
    return { ana: a, mauro: m, conLlave };
  });
  ok(!puertas.ana.puerta && !puertas.ana.comision,
     'un socio cualquiera no ve la puerta al panel');
  ok(puertas.ana.quien === null,
     'y para la app no es nadie de la comisión');
  ok(!puertas.mauro.puerta && puertas.mauro.quien === null,
     'ESCRIBIR EL NOMBRE DE ALGUIEN DE LA COMISIÓN TAMPOCO ABRE NADA');
  ok(puertas.ana.ofrece,
     'en su lugar, a cualquiera se le ofrece pegar una llave si la tiene');
  ok(puertas.conLlave.puerta && puertas.conLlave.quien.puesto === 'Administración',
     'con la llave puesta sí se abre, y con el puesto que dice el servidor');

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

  /* ══ 8 · Vacío no es "coincide" ═════════════════════════════════════
     Hasta la v21, la pantalla de firma leía "el marcador no anotó nada" como
     "el marcador está de acuerdo": decía "Lo que anotó MD coincide con tus
     golpes en los 18 hoyos" sin un solo número del otro lado, y el total de la
     fila del marcador sumaba los golpes del jugador. Lo encontró la revisión
     del PDF para la comisión, el 23/10/2026. Es de la misma familia que el
     neto inventado sin index: una confirmación que nadie dio. */
  console.log('\n8. Vacío no es "coincide"');
  const t4 = await telefono(b, { v:1, onboarded:true, tipo:'socio', tee:'mixta', vuelta:18,
    hole:4, playing:true, torneo:true,
    R:{ scores:{1:4,2:5,3:3}, putts:{}, fw:{}, gir:{}, shots:{}, bunker:{}, penal:{} },
    user:{ name:'Socio Prueba', ini:'SP', hcp:12.4, socio:'—', club:'Trisquelia Golf Club', cat:'cab' } });
  errores.push(...t4.errores);
  const firma = async () => { await t4.p.evaluate(() => { S.tab = 'firma'; render(); });
    await t4.p.waitForTimeout(400); return pantalla(t4.p); };

  const vacia = await firma();
  ok(!/coincide con tus golpes/i.test(vacia),
     'sin nada del marcador, NO dice que coincide');
  ok(/todavía no anotó nada/i.test(vacia),
     'dice que el marcador todavía no anotó');
  const filaMarca = await t4.p.evaluate(() => {
    const tr = [...document.querySelectorAll('#screen tr')].find(r => /anotó/.test(r.innerText));
    return tr ? tr.lastElementChild.innerText.trim() : null;
  });
  ok(filaMarca === '–', `el total del marcador es una raya, no mis golpes (dice "${filaMarca}")`);

  /* Y que el arreglo no rompa el caso bueno: con lo del marcador cargado y
     de acuerdo, sí tiene que decir que coincide. */
  const llena = await t4.p.evaluate(() => {
    MARCA[1] = 4; MARCA[2] = 5; MARCA[3] = 3; S.tab = 'firma'; render();
    return document.getElementById('screen').innerText.replace(/\s+/g,' ');
  });
  ok(/coincide con tus golpes/i.test(llena),
     'con el marcador de acuerdo en los tres hoyos, sí dice que coincide');
  const distinta = await t4.p.evaluate(() => {
    MARCA[2] = 6; S.tab = 'firma'; render();
    return document.getElementById('screen').innerText.replace(/\s+/g,' ');
  });
  ok(/No coincide en 1 hoyo/i.test(distinta),
     'y si no coincide en uno, lo marca');

  /* ══ 9 · La fecha de la tarjeta es la de la vuelta ═════════════════
     Hasta la v21 decía "31/07/2026" escrito a mano, para todos y para
     siempre. En la v22 la fecha se fija al salir al 1 —pero la primera
     versión del arreglo no la guardaba, y una recarga de Android en el medio
     de la vuelta la borraba. Acá se simula exactamente eso: una vuelta de
     hace tres días, el teléfono que recarga, y la tarjeta que tiene que
     seguir diciendo el día que se jugó, no el de hoy. */
  console.log('\n9. La fecha de la tarjeta es la de la vuelta');
  const hace3 = await t4.p.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() - 3);
    S.fecha = d.toISOString().slice(0,10); guardarTodo();
    return fechaTarjeta();
  });
  /* NO con `t4.p.reload()`: `telefono()` siembra el localStorage con un
     `addInitScript`, que corre en CADA carga de esa página, y la recarga
     pisaría lo que la app guardó — la prueba daría rojo por la razón
     equivocada. Una página nueva en el mismo contexto comparte el
     localStorage y no tiene la semilla: es lo que ve el teléfono cuando
     Android le recarga la pestaña. */
  const p2 = await t4.ctx.newPage();
  p2.on('pageerror', e => errores.push(e.message));
  await p2.goto(APP, { waitUntil:'load' });
  await p2.waitForTimeout(1200);
  const trasRecargar = await p2.evaluate(() => ({ f: fechaTarjeta(), hoy: (() => {
    const d = new Date(); return String(d.getDate()).padStart(2,'0') + '/' +
      String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear(); })() }));
  ok(trasRecargar.f === hace3,
     `después de una recarga sigue diciendo el día de la vuelta (${hace3}, dice ${trasRecargar.f})`);
  ok(trasRecargar.f !== trasRecargar.hoy,
     'y no la cambia por la de hoy');
  ok(!/31\/07\/2026/.test(await p2.evaluate(() => { S.tab='tarjeta'; render();
       return document.getElementById('screen').innerText; })),
     'la fecha vieja escrita a mano no aparece más');

  await t1.ctx.close(); await t2.ctx.close(); await t3.ctx.close(); await t4.ctx.close();
  console.log(`\n${pasaron} bien · ${fallaron} mal`);
  console.log('Errores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
  process.exit(fallaron ? 1 : 0);
})();
