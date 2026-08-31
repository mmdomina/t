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

const FN = {
  ronda_abrir(a){
    const c = up(a.p_codigo);
    if(!rondas.has(c)) rondas.set(c, { codigo:c, club:a.p_club, cancha:a.p_cancha,
      vuelta:a.p_vuelta ?? 18, torneo:!!a.p_torneo, creada:ahora(), cerrada:false });
    FN._jugador(c, a);
    return FN.ronda_estado({ p_codigo:c, p_desde:null });
  },
  ronda_unirse(a){
    const c = up(a.p_codigo);
    const r = rondas.get(c);
    if(!r || r.cerrada) return { error:'no existe esa ronda' };
    FN._jugador(c, a);
    return FN.ronda_estado({ p_codigo:c, p_desde:null });
  },
  _jugador(c, a){
    const prev = jugadores.get(a.p_jugador) || {};
    jugadores.set(a.p_jugador, { ...prev, id:a.p_jugador, ronda:c, nombre:a.p_nombre,
      iniciales:a.p_iniciales, index_hcp:a.p_index, hcp_cancha:a.p_hcp,
      salida:a.p_salida, marca_a:prev.marca_a ?? null, visto:ahora() });
  },
  ronda_estado(a){
    const c = up(a.p_codigo);
    return {
      ronda: rondas.get(c) || null,
      jugadores: [...jugadores.values()].filter(j => j.ronda === c),
      anotaciones: [...anotaciones.values()].filter(x =>
        x.ronda === c && (!a.p_desde || x.actualizado > a.p_desde)),
      ahora: ahora()
    };
  },
  anotar(a){
    const c = up(a.p_codigo);
    if(![...jugadores.values()].some(j => j.id === a.p_por && j.ronda === c))
      return { error:'ese jugador no está en la ronda' };
    const k = `${c}|${a.p_de}|${a.p_por}|${a.p_hoyo}`;
    anotaciones.set(k, { ronda:c, de:a.p_de, por:a.p_por, hoyo:a.p_hoyo,
      golpes:a.p_golpes ?? null, putts:a.p_putts ?? null, bunker:a.p_bunker ?? null,
      penal:a.p_penal ?? null, salida_fw:a.p_salida_fw ?? null, actualizado:ahora() });
    return { ok:true };
  },
  marcar_a(a){
    const j = jugadores.get(a.p_jugador);
    if(!j) return { ok:false };
    j.marca_a = a.p_a; j.visto = ahora();
    return { ok:true };
  },
  ronda_cerrar(a){
    const r = rondas.get(up(a.p_codigo));
    if(r) r.cerrada = true;
    return { ok:!!r };
  }
};

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
