/* Que los cuatro caminos para sacar los datos funcionen. */
const { chromium, devices } = require('playwright');
const EXE = process.env.CHROME_PATH || undefined;
const ok = (c,m) => console.log((c?'  ✓ ':'  ✗ ')+m);
(async()=>{
  const b = await chromium.launch(EXE ? {executablePath:EXE} : {});
  const ctx = await b.newContext({...devices['Pixel 7'], permissions:['geolocation','clipboard-read','clipboard-write'],
    geolocation:{latitude:-35.65565, longitude:-63.79215, accuracy:5}, acceptDownloads:true});
  const p = await ctx.newPage();
  const errores=[]; p.on('pageerror',e=>errores.push(e.message));
  await p.addInitScript(()=>{ window.confirm=()=>true; try{ localStorage.setItem('trisquelia_v1',
    JSON.stringify({v:1,onboarded:true,tipo:'socio',tee:'mixta',vuelta:18,hole:5,
    user:{name:'Mauro Domina',ini:'MD',hcp:7.4,socio:'#1',club:'Trisquelia Golf Club',cat:'cab'}}));}catch(e){} });
  await p.goto('http://localhost:8000/',{waitUntil:'load'});
  await p.waitForTimeout(1400);

  // una prueba con datos, como después de una vuelta
  await p.evaluate(()=>{
    arrancarPrueba();
    const t0 = PRUEBA.desde;
    PRUEBA.muestras = [];
    for(let i=0;i<200;i++) PRUEBA.muestras.push({t:t0+i*20000, hoyo:1+Math.floor(i/11),
      hay:i%40!==0, acc: i%40===0?undefined:4+(i%9), bat:100-Math.floor(i/12)});
    PRUEBA.estacas = [{t:t0,hoyo:3,estaca:150,centro:157,frente:145,fondo:168,acc:5,gpsReal:true},
                      {t:t0,hoyo:7,estaca:100,centro:106,frente:96,fondo:117,acc:4,gpsReal:true}];
    PRUEBA.notas = [{t:t0,hoyo:4,txt:'el botón de cerrar el hoyo queda muy abajo'}];
    pararPrueba();
  });
  await p.waitForTimeout(400);
  await p.evaluate(()=>go('prueba'));
  await p.waitForTimeout(500);

  console.log('\n1. Compartir');
  const share = await p.evaluate(async ()=>{
    let capturado = null;
    navigator.share = async d => { capturado = {archivos:(d.files||[]).map(f=>({n:f.name,t:f.type,size:f.size}))}; };
    navigator.canShare = () => true;
    await compartirPrueba();
    return capturado;
  });
  ok(share && share.archivos.length===1 && share.archivos[0].n==='trisquelia-prueba.json',
     `abre la hoja del sistema con ${share&&share.archivos[0].n} (${share&&share.archivos[0].size} bytes)`);

  const cancel = await p.evaluate(async ()=>{
    navigator.share = async () => { const e=new Error('x'); e.name='AbortError'; throw e; };
    navigator.canShare = () => true;
    try{ await compartirPrueba(); return 'sin romper'; }catch(e){ return 'rompió: '+e.message; }
  });
  ok(cancel==='sin romper', 'si cancelás la hoja, no pasa nada');

  console.log('\n2. Copiar el resumen');
  await p.evaluate(()=>copiarResumen());
  await p.waitForTimeout(400);
  const txt = await p.evaluate(()=>navigator.clipboard.readText());
  ok(/Prueba en cancha/.test(txt) && /GPS:/.test(txt) && /Estacas:/.test(txt),
     `${txt.split('\n').length} líneas al portapapeles`);
  ok(/hoyo 3: estaca 150, la app dijo 157/.test(txt), 'trae las estacas una por una');
  ok(/nota hoyo 4/.test(txt), 'y las notas');
  ok(!/\bnull\b|\bNaN\b|undefined/.test(txt), 'sin huecos');
  console.log('    ---\n    ' + txt.split('\n').slice(0,6).join('\n    '));

  console.log('\n3. Ver en pantalla');
  for(const [cual, espero] of [['resumen',/Prueba en cancha/],['todo',/"muestras"/]]){
    await p.evaluate(c=>verDatos(c), cual);
    await p.waitForTimeout(350);
    const v = await p.evaluate(()=>{ const t=document.getElementById('salidaPrueba');
      return t ? {largo:t.value.length, ini:t.value.slice(0,40)} : null; });
    ok(v && espero.test(v.ini) || (cual==='todo' && v && v.largo>5000),
       `"${cual}": ${v?v.largo:0} caracteres en el cuadro`);
  }
  await p.evaluate(()=>verDatos('todo'));
  await p.waitForTimeout(300);
  ok(await p.evaluate(()=>!document.getElementById('salidaPrueba')), 'se cierra tocando de nuevo');

  console.log('\n4. Bajar el archivo');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(()=>bajarPrueba())]);
  ok(dl.suggestedFilename()==='trisquelia-prueba.json', 'sigue bajando igual que antes');

  console.log('\n5. Nada se rompió');
  const pant = await p.evaluate(()=>document.getElementById('screen').innerText.replace(/\s+/g,' '));
  ok(!/\bnull\b|\bNaN\b|undefined|Infinity/.test(pant), 'la pantalla sin basura');
  console.log('\nErrores:', errores.length?errores:'ninguno');
  await b.close();
})();
