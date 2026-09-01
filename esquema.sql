-- ============================================================
--  TRISQUELIA · LA RONDA COMPARTIDA
-- ============================================================
--  Esto es lo que hace que la tarjeta se vea entre dos teléfonos.
--
--  LA IDEA, QUE ES LA DEL PAPEL
--  En un torneo cada jugador lleva la tarjeta de OTRO. Entonces por
--  cada jugador y cada hoyo puede haber DOS anotaciones: la que hizo
--  él y la que hizo su marcador. La app las compara en el hoyo y avisa
--  al momento, en vez de descubrirlo en la mesa dos horas después.
--
--  Y trae un regalo: como cada anotación tiene un dueño distinto
--  (`por`), dos teléfonos nunca escriben la misma fila. No hay
--  conflictos que resolver. La regla de papel resuelve sola el
--  problema más feo de sincronizar.
--
--  QUÉ NO VIVE ACÁ
--  Ningún DNI, ningún mail, ningún teléfono. Sólo nombre de pila,
--  handicap y golpes. El padrón del club es otra cosa y viene después,
--  con cuentas de verdad.
--
--  CÓMO SE INSTALA
--  Supabase → tu proyecto → SQL Editor → pegar todo esto → Run.
-- ============================================================

-- ---------- las tablas ----------

create table if not exists rondas (
  codigo      text primary key,                    -- 6 letras, lo que se dice en voz alta
  club        text not null,
  cancha      text,
  vuelta      int  not null default 18,
  torneo      boolean not null default false,
  fecha       date not null default current_date,
  creada      timestamptz not null default now(),
  cerrada     boolean not null default false,
  borrado_en  timestamptz                        -- borrado lógico: null = viva
);

create table if not exists jugadores (
  id          text primary key,                    -- lo arma el teléfono, no se repite
  ronda       text not null references rondas(codigo) on delete cascade,
  nombre      text not null,
  iniciales   text,
  index_hcp   numeric,
  hcp_cancha  int,
  salida      text,
  marca_a     text,                                -- a quién le anota este jugador
  visto       timestamptz not null default now(),
  borrado_en  timestamptz,
  llave       text                               -- el secreto de ESE teléfono
);

create table if not exists anotaciones (
  ronda       text not null references rondas(codigo) on delete cascade,
  de          text not null,                       -- de quién es el score
  por         text not null,                       -- quién lo anotó
  hoyo        int  not null check (hoyo between 1 and 18),
  golpes      int  check (golpes between 1 and 20),
  putts       int  check (putts between 0 and 15),
  bunker      int  check (bunker between 0 and 9),
  penal       int  check (penal between 0 and 9),
  salida_fw   text,                                -- dónde quedó el drive
  actualizado timestamptz not null default now(),
  borrado_en  timestamptz,
  primary key (ronda, de, por, hoyo)
);

-- ---------- borrado lógico ----------
--  Nada se borra de verdad cuando lo pide la app. Se le pone fecha en
--  `borrado_en` y deja de existir para todo el mundo, pero la fila sigue
--  ahí y se puede volver atrás. Una tarjeta de golf es la prueba de una
--  vuelta: si alguien toca el botón equivocado en el hoyo 14, se
--  restaura; con un `delete` no hay a dónde volver.
--
--  El `delete` de verdad existe igual, en `purgar_borradas()`, y hay que
--  correrlo a mano: es la única forma de que la base no crezca para
--  siempre. Entre una cosa y la otra hay meses de gracia.
--
--  Estas tres líneas son la migración: en una base que ya existe agregan
--  la columna sin tocar los datos. En una base nueva no hacen nada,
--  porque las columnas ya están arriba.
alter table rondas      add column if not exists borrado_en timestamptz;
alter table jugadores   add column if not exists borrado_en timestamptz;
alter table anotaciones add column if not exists borrado_en timestamptz;
alter table jugadores   add column if not exists llave      text;

-- ---------- la llave: quién es cada teléfono ----------
--  El código de la ronda son seis letras que se dictan en voz alta y se
--  mandan por WhatsApp. NO es un secreto: es una dirección. Alcanza para
--  entrar a la ronda y nada más.
--
--  Al entrar, cada teléfono recibe una llave propia que sólo él conoce, y
--  que tiene que presentar para escribir. Sin esto, cualquiera que
--  escuchara el código podía anotar en la tarjeta de otro, pisarle el
--  handicap o cerrarle la ronda: el `id` del jugador venía en
--  `ronda_estado`, así que hacerse pasar por él era copiar y pegar.
--
--  La llave NUNCA sale en `ronda_estado`: se devuelve una sola vez, al que
--  entra, y por eso esa función arma el JSON campo por campo en vez de
--  usar `row_to_json`, que la mandaría a todos los teléfonos del grupo.
create or replace function llave_nueva() returns text
language sql as $$
  select replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')
$$;
revoke execute on function llave_nueva() from public, anon, authenticated;

--  Tijeras para el texto que llega de afuera. Nada de esto necesita ser
--  largo, y sin tope alguien mete megabytes en un nombre.
create or replace function recortar(t text, n int) returns text
language sql immutable as $$ select nullif(left(btrim(coalesce(t,'')), n), '') $$;
revoke execute on function recortar(text,int) from public, anon, authenticated;

--  Los índices van DESPUÉS de la migración y no antes: el de jugadores es
--  parcial (`where borrado_en is null`) y en una base que ya existe la
--  columna todavía no estaba cuando se creaba el índice. Se rompía sólo al
--  actualizar una base con datos, nunca en una instalación limpia — la peor
--  clase de bug.
create index if not exists jugadores_por_ronda   on jugadores (ronda) where borrado_en is null;
create index if not exists anotaciones_por_ronda on anotaciones (ronda, actualizado);

-- ---------- quién puede tocar qué ----------
--  Las tablas quedan cerradas con llave. Nadie las lee ni las escribe
--  directamente: se entra sólo por las funciones de abajo, y todas
--  piden el código de la ronda. Así el código ES la llave, y nadie
--  puede listar las rondas de los demás.

alter table rondas      enable row level security;
alter table jugadores   enable row level security;
alter table anotaciones enable row level security;
-- sin políticas: con la llave pública no se llega a las tablas

revoke all on rondas, jugadores, anotaciones from anon, authenticated;

-- ---------- abrir una ronda ----------

create or replace function ronda_abrir(
  p_codigo text, p_club text, p_cancha text, p_vuelta int, p_torneo boolean,
  p_jugador text, p_nombre text, p_iniciales text,
  p_index numeric, p_hcp int, p_salida text, p_llave text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_llave text;
begin
  -- Si el código pertenece a una ronda borrada, no se resucita ni se pisa:
  -- el teléfono saca otro. Resucitarla sería una puerta para recuperar datos
  -- borrados adivinando seis letras.
  if exists (select 1 from rondas
              where codigo = upper(p_codigo) and borrado_en is not null) then
    return json_build_object('error', 'ese código está ocupado');
  end if;

  insert into rondas (codigo, club, cancha, vuelta, torneo)
  values (upper(p_codigo), recortar(p_club,40), recortar(p_cancha,60),
          coalesce(p_vuelta,18), coalesce(p_torneo,false))
  on conflict (codigo) do nothing;

  v_llave := entrar_jugador(upper(p_codigo), p_jugador, p_nombre, p_iniciales,
                            p_index, p_hcp, p_salida, p_llave);
  if v_llave is null then
    return json_build_object('error', 'ese jugador ya está en la ronda desde otro teléfono');
  end if;

  return (ronda_estado(upper(p_codigo), null)::jsonb
          || jsonb_build_object('llave', v_llave))::json;
end $$;

-- ---------- sumarse a una que ya existe ----------

create or replace function ronda_unirse(
  p_codigo text, p_jugador text, p_nombre text, p_iniciales text,
  p_index numeric, p_hcp int, p_salida text, p_llave text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_existe boolean; v_llave text;
begin
  select true into v_existe from rondas
   where codigo = upper(p_codigo) and not cerrada and borrado_en is null;
  if v_existe is not true then
    return json_build_object('error', 'no existe esa ronda');
  end if;

  v_llave := entrar_jugador(upper(p_codigo), p_jugador, p_nombre, p_iniciales,
                            p_index, p_hcp, p_salida, p_llave);
  if v_llave is null then
    return json_build_object('error', 'ese jugador ya está en la ronda desde otro teléfono');
  end if;

  return (ronda_estado(upper(p_codigo), null)::jsonb
          || jsonb_build_object('llave', v_llave))::json;
end $$;

-- ---------- alta o reingreso de un jugador ----------
--  Devuelve la llave del jugador, o null si el puesto ya es de otro teléfono.
--  `on conflict (id) do update` sin verificar nada era el agujero: el `id` de
--  cada jugador viaja en `ronda_estado`, así que cualquiera con el código
--  podía reescribirle el nombre, el handicap y la salida a otro. Ahora, si el
--  jugador ya tiene llave, hay que presentarla.
create or replace function entrar_jugador(
  p_codigo text, p_jugador text, p_nombre text, p_iniciales text,
  p_index numeric, p_hcp int, p_salida text, p_llave text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_llave text; v_cuantos int;
begin
  select llave into v_llave from jugadores where id = p_jugador;

  if v_llave is not null and (p_llave is null or p_llave <> v_llave) then
    return null;                       -- el puesto es de otro teléfono
  end if;
  if v_llave is null then
    v_llave := llave_nueva();
    -- Tope de jugadores por ronda: un grupo de golf son cuatro. Sin tope,
    -- cualquiera con el código infla la ronda hasta hacerla inusable.
    select count(*) into v_cuantos from jugadores
     where ronda = p_codigo and borrado_en is null;
    if v_cuantos >= 8 then
      return null;
    end if;
  end if;

  insert into jugadores (id, ronda, nombre, iniciales, index_hcp, hcp_cancha, salida, llave)
  values (p_jugador, p_codigo, coalesce(recortar(p_nombre,40),'—'), recortar(p_iniciales,4),
          p_index, p_hcp, recortar(p_salida,12), v_llave)
  on conflict (id) do update
    set nombre = excluded.nombre, iniciales = excluded.iniciales,
        index_hcp = excluded.index_hcp, hcp_cancha = excluded.hcp_cancha,
        salida = excluded.salida, visto = now(), borrado_en = null;

  return v_llave;
end $$;
revoke execute on function entrar_jugador(text,text,text,text,numeric,int,text,text)
  from public, anon, authenticated;

-- ---------- cómo viene la ronda ----------
--  Con p_desde sólo devuelve lo que cambió: en la cancha la señal es
--  mala y no tiene sentido bajar la vuelta entera cada seis segundos.

create or replace function ronda_estado(p_codigo text, p_desde timestamptz)
returns json
language plpgsql security definer set search_path = public as $$
declare v json; v_borrada boolean;
begin
  select (borrado_en is not null) into v_borrada
    from rondas where codigo = upper(p_codigo);

  select json_build_object(
    'ronda', (select row_to_json(r) from rondas r
               where r.codigo = upper(p_codigo) and r.borrado_en is null),
    -- Que el teléfono pueda DECIRLO. Sin esto, una ronda borrada llega como
    -- una ronda vacía y el jugador ve la tarjeta en blanco sin entender nada,
    -- que es justo lo que este proyecto no hace.
    'borrada', coalesce(v_borrada, false),
    -- Campo por campo y NO `row_to_json`: la fila tiene `llave`, y
    -- `row_to_json` se la mandaría a todos los teléfonos de la ronda, que es
    -- exactamente lo contrario de para qué existe.
    'jugadores', coalesce((select json_agg(json_build_object(
         'id', j.id, 'ronda', j.ronda, 'nombre', j.nombre, 'iniciales', j.iniciales,
         'index_hcp', j.index_hcp, 'hcp_cancha', j.hcp_cancha, 'salida', j.salida,
         'marca_a', j.marca_a, 'visto', j.visto))
       from jugadores j
      where j.ronda = upper(p_codigo) and j.borrado_en is null), '[]'::json),
    -- En la carga entera van sólo las vivas. En "lo que cambió desde X" van
    -- también las borradas, porque el borrado ES un cambio: si no viajara,
    -- el otro teléfono seguiría mostrando para siempre una anotación que ya
    -- no está. Por eso borrar toca `actualizado`.
    'anotaciones', coalesce((select json_agg(row_to_json(a))
       from anotaciones a
      where a.ronda = upper(p_codigo)
        and (case when p_desde is null then a.borrado_en is null
                  else a.actualizado > p_desde end)), '[]'::json),
    'ahora', now()
  ) into v;
  return v;
end $$;

-- ---------- anotar un hoyo ----------
--  `p_por` es quien anota y `p_de` de quién es el score. Cuando son
--  distintos, es un marcador llevando la tarjeta de otro.

create or replace function anotar(
  p_codigo text, p_llave text, p_por text, p_de text, p_hoyo int,
  p_golpes int, p_putts int, p_bunker int, p_penal int, p_salida_fw text
) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rondas
                  where codigo = upper(p_codigo) and borrado_en is null and not cerrada) then
    return json_build_object('error', 'esa ronda ya no está abierta');
  end if;
  -- La llave, no el código: el código lo tiene cualquiera que lo haya escuchado.
  if not exists (select 1 from jugadores
                  where id = p_por and ronda = upper(p_codigo)
                    and borrado_en is null and llave is not null and llave = p_llave) then
    return json_build_object('error', 'no sos vos');
  end if;
  -- Y `de` tiene que ser alguien de la ronda: si no, se pueden inventar
  -- jugadores que no existen y llenar la tabla de filas fantasma.
  if not exists (select 1 from jugadores
                  where id = p_de and ronda = upper(p_codigo) and borrado_en is null) then
    return json_build_object('error', 'ese jugador no está en la ronda');
  end if;

  insert into anotaciones (ronda, de, por, hoyo, golpes, putts, bunker, penal, salida_fw)
  values (upper(p_codigo), p_de, p_por, p_hoyo, p_golpes, p_putts, p_bunker, p_penal,
          recortar(p_salida_fw,12))
  on conflict (ronda, de, por, hoyo) do update
    set golpes = excluded.golpes, putts = excluded.putts,
        bunker = excluded.bunker, penal = excluded.penal,
        salida_fw = excluded.salida_fw, actualizado = now(), borrado_en = null;

  update jugadores set visto = now() where id = p_por;
  return json_build_object('ok', true);
end $$;

-- ---------- a quién le marco ----------

create or replace function marcar_a(p_codigo text, p_llave text, p_jugador text, p_a text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  if p_a is not null and not exists (select 1 from jugadores
        where id = p_a and ronda = upper(p_codigo) and borrado_en is null) then
    return json_build_object('error', 'ese jugador no está en la ronda');
  end if;
  update jugadores set marca_a = p_a, visto = now()
   where id = p_jugador and ronda = upper(p_codigo) and borrado_en is null
     and llave is not null and llave = p_llave;
  if not found then return json_build_object('error', 'no sos vos'); end if;
  return json_build_object('ok', true);
end $$;

-- ---------- cerrar ----------

--  Cerrar era gratis para cualquiera con el código, y no hay forma de
--  reabrir desde la app: un tercero dejaba al grupo afuera de su propia
--  ronda con una sola llamada. Ahora hay que ser del grupo.
create or replace function ronda_cerrar(p_codigo text, p_llave text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from jugadores
                  where ronda = upper(p_codigo) and borrado_en is null
                    and llave is not null and llave = p_llave) then
    return json_build_object('error', 'no sos de esta ronda');
  end if;
  update rondas set cerrada = true
   where codigo = upper(p_codigo) and borrado_en is null;
  return json_build_object('ok', found);
end $$;

-- ---------- permisos ----------
--  Sólo estas siete puertas, y todas piden el código.

--  Las firmas viejas, si quedaron de una versión anterior, se van: seguirían
--  concedidas a `anon` y serían la misma puerta sin llave que estamos cerrando.
drop function if exists ronda_abrir(text,text,text,int,boolean,text,text,text,numeric,int,text);
drop function if exists ronda_unirse(text,text,text,text,numeric,int,text);
drop function if exists anotar(text,text,text,int,int,int,int,int,text);
drop function if exists marcar_a(text,text,text);
drop function if exists ronda_cerrar(text);

grant execute on function ronda_abrir(text,text,text,int,boolean,text,text,text,numeric,int,text,text) to anon;
grant execute on function ronda_unirse(text,text,text,text,numeric,int,text,text) to anon;
grant execute on function ronda_estado(text,timestamptz)                          to anon;
grant execute on function anotar(text,text,text,text,int,int,int,int,int,text)    to anon;
grant execute on function marcar_a(text,text,text,text)                           to anon;
grant execute on function ronda_cerrar(text,text)                                 to anon;

-- ---------- borrar, restaurar, purgar ----------
--  Las tres son de administración: NO se le dan a `anon`. Hoy no hay
--  cuentas, así que cualquiera con la clave pública es `anon`; darle una
--  función que borra rondas sería regalarle el botón. Se corren desde el
--  SQL Editor, que es donde tiene sentido. Cuando existan las cuentas de
--  verdad, `borrar_ronda` puede abrirse a quien creó la ronda.

--  Borrar una ronda: la ronda, sus jugadores y sus anotaciones quedan con
--  fecha de borrado. `actualizado = now()` en las anotaciones es a
--  propósito: así el borrado viaja como un cambio más y los teléfonos que
--  están en la ronda lo ven en el próximo latido.
create or replace function borrar_ronda(p_codigo text)
returns json
language plpgsql security definer set search_path = public as $$
declare n_anot int; n_jug int;
begin
  update anotaciones set borrado_en = now(), actualizado = now()
   where ronda = upper(p_codigo) and borrado_en is null;
  get diagnostics n_anot = row_count;

  update jugadores set borrado_en = now()
   where ronda = upper(p_codigo) and borrado_en is null;
  get diagnostics n_jug = row_count;

  update rondas set borrado_en = now()
   where codigo = upper(p_codigo) and borrado_en is null;

  return json_build_object('ok', found, 'jugadores', n_jug, 'anotaciones', n_anot);
end $$;

--  Volver atrás. Esto es todo el punto del borrado lógico.
create or replace function restaurar_ronda(p_codigo text)
returns json
language plpgsql security definer set search_path = public as $$
declare n_anot int; n_jug int;
begin
  update rondas set borrado_en = null
   where codigo = upper(p_codigo) and borrado_en is not null;
  if not found then
    return json_build_object('error', 'esa ronda no está borrada');
  end if;

  update anotaciones set borrado_en = null, actualizado = now()
   where ronda = upper(p_codigo) and borrado_en is not null;
  get diagnostics n_anot = row_count;

  update jugadores set borrado_en = null
   where ronda = upper(p_codigo) and borrado_en is not null;
  get diagnostics n_jug = row_count;

  return json_build_object('ok', true, 'jugadores', n_jug, 'anotaciones', n_anot);
end $$;

-- ---------- limpieza ----------
--  Una ronda vieja no le sirve a nadie, pero tampoco hace falta destruirla.
--  A los 30 días se marca como borrada y desaparece de la app; la fila
--  sigue estando por si alguien reclama su tarjeta. Se puede correr a mano
--  cada tanto, o programarlo con pg_cron si algún día hace falta.

create or replace function limpiar_rondas_viejas()
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update anotaciones a set borrado_en = now(), actualizado = now()
    from rondas r
   where a.ronda = r.codigo and a.borrado_en is null
     and r.creada < now() - interval '30 days';

  update jugadores j set borrado_en = now()
    from rondas r
   where j.ronda = r.codigo and j.borrado_en is null
     and r.creada < now() - interval '30 days';

  update rondas set borrado_en = now()
   where creada < now() - interval '30 days' and borrado_en is null;
  get diagnostics n = row_count;
  return n;
end $$;

--  El único `delete` que queda. Sin esto el borrado lógico crece para
--  siempre. Por omisión sólo toca lo que se borró hace más de 90 días:
--  entre que una ronda se marca (30 días) y que se destruye pasan cuatro
--  meses. El `on delete cascade` se lleva jugadores y anotaciones.
create or replace function purgar_borradas(p_dias int default 90)
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from rondas
   where borrado_en is not null
     and borrado_en < now() - (greatest(p_dias, 1) || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end $$;

--  A las seis funciones de la app les dimos `execute` a mano; a estas cuatro
--  no. Pero Postgres se lo da solo a `public` en CADA función nueva, así que
--  quedarían abiertas: cualquiera con la clave pública podría llamar a una
--  función `security definer` que BORRA. Ya pasó una vez con
--  `limpiar_rondas_viejas()`. Se lo sacamos a las cuatro, siempre.
revoke execute on function borrar_ronda(text)          from public, anon, authenticated;
revoke execute on function restaurar_ronda(text)       from public, anon, authenticated;
revoke execute on function limpiar_rondas_viejas()     from public, anon, authenticated;
revoke execute on function purgar_borradas(int)        from public, anon, authenticated;
