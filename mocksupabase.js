/* Servidor falso que imita las funciones de Supabase que usa la app.
   Sirve para probar la ronda compartida sin tener que crear el proyecto. */
const http = require('http');

const rondas = new Map();      // codigo -> {…}
const jugadores = new Map();   // id -> {…}
const anotaciones = new Map(); // "ronda|de|por|hoyo" -> {…}

/* Reloj que nunca repite un milisegundo: así "lo que cambió desde X"
   no se saltea nada cuando dos escrituras caen juntas. */
let ultimo = 0;
const ahora = () => { const t = Math.max(Date.now(), ultimo + 1); ultimo = t; return new Date(t).toISOString(); };

let caido = false;             // para simular que el servidor no responde
let latencia = 0;

const up = s => String(s || '').toUpperCase();
/* Igual que `llave_nueva()` y `recortar()` en esquema.sql. */
const llaveNueva = () => Array.from({length:8},
  () => Math.random().toString(16).slice(2,10)).join('').slice(0,64);
const recortar = (t, n) => { const v = String(t ?? '').trim().slice(0, n); return v || null; };

const FN = {
  ronda_abrir(a){
    const c = up(a.p_codigo);
    const y = rondas.get(c);
    if(y && y.borrado_en) return { error:'ese código está ocupado' };
    if(!y) rondas.set(c, { codigo:c, club:recortar(a.p_club,40), cancha:recortar(a.p_cancha,60),
      vuelta:a.p_vuelta ?? 18, torneo:!!a.p_torneo, creada:ahora(),
      cerrada:false, borrado_en:null });
    const k = FN._jugador(c, a);
    if(!k) return { error:'ese jugador ya está en la ronda desde otro teléfono' };
    return { ...FN.ronda_estado({ p_codigo:c, p_desde:null }), llave:k };
  },
  ronda_unirse(a){
    const c = up(a.p_codigo);
    const r = rondas.get(c);
    if(!r || r.cerrada || r.borrado_en) return { error:'no existe esa ronda' };
    const k = FN._jugador(c, a);
    if(!k) return { error:'ese jugador ya está en la ronda desde otro teléfono' };
    return { ...FN.ronda_estado({ p_codigo:c, p_desde:null }), llave:k };
  },
  /* Devuelve la llave del jugador, o null si el puesto es de otro teléfono.
     Mismo contrato que `entrar_jugador()` en esquema.sql. */
  _jugador(c, a){
    const prev = jugadores.get(a.p_jugador) || {};
    let llave = prev.llave || null;
    if(llave && a.p_llave !== llave) return null;
    if(!llave){
      const vivos = [...jugadores.values()].filter(j => j.ronda === c && !j.borrado_en).length;
      if(vivos >= 8) return null;
      llave = llaveNueva();
    }
    jugadores.set(a.p_jugador, { ...prev, id:a.p_jugador, ronda:c,
      nombre:recortar(a.p_nombre,40) || '—', iniciales:recortar(a.p_iniciales,4),
      index_hcp:a.p_index, hcp_cancha:a.p_hcp, salida:recortar(a.p_salida,12),
      marca_a:prev.marca_a ?? null, visto:ahora(), borrado_en:null, llave });
    return llave;
  },
  /* Igual que `ronda_estado` en esquema.sql: lo borrado no se sirve, pero en
     "lo que cambió desde X" las anotaciones borradas SÍ viajan, con su
     `borrado_en`, para que el otro teléfono las saque de la pantalla. */
  ronda_estado(a){
    const c = up(a.p_codigo);
    const r = rondas.get(c);
    return {
      ronda: (r && !r.borrado_en) ? r : null,
      borrada: !!(r && r.borrado_en),
      /* Campo por campo y NO la fila entera: `llave` no sale nunca. */
      jugadores: [...jugadores.values()].filter(j => j.ronda === c && !j.borrado_en)
        .map(({llave, ...j}) => j),
      anotaciones: [...anotaciones.values()].filter(x => x.ronda === c &&
        (a.p_desde ? x.actualizado > a.p_desde : !x.borrado_en)),
      ahora: ahora()
    };
  },
  anotar(a){
    const c = up(a.p_codigo);
    const r = rondas.get(c);
    if(!r || r.borrado_en || r.cerrada) return { error:'esa ronda ya no está abierta' };
    const yo = jugadores.get(a.p_por);
    if(!yo || yo.ronda !== c || yo.borrado_en || !yo.llave || yo.llave !== a.p_llave)
      return { error:'no sos vos' };
    if(![...jugadores.values()].some(j => j.id === a.p_de && j.ronda === c && !j.borrado_en))
      return { error:'ese jugador no está en la ronda' };
    const k = `${c}|${a.p_de}|${a.p_por}|${a.p_hoyo}`;
    anotaciones.set(k, { ronda:c, de:a.p_de, por:a.p_por, hoyo:a.p_hoyo,
      golpes:a.p_golpes ?? null, putts:a.p_putts ?? null, bunker:a.p_bunker ?? null,
      penal:a.p_penal ?? null, salida_fw:recortar(a.p_salida_fw,12), actualizado:ahora(),
      borrado_en:null });
    return { ok:true };
  },
  marcar_a(a){
    const c = up(a.p_codigo);
    const j = jugadores.get(a.p_jugador);
    if(a.p_a && ![...jugadores.values()].some(x => x.id === a.p_a && x.ronda === c && !x.borrado_en))
      return { error:'ese jugador no está en la ronda' };
    if(!j || j.borrado_en || !j.llave || j.llave !== a.p_llave) return { error:'no sos vos' };
    j.marca_a = a.p_a; j.visto = ahora();
    return { ok:true };
  },
  ronda_cerrar(a){
    const c = up(a.p_codigo);
    const r = rondas.get(c);
    if(![...jugadores.values()].some(j => j.ronda === c && !j.borrado_en
        && j.llave && j.llave === a.p_llave)) return { error:'no sos de esta ronda' };
    if(!r || r.borrado_en) return { ok:false };
    r.cerrada = true;
    return { ok:true };
  }
};

/* Borrar y restaurar NO son funciones de la app: en el servidor de verdad
   `anon` no las puede llamar. Por eso acá tampoco viven en FN — se disparan
   desde el panel del test, que es el equivalente del SQL Editor. */
function borrarRonda(c){
  c = up(c);
  const r = rondas.get(c); if(!r) return 0;
  [...anotaciones.values()].filter(x => x.ronda === c && !x.borrado_en)
    .forEach(x => { x.borrado_en = ahora(); x.actualizado = x.borrado_en; });
  [...jugadores.values()].filter(j => j.ronda === c).forEach(j => j.borrado_en = ahora());
  r.borrado_en = ahora();
  return 1;
}
function restaurarRonda(c){
  c = up(c);
  const r = rondas.get(c); if(!r || !r.borrado_en) return 0;
  [...anotaciones.values()].filter(x => x.ronda === c && x.borrado_en)
    .forEach(x => { x.borrado_en = null; x.actualizado = ahora(); });
  [...jugadores.values()].filter(j => j.ronda === c).forEach(j => j.borrado_en = null);
  r.borrado_en = null;
  return 1;
}

const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'apikey, authorization, content-type, prefer',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Max-Age':'86400'
};

const server = http.createServer((req, res) => {
  if(req.method === 'OPTIONS'){ res.writeHead(204, CORS); return res.end(); }

  // el panel de control del test
  if(req.url.startsWith('/__test')){
    const u = new URL(req.url, 'http://x');
    if(u.searchParams.has('caido'))    caido = u.searchParams.get('caido') === '1';
    if(u.searchParams.has('latencia')) latencia = +u.searchParams.get('latencia');
    if(u.searchParams.has('reset')){ rondas.clear(); jugadores.clear(); anotaciones.clear(); }
    if(u.searchParams.has('borrar'))    borrarRonda(u.searchParams.get('borrar'));
    if(u.searchParams.has('restaurar')) restaurarRonda(u.searchParams.get('restaurar'));
    res.writeHead(200, {...CORS, 'Content-Type':'application/json'});
    return res.end(JSON.stringify({ caido, latencia, rondas:rondas.size,
      jugadores:jugadores.size, anotaciones:anotaciones.size }));
  }

  const m = req.url.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if(req.method !== 'POST' || !m || !FN[m[1]] || m[1].startsWith('_')){
    res.writeHead(404, {...CORS, 'Content-Type':'application/json'});
    return res.end('{"error":"no existe"}');
  }
  if(caido){
    res.writeHead(503, {...CORS, 'Content-Type':'application/json'});
    return res.end('{"error":"servidor caído"}');
  }
  let cuerpo = '';
  req.on('data', c => cuerpo += c);
  req.on('end', () => {
    let args = {};
    try{ args = JSON.parse(cuerpo || '{}'); }catch(e){}
    const responder = () => {
      let out;
      try{ out = FN[m[1]](args); }
      catch(e){ res.writeHead(500, {...CORS,'Content-Type':'application/json'});
                return res.end(JSON.stringify({error:e.message})); }
      res.writeHead(200, {...CORS, 'Content-Type':'application/json'});
      res.end(JSON.stringify(out));
    };
    latencia ? setTimeout(responder, latencia) : responder();
  });
});

server.listen(8100, () => console.log('supabase falso en http://localhost:8100'));
