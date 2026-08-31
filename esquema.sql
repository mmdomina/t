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
  cerrada     boolean not null default false
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
  visto       timestamptz not null default now()
);
create index if not exists jugadores_por_ronda on jugadores (ronda);

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
  primary key (ronda, de, por, hoyo)
);
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
  p_index numeric, p_hcp int, p_salida text
) returns json
language plpgsql security definer set search_path = public as $$
begin
  insert into rondas (codigo, club, cancha, vuelta, torneo)
  values (upper(p_codigo), p_club, p_cancha, coalesce(p_vuelta,18), coalesce(p_torneo,false))
  on conflict (codigo) do nothing;

  insert into jugadores (id, ronda, nombre, iniciales, index_hcp, hcp_cancha, salida)
  values (p_jugador, upper(p_codigo), p_nombre, p_iniciales, p_index, p_hcp, p_salida)
  on conflict (id) do update
    set nombre = excluded.nombre, iniciales = excluded.iniciales,
        index_hcp = excluded.index_hcp, hcp_cancha = excluded.hcp_cancha,
        salida = excluded.salida, visto = now();

  return ronda_estado(upper(p_codigo), null);
end $$;

-- ---------- sumarse a una que ya existe ----------

create or replace function ronda_unirse(
  p_codigo text, p_jugador text, p_nombre text, p_iniciales text,
  p_index numeric, p_hcp int, p_salida text
) returns json
language plpgsql security definer set search_path = public as $$
declare v_existe boolean;
begin
  select true into v_existe from rondas
   where codigo = upper(p_codigo) and not cerrada;
  if v_existe is not true then
    return json_build_object('error', 'no existe esa ronda');
  end if;

  insert into jugadores (id, ronda, nombre, iniciales, index_hcp, hcp_cancha, salida)
  values (p_jugador, upper(p_codigo), p_nombre, p_iniciales, p_index, p_hcp, p_salida)
  on conflict (id) do update
    set nombre = excluded.nombre, iniciales = excluded.iniciales,
        index_hcp = excluded.index_hcp, hcp_cancha = excluded.hcp_cancha,
        salida = excluded.salida, visto = now();

  return ronda_estado(upper(p_codigo), null);
end $$;

-- ---------- cómo viene la ronda ----------
--  Con p_desde sólo devuelve lo que cambió: en la cancha la señal es
--  mala y no tiene sentido bajar la vuelta entera cada seis segundos.

create or replace function ronda_estado(p_codigo text, p_desde timestamptz)
returns json
language plpgsql security definer set search_path = public as $$
declare v json;
begin
  select json_build_object(
    'ronda', (select row_to_json(r) from rondas r where r.codigo = upper(p_codigo)),
    'jugadores', coalesce((select json_agg(row_to_json(j))
       from jugadores j where j.ronda = upper(p_codigo)), '[]'::json),
    'anotaciones', coalesce((select json_agg(row_to_json(a))
       from anotaciones a
      where a.ronda = upper(p_codigo)
        and (p_desde is null or a.actualizado > p_desde)), '[]'::json),
    'ahora', now()
  ) into v;
  return v;
end $$;

-- ---------- anotar un hoyo ----------
--  `p_por` es quien anota y `p_de` de quién es el score. Cuando son
--  distintos, es un marcador llevando la tarjeta de otro.

create or replace function anotar(
  p_codigo text, p_por text, p_de text, p_hoyo int,
  p_golpes int, p_putts int, p_bunker int, p_penal int, p_salida_fw text
) returns json
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from jugadores
                  where id = p_por and ronda = upper(p_codigo)) then
    return json_build_object('error', 'ese jugador no está en la ronda');
  end if;

  insert into anotaciones (ronda, de, por, hoyo, golpes, putts, bunker, penal, salida_fw)
  values (upper(p_codigo), p_de, p_por, p_hoyo, p_golpes, p_putts, p_bunker, p_penal, p_salida_fw)
  on conflict (ronda, de, por, hoyo) do update
    set golpes = excluded.golpes, putts = excluded.putts,
        bunker = excluded.bunker, penal = excluded.penal,
        salida_fw = excluded.salida_fw, actualizado = now();

  update jugadores set visto = now() where id = p_por;
  return json_build_object('ok', true);
end $$;

-- ---------- a quién le marco ----------

create or replace function marcar_a(p_codigo text, p_jugador text, p_a text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  update jugadores set marca_a = p_a, visto = now()
   where id = p_jugador and ronda = upper(p_codigo);
  return json_build_object('ok', found);
end $$;

-- ---------- cerrar ----------

create or replace function ronda_cerrar(p_codigo text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  update rondas set cerrada = true where codigo = upper(p_codigo);
  return json_build_object('ok', found);
end $$;

-- ---------- permisos ----------
--  Sólo estas siete puertas, y todas piden el código.

grant execute on function ronda_abrir(text,text,text,int,boolean,text,text,text,numeric,int,text) to anon;
grant execute on function ronda_unirse(text,text,text,text,numeric,int,text) to anon;
grant execute on function ronda_estado(text,timestamptz)                     to anon;
grant execute on function anotar(text,text,text,int,int,int,int,int,text)    to anon;
grant execute on function marcar_a(text,text,text)                           to anon;
grant execute on function ronda_cerrar(text)                                 to anon;

-- ---------- limpieza ----------
--  Una ronda vieja no le sirve a nadie. Esto se puede correr a mano
--  cada tanto, o programarlo con pg_cron si algún día hace falta.

create or replace function limpiar_rondas_viejas()
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from rondas where creada < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

--  A las otras funciones les dimos `execute` a mano; a ésta nunca. Pero
--  Postgres se lo da solo a `public` en cada función nueva, así que
--  quedaba abierta: cualquiera con la clave pública podía llamar a una
--  función `security definer` que BORRA rondas. Se lo sacamos. Sigue
--  disponible desde el SQL Editor, que es donde tiene sentido correrla.
revoke execute on function limpiar_rondas_viejas() from public, anon, authenticated;
