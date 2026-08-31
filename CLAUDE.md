# CLAUDE.md — cómo trabajar en este repo

App del **Trisquelia Golf Club** (General Pico, La Pampa). Un lado jugador —GPS, tarjeta,
estadísticas, bolsa, handicap— y un lado comisión —salidas, padrón, torneos, avisos, estado de
cancha, cuotas, permisos—. Se instala en el teléfono desde el navegador y funciona sin señal.

Publicada en **https://mmdomina.github.io/t/** (GitHub Pages, rama `main`, carpeta raíz).

---

## 1. La regla más importante

**`index.html` es la fuente de verdad. Se edita directo, a mano.**

Hubo una etapa en que este archivo se generaba con scripts de parcheo desde un `app.html`
anterior. Eso ya no existe y no hay que resucitarlo: el resultado acumulado ES `index.html`.
Si aparece algo que dice "rebuild", ignoralo.

No hay build, ni empaquetador, ni dependencias. Un archivo HTML con todo adentro. Eso no es
descuido: es lo que hace que la app se comparta por link, se guarde entera en el teléfono con
una sola línea de service worker, y ande sin señal. **No lo partas en módulos** hasta que haya
una razón concreta (claves de servidor que no puedan ir en el código, o un despliegue real).

---

## 2. Mapa de `index.html`

Son ~5.220 líneas. Los números se corren al editar; buscá el texto, no la línea.

| Dónde | Qué |
|---|---|
| `PENDIENTE DE CONFIRMAR CON EL CLUB` (~312) | **El acta del proyecto.** `[x]` confirmado, `[ ]` pendiente |
| `const CLUBS_DB` (~472) | Todo lo que cambia de un club a otro. Para otro club se copia este bloque y listo |
| `geo:{` (~567) | Las 65 coordenadas medidas en cancha el 5/8/2026, ±3-4 m |
| `const PADRON` (~731) | Padrón de prueba, **inventado**. El real vive en el servidor |
| `const BAG` (~853) | Los 31 palos y la media ponderada |
| `MEDIDA Y HOMOLOGACIÓN` (~1029) | `homologada()`, `teeDelHcp()`, `ratingTxt()` |
| `function hcpCancha` (~1062) | Handicap de cancha, fórmula del WHS |
| `function gps(` (~1154) | Distancia al frente, centro y fondo del green |
| `function holeSVG` (~1339) | El dibujo del hoyo |
| `function panelCierre` (~1552) | Cerrar el hoyo |
| `function vPlay` (~1640) | **La pantalla de jugar** (referente: Hole19) |
| `const HOJAS` (~1771) | Las hojas que se abren desde jugar |
| `function vArranque` (~2812) | Empezar la ronda |
| `PANTALLAS — CLUB` (~3466) | El panel de la comisión |
| `INSTALARLA Y QUE ANDE SIN SEÑAL` (~4166) | Service worker, instalación, actualizaciones |
| `MODO PRUEBA` (~4277) | Medir GPS y batería en la cancha |
| `const NUBE` (~4724) | ⚠️ **Los dos datos del servidor**. Vacíos = todo local |
| `const LS_KEY` (~5132) | Guardado en el teléfono |
| `function render()` (~5164) | El render |

Otros archivos: `sw.js` (offline), `manifest.webmanifest` (instalación), `medir.html`
(herramienta GPS para medir la cancha), `esquema.sql` (el servidor), `pruebas/`.

---

## 3. Publicar

Mauro sube los archivos desde la web de GitHub, arrastrándolos. Por eso **todo va suelto en la
raíz, sin carpetas** (salvo `pruebas/`, que no es parte de la app —
queda publicada igual, pero no la carga nadie).

**Al publicar una versión nueva hay que subir el número de `VERSION` en `sw.js`.**
No es opcional: es lo que le avisa a los teléfonos que ya tienen la app que hay algo nuevo.
Si no se toca, pueden seguir abriendo la versión vieja para siempre.

Va en `trisquelia-vN`. Al día de hoy: **v8**.

---

## 4. Convenciones

**El código está en castellano rioplatense** — nombres de función, variables y comentarios.
`homologada`, `teeDelHcp`, `encolar`, `latir`, `cruceHoyo`. Seguí así.

**Los comentarios explican el porqué, no el qué.** El mejor ejemplo está en el service worker
y en la ronda compartida: dicen *por qué* se preguntó cada seis segundos en vez de abrir un
websocket. Esos comentarios son lo que hace mantenible un archivo de 5.000 líneas.

**Nunca mostrar un número inventado.** Si no hay dato, la app lo dice: "sin conectar", "sin
medir", "no se puede calcular". Es la disciplina más valiosa del proyecto y la razón por la que
un club puede confiar en esto. No la pierdas por rellenar un hueco.

**El texto de la interfaz le habla al socio**, no al programador. "¿Estás parado en una estaca?",
"Quedate quieto donde estás", "Dictáselo a los demás".

---

## 5. Las trampas

**Datos personales: el repo es público.** Ya pasó una vez: había un DNI, un mail y un teléfono
reales en `PADRON`. En este repo no va ni un dato de nadie. Ni de prueba con números que
parezcan reales.

**No llames a `render()` mientras alguien escribe en un campo.** Redibujar destruye el input y
le borra lo que venía tecleando. Está comentado en el código; tocá sólo lo que cambia.

**El navegador de WhatsApp no da GPS ni deja instalar nada.** El link se comparte por ahí, así
que la app lo detecta (`EN_OTRA_APP`) y explica cómo salir a Chrome. No lo saques.

**Las negras están medidas pero NO homologadas.** Tienen yardas por GPS, no tienen rating ni
slope. Su handicap sale de la tabla de blancas/azules, que es lo que el club hace en el papel.
Usá `homologada(t)` y `teeDelHcp(t)`. **No existe `t.sinMedir`** — era un bug: la función se
llamaba `sinMedida` y cinco avisos nunca aparecieron.

**Las negras: 540 contra 273.** La tarjeta da 273 yardas más que blancas/azules; el club habla
de 540. Hasta que se aclare, no tocar el yardaje.

**El cruce son dos filas, no una.** Por cada jugador y hoyo puede haber dos anotaciones: la
suya y la de su marcador (`de` y `por`). Por eso dos teléfonos nunca escriben la misma fila y
no hay conflictos que resolver. Si alguna vez te tienta "unificar" eso en una sola fila,
estarías rompiendo lo mejor del diseño.

**Guardar después de cada cambio.** Una vuelta dura cuatro horas y Android recarga la pestaña
si el teléfono se bloquea. `guardarTodo()` corre en cada `render()`.

---

## 6. Las pruebas

En `pruebas/`. Necesitan Node, Playwright y la app servida en `http://localhost:8000`:

```bash
python3 -m http.server 8000 &          # desde la carpeta del repo
node pruebas/mock-supabase.js &        # servidor falso, sólo para nube-test
node pruebas/bugs.js                   # barre TODAS las pantallas buscando null/NaN/undefined
node pruebas/test-pwa.js               # instalación y offline          (18 ✓)
node pruebas/play-test.js              # la pantalla de jugar           (22 ✓)
node pruebas/prueba-test.js            # el modo prueba                 (28 ✓)
node pruebas/nube-test.js              # dos teléfonos a la vez         (22 ✓)
node pruebas/exportar-test.js          # sacar los datos del teléfono   (11 ✓)
```

`bugs.js` es el más barato y el que más encuentra: renderiza cada pantalla en una matriz de
estados (tres salidas × ronda vacía/jugando/terminada, cada solapa, el panel de cierre hoyo por
hoyo, el modo club con las cuatro personas, los siete pasos del alta) y busca `null`, `NaN`,
`undefined`, `Infinity` y `[object Object]` en el texto visible. **Corrélo después de cualquier
cambio.** Tiene que dar cero hallazgos.

Entre las cinco suites son **101 comprobaciones**. Si alguna se pone en rojo después de un
cambio tuyo, es un bug tuyo: estaban todas en verde el 26/8/2026.

Si Playwright no encuentra Chromium solo, pásale la ruta en `CHROME_PATH`.

---

## 7. Dónde está el resto del contexto

- **El acta de las decisiones del club** está adentro de `index.html`, en el bloque de
  comentarios de arriba de `CLUBS_DB`. Reglamento, tarjeta, salidas, personas, qué está
  confirmado y qué falta. **Léelo antes de tocar cualquier dato del club, y escribí ahí cada
  decisión nueva.**
- **El plan de producto, el análisis de competencia y el detalle de cada etapa** están en el
  proyecto de Claude llamado **App Golf**: `plan-producto.md`, `bugs-corregidos.md`,
  `modo-prueba.md`, `ronda-compartida.md`.

---

## 8. Estado y qué sigue

**Anda de verdad:** la cancha cargada de la tarjeta oficial y verificada, las distancias por GPS
con coordenadas medidas a pie, el handicap de cancha, la bolsa que se autocorrige, el registro
de golpes, la app instalable que funciona sin señal, el modo prueba, y la ronda compartida entre
teléfonos con el cruce de tarjetas.

**Falta que Mauro cree el proyecto de Supabase** y pegue los dos valores en `const NUBE`.
Mientras estén vacíos, la app funciona igual que siempre, todo local. Instrucciones en
`esquema.sql` y en el README.

**Lo próximo, en orden:**

1. **Jugar 18 hoyos con el modo prueba prendido.** Es el paso que sigue pendiente desde el
   principio y el que más va a enseñar. Nada de lo construido vio una cancha todavía.
2. Firma y entrega: que la tarjeta firmada le llegue de verdad al club.
3. Cuentas de verdad: padrón real y verificación por DNI. Hoy cualquiera con el código de una
   ronda entra y escribe el nombre que quiera — sirve para probar entre amigos, no para un
   torneo oficial.
4. El panel de la comisión, funcionando contra el servidor.
5. Rating y slope oficiales de las tres salidas (depende de la federación).

**Personas:** Mauro Domina (admin), Félix Córdoba (pro y oficial de reglas; salidas y
resultados), Chelo Caballero (avisos, cancha, padrón, cuotas), Daniel Rodríguez (torneos).
