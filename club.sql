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
--  no puede sostener una escritura: cualquiera escribe "Chelo
--  Caballero". Acá cada miembro de la comisión tiene una **llave**
--  propia —el mismo invento que protege la tarjeta de cada jugador
--  en `esquema.sql`— y sin ella no se publica nada.
--
--  Y LOS PERMISOS LOS DICE EL SERVIDOR
--  La app tiene su tabla de roles para dibujar nombres y descripciones,
--  pero **quién puede qué lo decide `ROLES_SRV`, acá abajo**. Si la
--  lista viviera en los dos lados, algún día dejarían de coincidir y
--  el que manda sería el equivocado. `comision_entrar()` le devuelve
--  al teléfono la lista de permisos ya resuelta, y la app la usa.
--
--  CÓMO SE REPARTEN LAS LLAVES
--  `comision_alta()` se corre a mano desde el SQL Editor y devuelve la
--  llave UNA vez. Esa cadena se le pasa a la persona por donde sea
--  (en mano, por WhatsApp) y la pega una sola vez en su panel. Es el
--  mismo trato que el código de la ronda: se dicta entre personas que
--  se conocen. Si alguna vez hay cuentas de verdad —`padron.sql`— la
--  llave va a salir de entrar con DNI y clave en vez de repartirse, y
--  esta tabla gana una columna `dni`. El resto no cambia.
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

-- ---------- quién es de la comisión ----------
--  La llave es la clave primaria a propósito: es lo único que la
--  persona presenta, y así no hay forma de pedir una fila sin tenerla.
create table if not exists comision (
  llave       text primary key,
  club        text not null,
  nombre      text not null,
  rol         text not null,                      -- ver ROLES_SRV, más abajo
  creada      timestamptz not null default now(),
  visto       timestamptz,
  borrado_en  timestamptz                         -- borrado lógico: null = vigente
);

-- ---------- el estado de la cancha ----------
--  Una sola fila por club: es un estado, no un historial. Quién lo
--  cambió y cuándo quedan registrados, porque un socio que ve "cerrada"
--  un sábado a la mañana tiene derecho a saber quién lo dijo.
create table if not exists cancha (
  club        text primary key,
  abierta     boolean not null default true,
  nota        text,
  por         text,                               -- nombre de pila de quien publicó
  desde       timestamptz,
  actualizado timestamptz not null default now()
);

-- ---------- los avisos ----------
--  `socios` separa lo interno de lo público: la cuota y el padrón no
--  los ve cualquiera que abra el link, los resultados sí.
create table if not exists avisos (
  id          bigserial primary key,
  club        text not null,
  ic          text,                               -- el emoji que la app convierte en dibujo
  titulo      text not null,
  detalle     text,
  socios      boolean not null default false,
  por         text,
  creado      timestamptz not null default now(),
  vence       timestamptz,                        -- null = hasta que lo bajen
  borrado_en  timestamptz,
  actualizado timestamptz not null default now()  -- para "qué cambió desde X"
);

-- ---------- la migración ----------
alter table comision add column if not exists borrado_en  timestamptz;
alter table avisos   add column if not exists actualizado timestamptz not null default now();

-- ---------- los índices ----------
create index if not exists avisos_por_club on avisos (club, actualizado);
create index if not exists comision_viva   on comision (club) where borrado_en is null;

-- ============================================================
--  QUIÉN PUEDE QUÉ · la única lista que manda
-- ============================================================
--  Espejo de `ROLES` en `index.html`, pero **ésta es la que decide**.
--  La app la usa para dibujar los nombres lindos de cada permiso; para
--  dejar pasar o no, manda ésta. Si agregás un rol, va acá primero.
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

-- ---------- la puerta ----------
--  Devuelve la fila de la persona si la llave vale Y tiene ese permiso.
--  Null en cualquier otro caso: llave inventada, persona dada de baja,
--  o rol que no incluye lo que quiere hacer. Una sola función para que
--  no haya dos criterios distintos dando vueltas.
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
--  devuelve la llave (ya la tiene) ni nada de las otras personas.
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
  return json_build_object('ok', true, 'nombre', v.nombre, 'club', v.club,
    'rol', v.rol, 'permisos', roles_srv() -> v.rol);
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
          split_part(v.nombre,' ',1), now(), now())
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
          coalesce(p_socios,false), split_part(v.nombre,' ',1),
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

-- ---------- dar de alta a alguien de la comisión ----------
--  Se corre desde el SQL Editor y devuelve la llave UNA vez. Anotala
--  antes de cerrar la ventana: después no se puede volver a leer de
--  ningún lado que no sea la tabla.
create or replace function comision_alta(p_club text, p_nombre text, p_rol text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_ll text;
begin
  if not (roles_srv() ? p_rol) then
    return json_build_object('error','ese rol no existe');
  end if;
  v_ll := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into comision (llave, club, nombre, rol)
  values (v_ll, p_club, recortar(p_nombre,60), p_rol);
  return json_build_object('ok', true, 'llave', v_ll, 'nombre', p_nombre, 'rol', p_rol);
end $$;
revoke execute on function comision_alta(text,text,text) from public, anonymous, authenticated;

-- ---------- sacarle el acceso a alguien ----------
create or replace function comision_baja(p_club text, p_nombre text) returns json
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update comision set borrado_en = now()
   where club = p_club and nombre = p_nombre and borrado_en is null;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'dados_de_baja', n);
end $$;
revoke execute on function comision_baja(text,text) from public, anonymous, authenticated;

-- ---------- ver quién tiene acceso ----------
--  Sin las llaves. Para mirar desde el SQL Editor y nada más.
create or replace function comision_lista(p_club text) returns json
language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'nombre', nombre, 'rol', rol, 'creada', creada, 'visto', visto)
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
