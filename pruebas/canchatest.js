/* Para correrlo:  node pruebas/canchatest.js
   Hace falta un servidor sirviendo la app en http://localhost:8000
   (por ejemplo: python3 -m http.server 8000 dentro de la carpeta del repo).
   Si Playwright no encuentra Chromium solo, pasále la ruta en CHROME_PATH. */
/* LA TARJETA OFICIAL, COPIADA APARTE.
   Esta copia de la recategorización de la AAG (septiembre de 2026) está duplicada
   a propósito: es el control cruzado de los números con los que se compite. Si
   alguien cambia un número en index.html y no acá —o al revés— la suite se pone en
   rojo y nadie publica una tarjeta mal cargada. Con la tabla anterior el handicap
   de cancha daba hasta 4 golpes de más en blancas/azules, que es la salida de la
   mayoría de los socios: este archivo existe para que eso no vuelva a pasar sin que
   alguien se entere.
   Los índices de prueba son inventados: acá no va el de nadie. */
const { chromium } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const APP = 'http://localhost:8000/index.html';
let hechas = 0, fallas = 0;
const ok = (c, m) => { hechas++; if(!c) fallas++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };

const TARJETA = {
  par: [4,4,5,3,4,4,4,3,5, 4,4,5,3,4,4,4,3,4],
  /* Una sola valuación para las tres salidas, damas incluida: impares en la ida,
     pares en la vuelta. El 9 es el más difícil (1 y 2), el 8 el más fácil (17 y 18). */
  hcp: [15,9,7,13,11,5,3,17,1, 16,10,8,14,12,6,4,18,2],
  salidas: {
    negras: { n:'Negras', r:72.5, s:128, total:6797,
      nueve:{ ida:{r:36.6,s:128}, vuelta:{r:35.9,s:127} },
      y:[371,450,530,190,370,432,445,140,541, 371,450,530,170,370,432,445,140,420] },
    mixta:  { n:'Blancas / Azules', r:69.6, s:120, total:6284,
      nueve:{ ida:{r:34.9,s:122}, vuelta:{r:34.7,s:117} },
      y:[330,400,515,175,310,422,400,120,503, 348,430,507,155,335,400,425,110,399] },
    damas:  { n:'Damas', r:71.7, s:124, total:5546,
      nueve:{ ida:{r:36.2,s:125}, vuelta:{r:35.5,s:122} },
      y:[310,385,465,122,250,360,380,95,463, 310,385,465,122,250,360,380,95,349] }
  }
};
const suma = a => a.reduce((x,y)=>x+y,0);
/* La fórmula del WHS, escrita acá de nuevo y a mano, para no probar la app con la
   app. 18 hoyos: index × slope/113 + (rating − par).
   9 hoyos (regla 6.1b): la mitad del index redondeada a la décima, con el rating y
   el slope DE ESE NUEVE y el par de ese nueve. */
const whs18 = (idx, t) => Math.round(idx*(t.s/113) + (t.r - 71));
const whs9  = (idx, t) => Math.round((Math.round(idx*5)/10)*(t.nueve.ida.s/113)
                                     + (t.nueve.ida.r - 36));
const INDICES = [-2.0, 0, 3.7, 5.0, 10.3, 11.2, 14.6, 18.0, 25.5, 36.0, 54.0];

const SEMILLA = { v:1, onboarded:true, tipo:'socio', tee:'mixta', vuelta:18, hole:1,
  playing:false, torneo:false, indexDias:2,
  user:{ name:'Socio Uno', ini:'S1', hcp:12.0, socio:'—', club:'Trisquelia Golf Club', cat:'cab' } };

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
    deviceScaleFactor:2 });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  await p.addInitScript(s => { window.confirm = () => true;
    try { localStorage.setItem('trisquelia_v1', JSON.stringify(s)); } catch (e) {} }, SEMILLA);
  await p.goto(APP, { waitUntil:'load' });
  await p.waitForTimeout(1200);
  const pantalla = () => p.evaluate(() => document.getElementById('screen').innerText.replace(/\s+/g,' '));

  console.log('\n1. La tarjeta cargada es la de la federación, hoyo por hoyo');
  const C = await p.evaluate(() => ({
    par: COURSE.holes.map(h=>h.par),
    hcp: COURSE.holes.map(h=>h.hcp),
    y:   COURSE.holes.map(h=>h.y),
    parTotal: CLUB.cancha.par,
    tees: CLUB.tees.map(t=>({ id:t.id, n:t.n, r:t.r, s:t.s, y:t.y, nueve:t.nueve }))
  }));
  ok(JSON.stringify(C.par) === JSON.stringify(TARJETA.par), 'el par de los 18 hoyos');
  ok(JSON.stringify(C.hcp) === JSON.stringify(TARJETA.hcp), 'la valuación de los 18 hoyos');
  ok(C.parTotal === 71 && suma(C.par) === 71, 'par 71, y la suma da 71');
  ok(suma(C.par.slice(0,9)) === 36 && suma(C.par.slice(9)) === 35, 'par 36 la ida y 35 la vuelta');
  for(const id of ['negras','mixta','damas']){
    const esp = TARJETA.salidas[id], t = C.tees.find(x=>x.id===id);
    ok(!!t, `la salida ${esp.n} existe`);
    ok(JSON.stringify(t.y) === JSON.stringify(esp.y), `${esp.n}: las 18 yardas`);
    ok(t.r === esp.r && t.s === esp.s, `${esp.n}: rating ${esp.r} y slope ${esp.s}`);
    ok(!!t.nueve && t.nueve.ida.r === esp.nueve.ida.r && t.nueve.ida.s === esp.nueve.ida.s
       && t.nueve.vuelta.r === esp.nueve.vuelta.r && t.nueve.vuelta.s === esp.nueve.vuelta.s,
       `${esp.n}: rating y slope de cada nueve`);
  }
  ok(JSON.stringify(C.y) === JSON.stringify(TARJETA.salidas.mixta.y),
     'la yarda de referencia de cada hoyo es la de blancas/azules');

  console.log('\n2. Las cuentas de la tarjeta cierran solas');
  for(const id of ['negras','mixta','damas']){
    const esp = TARJETA.salidas[id], t = C.tees.find(x=>x.id===id);
    ok(suma(t.y) === esp.total, `${esp.n}: ida + vuelta = ${esp.total}`);
    ok(Math.abs((t.nueve.ida.r + t.nueve.vuelta.r) - t.r) < 0.001,
       `${esp.n}: el rating de la ida más el de la vuelta da el de 18`);
  }
  ok(C.tees.find(x=>x.id==='negras').y.reduce((a,b)=>a+b,0)
     - C.tees.find(x=>x.id==='mixta').y.reduce((a,b)=>a+b,0) === 513,
     'negras da 513 yardas más que blancas/azules — el "540 contra 273" del acta');
  ok(JSON.stringify(C.hcp.slice().sort((a,b)=>a-b)) === JSON.stringify(
       Array.from({length:18},(_,i)=>i+1)), 'la valuación va del 1 al 18 sin repetir');
  ok(C.hcp.slice(0,9).every(h=>h%2===1) && C.hcp.slice(9).every(h=>h%2===0),
     'impares en la ida, pares en la vuelta');

  console.log('\n3. Las tres salidas están homologadas');
  const H = await p.evaluate(() => CLUB.tees.map(t=>({
    id:t.id, homo:homologada(t), txt:ratingTxt(t), hcpDe:teeDelHcp(t).id })));
  for(const t of H){
    ok(t.homo === true, `${t.id}: tiene rating y slope oficiales`);
    ok(t.hcpDe === t.id, `${t.id}: da su propio handicap de cancha`);
    ok(!/sin homologar|sin medir/.test(t.txt), `${t.id}: la app ya no dice "sin homologar"`);
  }
  const neg = await p.evaluate(() => salidaPorIndex(8.0,'cab'));
  ok(neg && neg.tee === 'negras' && neg.hcpCon === 'negras',
     'el que sale de negras recibe el handicap de negras, no el de blancas/azules');
  ok(neg && !neg.aviso, 'y ya no hay que avisarle que su salida no está medida');

  console.log('\n4. El handicap de cancha de 18 hoyos sigue la fórmula del WHS');
  for(const id of ['negras','mixta','damas']){
    const esp = TARJETA.salidas[id];
    const dados = await p.evaluate(({id, idxs}) =>
      idxs.map(i => hcpCancha(i, CLUB.tees.find(t=>t.id===id), 18)), {id, idxs:INDICES});
    const esperados = INDICES.map(i => whs18(i, esp));
    ok(JSON.stringify(dados) === JSON.stringify(esperados),
       `${esp.n}: ${INDICES.length} índices, de +2.0 a 54.0 — ${dados.join(' ')}`);
  }

  console.log('\n5. En 9 hoyos se aplica la regla 6.1b, no la mitad de 18');
  for(const id of ['negras','mixta','damas']){
    const esp = TARJETA.salidas[id];
    const dados = await p.evaluate(({id, idxs}) =>
      idxs.map(i => hcpCancha(i, CLUB.tees.find(t=>t.id===id), 9)), {id, idxs:INDICES});
    const esperados = INDICES.map(i => whs9(i, esp));
    ok(JSON.stringify(dados) === JSON.stringify(esperados),
       `${esp.n}: con el rating y el slope de la ida — ${dados.join(' ')}`);
  }
  /* El caso que muestra por qué no alcanza con dividir por dos: en negras la mitad
     del rating de 18 es 36.25 y el de la ida es 36.6, y el slope de la ida es otro.
     Con index 18.0 eso es un golpe de diferencia, y un golpe define un partido. */
  const nueveMal = await p.evaluate(() => ['negras','mixta'].map(id => {
    const t = CLUB.tees.find(x=>x.id===id);
    return { id, bien: hcpCancha(18.0, t, 9),
             comoAntes: Math.round(18.0*0.5*(t.s/113) + (t.r*0.5 - 36)) };
  }));
  for(const c of nueveMal){
    ok(c.bien === whs9(18.0, TARJETA.salidas[c.id]),
       `index 18.0 a 9 hoyos en ${c.id} da ${c.bien}`);
    ok(c.bien !== c.comoAntes,
       `y la cuenta vieja daba ${c.comoAntes}: un golpe de diferencia, por eso se cambió`);
  }
  ok(await p.evaluate(() => hcpCancha(14.0, CLUB.tees.find(t=>t.id==='mixta'), 9)
                         === Math.round(7*(122/113) + (34.9 - 36))),
     'un index par se parte exacto y no hay redondeo que discutir');
  ok(await p.evaluate(() => hcpCancha(14.5, CLUB.tees.find(t=>t.id==='mixta'), 9)
                         === Math.round(7.3*(122/113) + (34.9 - 36))),
     'un index impar se redondea a la décima ANTES de calcular (14.5 → 7.3)');

  console.log('\n6. Sin index no hay número inventado');
  ok(await p.evaluate(() => hcpCancha(null, CLUB.tees.find(t=>t.id==='mixta'), 18) === null),
     'hcpCancha sin index devuelve null');
  ok(await p.evaluate(() => { S.user.hcp = null; S.tab='handicap'; render();
       return !/\bnull\b|\bNaN\b/.test(document.getElementById('screen').innerText); }),
     'y la pantalla del handicap muestra "—" en vez de un número');
  await p.evaluate(() => { S.user.hcp = 12.0; render(); });

  console.log('\n7. Lo que ve el socio en pantalla');
  await p.evaluate(() => { S.tab='handicap'; render(); });
  await p.waitForTimeout(200);
  const hcpTxt = await pantalla();
  for(const id of ['negras','mixta','damas']){
    const esp = TARJETA.salidas[id];
    ok(hcpTxt.includes(`${esp.r}/${esp.s}`), `la tabla muestra ${esp.n} ${esp.r}/${esp.s}`);
    ok(hcpTxt.includes(String(esp.total)), `y sus ${esp.total} yardas`);
    const n = await p.evaluate(id => String(hcpCancha(S.user.hcp, CLUB.tees.find(t=>t.id===id), 18)), id);
    ok(hcpTxt.includes(n), `y el handicap de cancha calculado (${n}) para un index de 12.0`);
  }
  ok(/6\.1b/.test(hcpTxt), 'y explica de dónde sale el de 9 hoyos');

  console.log('\n8. La referencia de cancha, salida por salida');
  for(const id of ['negras','mixta','damas']){
    const esp = TARJETA.salidas[id];
    await p.evaluate(id => { S.tee=id; S.tab='club'; S.clubTab='cancha'; render(); }, id);
    await p.waitForTimeout(150);
    const t = await pantalla();
    ok(t.includes(`${esp.total} yds`), `${esp.n}: el total de la salida elegida`);
    ok(t.includes(`${esp.r}/${esp.s}`), `${esp.n}: su rating y su slope`);
    ok(TARJETA.hcp.slice(0,9).every(h => t.includes(String(h))),
       `${esp.n}: la valuación es la misma para todas`);
  }

  console.log('\n9. Nada se rompió');
  for(const tab of ['home','play','stats','club','handicap','tarjeta','arranque','me']){
    await p.evaluate(t => { S.tab=t; render(); }, tab);
    await p.waitForTimeout(120);
    const txt = await pantalla();
    ok(!/\bnull\b|\bNaN\b|undefined|Infinity|\[object/.test(txt), `pantalla ${tab} sin basura`);
  }

  console.log('\nComprobaciones:', hechas, '· fallas:', fallas);
  console.log('Errores de JavaScript:', errores.length ? errores : 'ninguno');
  await b.close();
  process.exit(fallas || errores.length ? 1 : 0);
})();
