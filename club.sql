-- ============================================================
--  TRISQUELIA · EL CLUB LE HABLA A LOS SOCIOS
-- ============================================================
--  Se pega DESPUÉS de `esquema.sql`, en el mismo SQL Editor.
--  Usa `recortar()`, que vive allá.
--
--  QUÉ RESUELVE
--  Dos preguntas que un socio se hace todos los sábados:
--  "¿está abierta la cancha?" y "¿hay algo que avisar?".
--
--  Hasta ahora las dos vivían en el teléfono de cada uno. El estado
--  de la cancha lo guardaba cada aparato por su cuenta, así que un
--  sábado de lluvia cada socio veía una respuesta distinta y ninguna
--  era la del club. Y los avisos directamente no existían: el botón
--  mostraba un cartelito y no mandaba nada a ningún lado.
--
--  LA DECISIÓN DE FONDO: EL SERVIDOR NO LE CREE A UN NOMBRE
--  En la app, la puerta del panel la abre comparar el nombre que la
--  persona escribió contra una lista escrita en el código. Eso
--  alcanza para que no se le abra a cualquiera que baja la app, pero
--  no puede sostener una escritura: cualquiera escribe un nombre.
--  Acá cada acceso tiene una **llave** propia —el mismo invento que
--  protege la tarjeta de cada jugador en `esquema.sql`— y sin ella no
--  se publica nada.
--
--  Y LA LLAVE ES DEL PUESTO, NO DE LA PERSONA
--  Ésta es la idea de Mauro y mejora el diseño original. La comisión
--  cambia: Félix no va a ser el profesional para siempre. Si la llave
--  fuera de Félix, el día que deje el puesto habría que rehacer todo.
--  Entonces la fila es el PUESTO —"Profesional de la cancha"— y a él
--  están atados la llave y los permisos. `persona` es sólo quién lo
--  ocupa hoy, y se cambia con un renglón: `comision_persona()`.
--
--  Pero el aviso se firma con la PERSONA, no con el puesto. En un club
--  donde todos se conocen, "lo dijo Chelo" pesa más que "lo dijo la
--  Comisión Directiva". Si el puesto está vacante, ahí sí firma el
--  puesto. Eso es todo lo que hace la línea de `coalesce` que aparece
--  en `cancha_poner` y en `aviso_poner`.
--
--  Y DE PASO, EL CÓDIGO PÚBLICO QUEDA SIN NOMBRES REALES
--  El repositorio es público. Hasta ahora los cuatro nombres de la
--  comisión vivían en `index.html` porque la app los necesitaba para
--  decidir quién entraba. Con la llave ya no los necesita: los nombres
--  viven sólo acá, en la base, que es privada.
--
--  Y LOS PERMISOS LOS DICE EL SERVIDOR
--  La app tiene su tabla de roles para dibujar nombres y descripciones,
--  pero **quién puede qué lo decide `roles_srv()`, acá abajo**. Si la
--  lista viviera en los dos lados, algún día dejarían de coincidir y
--  el que manda sería el equivocado. `comision_entrar()` le devuelve
--  al teléfono la lista de permisos ya resuelta, y la app la usa.
--
--  CÓMO SE REPARTEN LAS LLAVES
--  `comision_alta()` se corre a mano desde el SQL Editor y devuelve la
--  llave UNA vez. Esa cadena se le pasa a la persona que ocupa el
--  puesto y la pega una sola vez en su panel. Es el mismo trato que el
--  código de la ronda: se dicta entre personas que se conocen. Cuando
--  alguien deja el puesto, lo prolijo es rotar: `comision_baja()` del
--  puesto y `comision_alta()` de nuevo, que da una llave nueva.
-- ============================================================

-- ---------- los dos roles de la Data API ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anonymous') then
    create role anonymous nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- ============================================================
--  LAS TABLAS
-- ============================================================

-- ---------- quién tiene acceso al panel ----------
--  Una fila por PUESTO, no por persona. La llave es la clave primaria
--  a propósito: es lo único que se presenta, y así no hay forma de
--  pedir una fila sin tenerla.
create table if not exists comision (
  llave       text primary key,
  club        text not null,
  puesto      text not null default 'Sin puesto',   -- lo durable
  persona     text,                                 -- quién lo ocupa hoy
  rol         text not null,                        -- ver roles_srv()
  creada      timestamptz not null default now(),
  visto       timestamptz,
  borrado_en  timestamptz                           -- borrado lógico
);

-- ---------- el estado de la cancha ----------
--  Una sola fila por club: es un estado, no un historial. Quién lo
--  cambió y cuándo quedan registrados, porque un socio que ve "cerrada"
--  un sábado a la mañana tiene derecho a saber quién lo dijo.
create table if not exists cancha (
  club        text primary key,
  abierta     boolean not null default true,
  nota        text,
  por         text,
  desde       timestamptz,
  actualizado timestamptz not null default now()
);

-- ---------- los avisos ----------
--  `socios` separa lo interno de lo público: la cuota y el padrón no
--  los ve cualquiera que abra el link, los resultados sí.
create table if not exists avisos (
  id          bigserial primary key,
  club        text not null,
  ic          text,
  titulo      text not null,
  detalle     text,
  socios      boolean not null default false,
  por         text,
  creado      timestamptz not null default now(),
  vence       timestamptz,                          -- null = hasta que lo bajen
  borrado_en  timestamptz,
  actualizado timestamptz not null default now()    -- para "qué cambió desde X"
);

-- ---------- la migración ----------
--  Una base que ya tenía la versión anterior guardaba el nombre de la
--  PERSONA en una columna `nombre`. Acá se renombra, se agrega el
--  puesto, y las llaves que ya se repartieron siguen valiendo: no hay
--  que volver a darlas de alta ni avisarle a nadie.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'comision' and column_name = 'nombre')
     and not exists (select 1 from information_schema.columns
              where table_name = 'comision' and column_name = 'persona') then
    alter table comision rename column nombre to persona;
  end if;
end $$;

alter table comision add column if not exists persona    text;
alter table comision add column if not exists puesto     text not null default 'Sin puesto';
alter table comision alter column persona drop not null;
alter table avisos   add column if not exists actualizado timestamptz not null default now();

--  Puestos por omisión, deducidos del rol, para que una base que viene
--  de la versión anterior quede usable sin tocar nada. Son nombres de
--  club genéricos, no de Trisquelia: se renombran con `comision_puesto()`.
update comision set puesto = case rol
    when 'admin'   then 'Administración'
    when 'salidas' then 'Profesional de la cancha'
    when 'avisos'  then 'Comisión Directiva'
    when 'torneos' then 'Subcomisión de Torneos'
    else 'Sin puesto' end
 where puesto = 'Sin puesto' or puesto is null;

-- ---------- los índices ----------
create index if not exists avisos_por_club on avisos (club, actualizado);
create index if not exists comision_viva   on comision (club) where borrado_en is null;
--  Un puesto, una llave viva. Si se rota, la vieja queda con fecha de
--  baja y deja de contar para este índice.
create unique index if not exists comision_un_puesto
  on comision (club, puesto) where borrado_en is null;

-- ============================================================
--  QUIÉN PUEDE QUÉ · la única lista que manda
-- ============================================================
--  Espejo de `ROLES` en `index.html`, pero **ésta es la que decide**.
--  La app la usa para dibujar los nombres lindos de cada permiso; para
--  dejar pasar o no, manda ésta. Si agregás un rol, va acá primero.
--
--  OJO, UN HUECO CONOCIDO: el permiso `result` ("publicar resultados")
--  está en la lista pero todavía no lo mira ninguna función. Hoy sólo
--  `avisos`, `cancha` y los que use el resto del panel hacen algo. Está
--  a propósito: los resultados son parte del torneo y eso no se
--  construyó. El día que se haga, `aviso_poner` va a necesitar saber si
--  el aviso es un resultado para pedir `result` en vez de `avisos` —
--  mientras tanto, el profesional de la cancha NO publica avisos, y eso
--  es lo correcto, no un olvido. Lo comprueba `clubtest`.
create or replace function roles_srv() returns jsonb
language sql immutable as $$
  select '{
    "admin":   ["salidas","result","torneos","avisos","cancha","padron","cuotas","admin"],
    "salidas": ["salidas","result"],
    "avisos":  ["avisos","cancha","padron","cuotas"],
    "torneos": ["torneos"],
    "todo":    ["salidas","result","torneos","avisos","cancha","padron","cuotas"],
    "sin":     []
  }'::jsonb
$$;
revoke execute on function roles_srv() from public, anonymous, authenticated;

-- ---------- con qué se firma ----------
--  El nombre de pila de quien ocupa el puesto. Si está vacante, el
--  puesto. Nunca nada vacío: un aviso sin firma no sirve.
create or replace function firma_de(p_persona text, p_puesto text) returns text
language sql immutable as $$
  select coalesce(nullif(split_part(coalesce(p_persona,''),' ',1),''), p_puesto)
$$;
revoke execute on function firma_de(text,text) from public, anonymous, authenticated;

-- ---------- la puerta ----------
--  Devuelve la fila si la llave vale Y el puesto tiene ese permiso.
--  Null en cualquier otro caso: llave inventada, puesto dado de baja,
--  o rol que no incluye lo que se quiere hacer. Una sola función para
--  que no haya dos criterios distintos dando vueltas.
create or replace function comision_quien(p_llave text, p_permiso text)
returns comision
language plpgsql security definer set search_path = public as $$
declare v comision%rowtype;
begin
  select * into v from comision
   where llave = p_llave and borrado_en is null and length(coalesce(p_llave,'')) >= 32;
  if v.llave is null then return null; end if;
  if not (roles_srv() -> v.rol ? p_permiso) then return null; end if;
  return v;
end $$;
revoke execute on function comision_quien(text,text) from public, anonymous, authenticated;

-- ============================================================
--  LO QUE LLAMA EL TELÉFONO
-- ============================================================

-- ---------- entrar al panel ----------
--  El teléfono pega su llave una vez y guarda lo que vuelve. No
--  devuelve la llave (ya la tiene) ni nada de los otros puestos.
create or replace function comision_entrar(p_llave text)
returns json
language plpgsql security definer set search_path = public as $$
declare v comision%rowtype;
begin
  select * into v from comision
   where llave = p_llave and borrado_en is null and length(coalesce(p_llave,'')) >= 32;
  if v.llave is null then
    return json_build_object('error', 'esa llave no sirve');
  end if;
  update comision set visto = now() where llave = p_llave;
  return json_build_object('ok', true, 'puesto', v.puesto, 'persona', v.persona,
    'club', v.club, 'rol', v.rol, 'permisos', roles_srv() -> v.rol);
end $$;

-- ---------- lo que ve un socio ----------
--  Sin llave: lo llama cualquiera, es lo que el club le dice al mundo.
--  `p_desde` deja pedir sólo lo que cambió, igual que `ronda_estado`.
--  `p_socio` lo manda la app: en false no salen los avisos internos.
--
--  Los avisos borrados VIAJAN, con su `borrado_en`, para que el
--  teléfono los pueda sacar. Si simplemente dejaran de mandarse, un
--  aviso dado de baja quedaría en pantalla para siempre — es la misma
--  lección que está escrita en `esquema.sql`.
create or replace function club_estado(p_club text, p_desde timestamptz, p_socio boolean)
returns json
language plpgsql security definer set search_path = public as $$
declare v_c cancha%rowtype; v_a json;
begin
  select * into v_c from cancha where club = p_club;

  select coalesce(json_agg(json_build_object(
           'id', a.id, 'ic', a.ic, 'titulo', a.titulo, 'detalle', a.detalle,
           'socios', a.socios, 'por', a.por, 'creado', a.creado,
           'borrado_en', a.borrado_en) order by a.creado desc), '[]'::json)
    into v_a
    from avisos a
   where a.club = p_club
     and (p_desde is null or a.actualizado > p_desde)
     and (p_desde is not null or a.borrado_en is null)   -- la primera carga va limpia
     and (a.vence is null or a.vence > now() or a.borrado_en is not null)
     and (coalesce(p_socio,false) or not a.socios);

  return json_build_object(
    'cancha', case when v_c.club is null then null else json_build_object(
        'abierta', v_c.abierta, 'nota', v_c.nota,
        'por', v_c.por, 'desde', v_c.desde) end,
    'avisos', v_a,
    'ahora', now());
end $$;

-- ---------- publicar el estado de la cancha ----------
create or replace function cancha_poner(p_llave text, p_abierta boolean, p_nota text)
returns json
language plpgsql security definer set search_path = public as $$
declare v comision%rowtype;
begin
  v := comision_quien(p_llave, 'cancha');
  if v.llave is null then return json_build_object('error','no tenés permiso para esto'); end if;

  insert into cancha (club, abierta, nota, por, desde, actualizado)
  values (v.club, coalesce(p_abierta,true), recortar(p_nota,280),
          firma_de(v.persona, v.puesto), now(), now())
  on conflict (club) do update
    set abierta = excluded.abierta, nota = excluded.nota,
        por = excluded.por, desde = excluded.desde, actualizado = now();

  update comision set visto = now() where llave = p_llave;
  return json_build_object('ok', true);
end $$;

-- ---------- poner un aviso ----------
create or replace function aviso_poner(p_llave text, p_ic text, p_titulo text,
                                       p_detalle text, p_socios boolean, p_dias int)
returns json
language plpgsql security definer set search_path = public as $$
declare v comision%rowtype; v_id bigint; v_t text;
begin
  v := comision_quien(p_llave, 'avisos');
  if v.llave is null then return json_build_object('error','no tenés permiso para esto'); end if;

  v_t := recortar(p_titulo, 90);
  if v_t is null then return json_build_object('error','el aviso necesita un título'); end if;

  --  Un club chico no manda veinte avisos por día. Si aparecen, algo
  --  anda mal: un botón que se toca solo, o alguien probando.
  if (select count(*) from avisos
       where club = v.club and creado > now() - interval '1 hour') >= 20 then
    return json_build_object('error','demasiados avisos en una hora');
  end if;

  insert into avisos (club, ic, titulo, detalle, socios, por, vence)
  values (v.club, recortar(p_ic,8), v_t, recortar(p_detalle,400),
          coalesce(p_socios,false), firma_de(v.persona, v.puesto),
          case when coalesce(p_dias,0) > 0 then now() + (p_dias || ' days')::interval end)
  returning id into v_id;

  update comision set visto = now() where llave = p_llave;
  return json_build_object('ok', true, 'id', v_id);
end $$;

-- ---------- bajar un aviso ----------
--  Borrado lógico, como todo acá: una cosa que el club dijo y después
--  se arrepintió sigue siendo algo que el club dijo.
create or replace function aviso_bajar(p_llave text, p_id bigint)
returns json
language plpgsql security definer set search_path = public as $$
declare v comision%rowtype;
begin
  v := comision_quien(p_llave, 'avisos');
  if v.llave is null then return json_build_object('error','no tenés permiso para esto'); end if;

  update avisos set borrado_en = now(), actualizado = now()
   where id = p_id and club = v.club and borrado_en is null;
  if not found then return json_build_object('error','ese aviso no está'); end if;
  return json_build_object('ok', true);
end $$;

-- ============================================================
--  LO QUE CORRE EL CLUB A MANO · nadie de afuera
-- ============================================================

--  La versión anterior daba de alta personas y recibía tres argumentos.
--  Se saca para que no queden dos funciones con el mismo nombre.
drop function if exists comision_alta(text,text,text);

-- ---------- crear un puesto ----------
--  Devuelve la llave UNA vez. Anotala antes de cerrar la ventana:
--  después sólo se puede leer de la tabla, desde el SQL Editor.
create or replace function comision_alta(p_club text, p_puesto text, p_rol text,
                                         p_persona text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare v_ll text; v_p text := recortar(p_puesto,60);
begin
  if not (roles_srv() ? p_rol) then
    return json_build_object('error','ese rol no existe');
  end if;
  if v_p is null then
    return json_build_object('error','el puesto necesita un nombre');
  end if;
  if exists (select 1 from comision
              where club = p_club and puesto = v_p and borrado_en is null) then
    return json_build_object('error','ese puesto ya tiene una llave viva: dalo de baja primero');
  end if;
  v_ll := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into comision (llave, club, puesto, persona, rol)
  values (v_ll, p_club, v_p, recortar(p_persona,60), p_rol);
  return json_build_object('ok', true, 'llave', v_ll,
    'puesto', v_p, 'persona', p_persona, 'rol', p_rol);
end $$;
revoke execute on function comision_alta(text,text,text,text)
  from public, anonymous, authenticated;

-- ---------- cambiar quién ocupa un puesto ----------
--  El renglón que hace que todo esto valga la pena. Félix deja de ser
--  el profesional y entra otro: se corre esto y listo. La llave, los
--  permisos y los avisos que ya publicó no se tocan. Si además querés
--  que la llave cambie —lo prolijo cuando alguien se va del club—
--  usá `comision_baja()` y `comision_alta()`.
create or replace function comision_persona(p_club text, p_puesto text, p_persona text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  update comision set persona = recortar(p_persona,60)
   where club = p_club and puesto = p_puesto and borrado_en is null;
  if not found then return json_build_object('error','no hay un puesto así'); end if;
  return json_build_object('ok', true, 'puesto', p_puesto, 'persona', p_persona);
end $$;
revoke execute on function comision_persona(text,text,text)
  from public, anonymous, authenticated;

-- ---------- renombrar un puesto ----------
create or replace function comision_puesto(p_club text, p_viejo text, p_nuevo text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  update comision set puesto = recortar(p_nuevo,60)
   where club = p_club and puesto = p_viejo and borrado_en is null;
  if not found then return json_build_object('error','no hay un puesto así'); end if;
  return json_build_object('ok', true);
end $$;
revoke execute on function comision_puesto(text,text,text)
  from public, anonymous, authenticated;

-- ---------- anular la llave de un puesto ----------
--  Antes el segundo argumento se llamaba `p_nombre` y era el de la
--  persona. Postgres no deja renombrar un parámetro con `create or
--  replace`, así que hay que sacarla primero: sin esto, el archivo
--  corta acá al correrse sobre una base de la versión anterior y los
--  permisos del final NO se aplican. Pasó, y por eso está escrito.
drop function if exists comision_baja(text,text);

create or replace function comision_baja(p_club text, p_puesto text) returns json
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update comision set borrado_en = now()
   where club = p_club and puesto = p_puesto and borrado_en is null;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'dados_de_baja', n);
end $$;
revoke execute on function comision_baja(text,text) from public, anonymous, authenticated;

-- ---------- ver quién tiene acceso ----------
--  Sin las llaves. Para mirar desde el SQL Editor y nada más.
create or replace function comision_lista(p_club text) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'puesto', puesto, 'persona', persona, 'rol', rol, 'creada', creada, 'visto', visto)
    order by creada), '[]'::json)
  from comision where club = p_club and borrado_en is null
$$;
revoke execute on function comision_lista(text) from public, anonymous, authenticated;

-- ============================================================
--  QUIÉN PUEDE TOCAR QUÉ
-- ============================================================
--  Mismo criterio que `esquema.sql` y `padron.sql`: RLS prendida, sin
--  políticas, `revoke all`, y se entra sólo por funciones.
--
--  Ojo con `comision`: ahí viven las llaves. Si esa tabla se pudiera
--  leer, cualquiera sería administrador del club.

alter table comision enable row level security;
alter table cancha   enable row level security;
alter table avisos   enable row level security;

revoke all on comision, cancha, avisos from anonymous, authenticated;
revoke all on sequence avisos_id_seq from anonymous, authenticated;

revoke execute on function comision_entrar(text)                     from public, anonymous, authenticated;
revoke execute on function club_estado(text,timestamptz,boolean)     from public, anonymous, authenticated;
revoke execute on function cancha_poner(text,boolean,text)           from public, anonymous, authenticated;
revoke execute on function aviso_poner(text,text,text,text,boolean,int) from public, anonymous, authenticated;
revoke execute on function aviso_bajar(text,bigint)                  from public, anonymous, authenticated;

grant execute on function comision_entrar(text)                      to anonymous;
grant execute on function club_estado(text,timestamptz,boolean)      to anonymous;
grant execute on function cancha_poner(text,boolean,text)            to anonymous;
grant execute on function aviso_poner(text,text,text,text,boolean,int) to anonymous;
grant execute on function aviso_bajar(text,bigint)                   to anonymous;
