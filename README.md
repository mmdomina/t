# Trisquelia

La app del Trisquelia Golf Club — General Pico, La Pampa.

Un lado para el jugador (GPS, tarjeta, estadísticas, bolsa, handicap) y otro para la comisión
(salidas, padrón, torneos, avisos, estado de la cancha, cuotas, permisos).

Se instala en el teléfono desde el navegador y funciona sin señal.

---

## Qué hay acá

```
index.html              La app entera. Un solo archivo, sin dependencias.
manifest.webmanifest    Nombre, íconos y colores para instalarla en el teléfono.
sw.js                   Guarda la app en el teléfono para que ande sin señal.
medir.html              Herramienta aparte para medir la cancha con GPS.
icon-192.png            Íconos, generados del logo oficial del club.
icon-512.png
maskable-512.png
apple-touch-icon.png
favicon-32.png
esquema.sql             El servidor: tablas y funciones para pegar en Supabase.
.nojekyll               Le dice a GitHub Pages que publique los archivos tal cual.
pruebas/                Las suites de Playwright. No son parte de la app.
```

Todo va suelto en la raíz, sin carpetas: así se sube de un solo arrastre desde la web
de GitHub y no hay forma de que quede anidado por error.

## Publicarla

Se sirve como archivos estáticos. **Tiene que ser por HTTPS**: sin eso el navegador no da
el GPS ni deja instalar la app.

Con GitHub Pages, que es gratis y alcanza de sobra:

1. En el repo, **Settings → Pages**.
2. En *Source* elegir **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Guardar. En un minuto queda en `https://mmdomina.github.io/t/`.

Ese es el link que se comparte con los socios.

## Publicar una versión nueva

1. Subir los archivos que cambiaron.
2. **Subir el número de `VERSION` en `sw.js`** (hoy `trisquelia-v8` → `trisquelia-v9`).

El paso 2 no es opcional: es lo que le avisa a los teléfonos que ya tienen la app que hay algo
nuevo para bajar. Si no se toca, pueden seguir abriendo la versión vieja.

Cuando un teléfono detecta la versión nueva, la app espera: si el jugador está en el medio de
una vuelta no cambia nada, y entra recién cuando termina.

## Cómo la instala un socio

**Android / Chrome** — la app muestra sola el botón "Agregar" en la pantalla de inicio.

**iPhone** — no hay botón, lo pide el sistema: tocar **Compartir** y después **Agregar a inicio**.
La app lo explica cuando detecta un iPhone.

En iPhone instalarla no es una comodidad, es necesario: WebKit le da almacenamiento permanente
justamente a las apps agregadas a la pantalla de inicio. Sin instalar, el sistema puede borrar
una tarjeta a medio cargar.

**Ojo con WhatsApp.** El navegador que abre adentro de WhatsApp no da GPS ni deja instalar nada.
La app lo detecta y explica cómo salir a Chrome, pero conviene aclararlo al compartir el link.

## Estado

Prototipo funcionando, todo local. Cada teléfono guarda lo suyo y no sale nada de ahí: no hay
servidor todavía. Eso significa que el padrón, la tarjeta cruzada con el marcador, la entrega
al club y los resultados publicados están simulados.

El plan de producto y lo que sigue están en el proyecto **App Golf**.

## Los datos del club

Todo lo que cambia de un club a otro vive en un solo bloque de `index.html`, `CLUBS_DB`.
Arriba de ese bloque hay una lista de decisiones con `[x]` para lo confirmado y `[ ]` para lo
pendiente: **esa lista es la fuente de verdad del proyecto**. Al decidir algo nuevo, escribirlo ahí.

El padrón que está en el código es inventado, para probar los tres caminos del alta. El padrón
real vive en el servidor y no se publica nunca.
