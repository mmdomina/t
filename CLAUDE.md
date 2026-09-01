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

Va en `trisquelia-vN`. Al día de hoy: **v9**.

---

## 4. Convenciones

**Esto es un producto, no una maqueta.** El plan es que se venda a otros clubes después de
Trisquelia, así que cada pantalla se juzga como se juzga una app que alguien paga: **intuitiva,
linda a la vista, cómoda de jugar, y simple para la comisión**. La vara del lado del jugador es
**Hole19** — si una pantalla nuestra es más confusa que la equivalente de Hole19, está mal, por
más que funcione. Del lado de la comisión la vara es otra: que una persona sin paciencia técnica
haga lo que vino a hacer sin que nadie le explique nada.

**Antes de cada tarea, decidí si hacen falta subagentes — y si hacen falta, usalos.** Este
archivo tiene 5.600 líneas y el esquema otras 400: barrerlos entero para responder una pregunta
es caro y sale peor. La regla es simple: si para empezar hay que *relevar* algo —dónde vive cada
cosa, qué se rompe si toco esto, qué hace hoy tal flujo— eso va a un subagente de exploración, en
paralelo, con un pedido concreto y la orden de devolver hechos y no recomendaciones. Si además el
cambio toca seguridad o datos, mandá uno **adversario**: que ataque lo que hay hoy y liste el daño
posible, sin proponer arreglos. Los dos hallazgos más graves del proyecto —el XSS almacenado por
el nombre del jugador y la suplantación por `on conflict (id)`— salieron de ahí, no de leer el
código de corrido. Decidilo siempre, aunque la respuesta sea que no hacen falta, y decí cuál fue
la decisión.

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

**El código de la ronda NO es una credencial.** Son seis letras que se dictan en voz alta en el
tee y se mandan por WhatsApp: es una dirección, sirve para entrar y nada más. Lo que prueba quién
sos es la **llave** que el servidor le da a cada teléfono al entrar (`jugadores.llave`), que
viaja en cada escritura y **nunca sale en `ronda_estado`** — por eso esa función arma el JSON
campo por campo en vez de usar `row_to_json`. Si agregás una columna a `jugadores`, fijate si
tiene que salir o no.

**Todo lo que viene del servidor pasa por `esc()` antes de un `innerHTML`.** Los nombres de los
jugadores los escribe cualquiera que tenga el código. Sin esto, un tercero entraba con el nombre
`<img src=x onerror=...>` y ejecutaba código en el teléfono de TODOS los del grupo, con acceso a
la tarjeta y a todo lo guardado. Comprobado con `nube-test`, no teórico.

**Un 200 con `{error:...}` no es un éxito.** `vaciarCola()` lo trataba como bueno: descartaba la
anotación, decía "al día", y el jugador creía que había anotado cuando en el servidor no había
nada. Si agregás una llamada, chequeá `res.error`.

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

**Nada se borra con `delete`.** Las tres tablas tienen `borrado_en`: borrar es ponerle fecha.
Una tarjeta es la prueba de una vuelta y tiene que poder volver (`restaurar_ronda`). El único
`delete` vive en `purgar_borradas()`, que hay que correr a mano y por omisión sólo toca lo que
se borró hace más de 90 días. Si agregás una tabla, va con `borrado_en` y sin `delete`.

**El borrado tiene que VIAJAR.** Una anotación borrada se manda igual en "lo que cambió desde
X", con su `borrado_en`, y el teléfono la saca. Si sólo dejás de mandarla, el otro teléfono la
muestra para siempre. Por eso borrar toca `actualizado`.

**Toda función nueva del servidor nace abierta.** Postgres le da `execute` a `public` en cada
`create function`. Si la función no es para la app, hay que sacárselo a mano:
`revoke execute on function x() from public, anon, authenticated`. Ya pasó una vez con
`limpiar_rondas_viejas()`, que borraba rondas y cualquiera con la clave pública podía llamarla.

**Y el mock tiene que mentir igual que el servidor.** `pruebas/mock-supabase.js` imita
`esquema.sql`: si cambiás una función allá, cambiala acá, o `nube-test` va a estar probando un
servidor que no existe. Lo que `anon` no puede llamar tampoco vive en `FN` del mock — va en el
panel `/__test`.

**Una posición vieja no es tu posición.** `POS` vence a los 30 segundos (`gpsVivo()`), y todo lo
que dependa del GPS pregunta por esa función, nunca por `POS` a secas. Antes, cuando el GPS
fallaba, `POS` se quedaba con la última lectura y la app seguía diciendo "GPS ±4 m" midiendo
contra una coordenada congelada. **Dar una distancia falsa con cara de real es lo peor que puede
hacer esta app.**

**Sin ubicación no se sale a jugar, pero la tarjeta nunca se bloquea.** `empezarRonda()` exige
`gpsVivo()`; `empezarRonda(true)` es la puerta explícita para anotar sin distancias. Está abajo y
en secundario a propósito. La tarjeta es el documento de la vuelta: si a alguien se le apaga el
GPS en el hoyo 12 de un torneo, no puede quedarse sin dónde anotar.

**El socio no anota en el green: anota en el tee siguiente, antes de salir**, para no frenar la
cancha. Eso le da a `panelCierre` un presupuesto de veinte segundos, una mano y un guante, y de ahí
salen sus tres reglas: **entra entero sin scrollear** (medido en `cierre-test`, de 360×640 para
arriba), el botón de guardar va pegado abajo (`.guardar`, `position:sticky`) y **el nav se esconde**
porque son 67px y seis blancos para salirse sin querer. Si agregás algo a esa pantalla, corré
`cierre-test` y fijate qué sacás a cambio.

**El green en regulación no se pregunta: se calcula.** `girDe(h)` = `(golpes − putts) ≤ (par − 2)`.
Antes era un botón que decía "No" sin que nadie lo tocara, indistinguible de un No de verdad. Sin
putts devuelve `null` y no se guarda nada: la app no inventa.

**Guardar después de cada cambio.** Una vuelta dura cuatro horas y Android recarga la pestaña
si el teléfono se bloquea. `guardarTodo()` corre en cada `render()`. Si el `setItem` falla —sin
espacio, modo incógnito— la app avisa **una sola vez** (`SIN_LUGAR`): antes se lo tragaba en
silencio y la vuelta entera se perdía sin que nadie se enterara.

**La copia de seguridad no se lleva `trisquelia_dispositivo`.** Ese identificador es quién es
ESTE teléfono adentro de una ronda compartida, y `absorber()` lo usa para no pisar lo propio. Si
dos teléfonos tuvieran el mismo, los dos se declararían dueños de la misma tarjeta. Si agregás
una clave nueva a `localStorage`, decidí a conciencia si va en `COPIA_CLAVES` o no.

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
node pruebas/nube-test.js              # dos teléfonos a la vez         (38 ✓)
node pruebas/exportar-test.js          # sacar los datos del teléfono   (11 ✓)
node pruebas/copia-test.js             # copia de seguridad             (26 ✓)
node pruebas/ubicacion-test.js         # el portón del GPS              (23 ✓)
node pruebas/cierre-test.js            # cerrar el hoyo                 (43 ✓)
```

El esquema del servidor se prueba aparte, contra un Postgres de verdad — no
alcanza con el mock, porque los permisos y la migración sólo existen en
Postgres:

```bash
createdb t && psql -d t -c 'create role anon' -c 'create role authenticated'
psql -d t -f esquema.sql
psql -d t -f esquema.sql                    # otra vez: tiene que ser idempotente
psql -d t -f pruebas/esquema-test.sql       # borrado, identidad, permisos (61 ✓)
```

`bugs.js` es el más barato y el que más encuentra: renderiza cada pantalla en una matriz de
estados (tres salidas × ronda vacía/jugando/terminada, cada solapa, el panel de cierre hoyo por
hoyo, el modo club con las cuatro personas, los siete pasos del alta) y busca `null`, `NaN`,
`undefined`, `Infinity` y `[object Object]` en el texto visible. **Corrélo después de cualquier
cambio.** Tiene que dar cero hallazgos.

Entre las ocho suites son **209 comprobaciones**, más las **61** del esquema: 270 en total. Si
alguna se pone en rojo después de un cambio tuyo, es un bug tuyo: estaban todas en verde el
31/8/2026.

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
3. Cuentas de verdad: padrón real y verificación por DNI. Con la llave por teléfono ya nadie
   puede anotar en la tarjeta de otro ni suplantarlo, pero cualquiera con el código sigue
   pudiendo **sumarse** a la ronda con el nombre que quiera. Para un torneo oficial hace falta
   que el que entra sea un socio verificado.
4. El panel de la comisión, funcionando contra el servidor.
5. Rating y slope oficiales de las tres salidas (depende de la federación).

**Personas:** Mauro Domina (admin), Félix Córdoba (pro y oficial de reglas; salidas y
resultados), Chelo Caballero (avisos, cancha, padrón, cuotas), Daniel Rodríguez (torneos).
