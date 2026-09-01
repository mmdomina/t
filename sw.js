/* ============================================================
   SERVICE WORKER — que la app funcione sin señal
   ============================================================
   En la cancha hay tramos sin datos y una vuelta dura cuatro horas.
   Acá guardamos la app entera en el teléfono: abre igual de rápido
   con conexión o sin ella.

   Cómo se actualiza
   Al abrir servimos lo guardado, que es instantáneo, y en paralelo
   preguntamos si hay algo nuevo. Si lo hay, queda esperando y la app
   avisa. Nunca entra una versión nueva en el medio de una vuelta.

   IMPORTANTE AL PUBLICAR UNA VERSIÓN NUEVA
   Subir el número de VERSION acá abajo. Ese cambio es lo que le dice
   al teléfono que hay algo nuevo para bajar. Si no se toca, los
   teléfonos que ya tienen la app pueden seguir con la vieja.
   ============================================================ */

const VERSION = 'trisquelia-v9';

/* Todo lo que tiene que estar en el teléfono para que la app abra sola.

   Ojo con la tentación de agregar './' acá: la app pesa 321 KB y el
   handler de navegación de más abajo SIEMPRE guarda y busca con la
   clave './index.html', nunca './'. Tenerla en la lista bajaba el
   archivo dos veces y ocupaba el doble en el teléfono, para nada. */
const SHELL = [
  './index.html',
  './manifest.webmanifest',
  './medir.html',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    /* Uno por uno y sin cortar por un error: si falla un ícono no
       queremos que se caiga la instalación entera y el jugador se
       quede sin app offline por una pavada. */
    await Promise.all(SHELL.map(u =>
      c.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const viejas = (await caches.keys()).filter(n => n !== VERSION);
    await Promise.all(viejas.map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* La app pide entrar cuando el jugador no está en el medio de una vuelta. */
self.addEventListener('message', e => {
  if (e.data && e.data.tipo === 'ACTIVAR') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // nada de afuera

  /* ---- Abrir la app ----
     Primero lo guardado, que abre al toque incluso sin señal, y
     mientras tanto pedimos la versión fresca para la próxima vez. */
  if (req.mode === 'navigate') {
    const clave = url.pathname.endsWith('/medir.html')
      ? './medir.html'
      : './index.html';
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const guardado = await c.match(clave);
      const red = fetch(req)
        .then(r => { if (r && r.ok) c.put(clave, r.clone()); return r; })
        .catch(() => null);
      e.waitUntil(red);                       // que no lo maten a mitad de camino
      return guardado || (await red) || sinConexion();
    })());
    return;
  }

  /* ---- Todo lo demás: íconos, manifest ---- */
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const guardado = await c.match(req);
    if (guardado) return guardado;
    try {
      const r = await fetch(req);
      if (r && r.ok && r.type === 'basic') c.put(req, r.clone());
      return r;
    } catch (err) {
      return Response.error();
    }
  })());
});

function sinConexion() {
  return new Response(
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="margin:0;background:#070e18;color:#eaf5ee;font-family:system-ui,sans-serif;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;padding:26px;text-align:center">' +
    '<div><p style="font-size:19px;font-weight:700;margin:0 0 8px">Todavía no está guardada acá</p>' +
    '<p style="font-size:15px;color:#8fae9c;margin:0;line-height:1.6">Abrila una vez con señal ' +
    'y después funciona sola, aunque estés en el medio de la cancha.</p></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
