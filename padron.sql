-- ============================================================
--  TRISQUELIA · EL ALTA DE SOCIOS
-- ============================================================
--  Se pega DESPUÉS de `esquema.sql`, en el mismo SQL Editor.
--  Usa `recortar()`, que vive allá.
--
--  QUÉ PROBLEMA RESUELVE
--  Hoy cualquiera con el código de una ronda se suma con el nombre
--  que quiera. Para jugar entre amigos alcanza; para un torneo que
--  cuenta para el handicap, no: el que entra tiene que ser un socio
--  y tiene que poder probarlo.
--
--  LA IDEA, Y ES UNA SOLA
--  El club ya sabe quién es cada socio y cómo contactarlo: está en
--  el padrón. Entonces el que se registra escribe su DNI, y el
--  código de seis dígitos NO va a la dirección que él escribió: va
--  A LA QUE EL CLUB YA TENÍA. Si lo recibe, es él.
--
--  Esa sola distinción es lo que convierte al DNI en una prueba de
--  identidad en vez de en un dato que cualquiera puede copiar de un
--  carnet. Si alguna vez alguien propone "que se mande al mail que
--  puso", se cae todo el edificio: el DNI de otro se consigue.
--
--  POR ESO EL PADRÓN NO SE PUEDE ESPIAR
--  Si se pudiera preguntar DNI por DNI y ver cuáles existen, con
--  paciencia se arma la lista de socios del club. Acá:
--    · misma forma de respuesta exista el DNI o no,
--    · y el mismo tiempo, porque el trabajo caro se hace siempre,
--    · tres pedidos por hora por DNI y sesenta en total por hora,
--    · pasado el límite, respuesta neutra para todos.
--  El mail nunca sale entero: sale `j••••z@gmail.com`, lo justo
--  para que uno reconozca su casilla y nadie más aprenda nada.
--
--  EL CÓDIGO NO SE GUARDA
--  De los seis dígitos se guarda sólo el hash bcrypt, igual que una
--  clave. Vence a los diez minutos y muere al primer uso. Ni yo, ni
--  el que entre a la base, puede leer el código de nadie.
--
--  QUIÉN MANDA EL MAIL
--  Postgres no manda mails. `codigo_pedir()` prepara el código y lo
--  devuelve UNA vez, a quien lo pidió — y a esa función sólo la
--  puede llamar la Neon Function del alta, que corre en el servidor
--  y tiene la clave de Brevo. El teléfono nunca la alcanza: para él
--  existe una sola puerta, la Function, y de ahí vuelve nada más
--  que el estado y la pista del mail.
--
--  DATOS PERSONALES · ley 25.326
--  Acá adentro viven el DNI, el nombre, el mail y el teléfono de
--  123 personas. Este archivo es la ESTRUCTURA y no tiene ni un
--  dato de nadie: el padrón se carga aparte y NUNCA va a un
--  repositorio. Las bajas son lógicas (`activo = false`), nunca un
--  `delete`, igual que en `esquema.sql`.
-- ============================================================

-- ---------- los dos roles de la Data API ----------
--  Mismo seguro que en `esquema.sql`, por si esto se corre solo.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anonymous') then
    create role anonymous nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- ---------- bcrypt ----------
--  `crypt()` y `gen_salt('bf')` vienen de acá. Se usa para el código
--  de seis dígitos y para la clave de la cuenta: ninguno de los dos
--  se guarda nunca en claro.
create extension if not exists pgcrypto;

-- ============================================================
--  LAS TABLAS
-- ============================================================

-- ---------- el padrón que da el club ----------
--  Es un espejo de la lista del club, no la verdad del club. Se
--  recarga cuando el club manda una lista nueva. Nadie escribe acá
--  desde la app.
create table if not exists padron (
  dni         text primary key,
  apellido    text not null,
  nombres     text not null,
  mail        text,
  tel         text,
  tel_dudoso  boolean not null default false,  -- 6 dígitos sueltos: ¿celular o fijo?
  socio       text,                            -- número de socio, si el club lo tiene
  activo      boolean not null default true,   -- baja lógica, ley 25.326
  cargado_en  timestamptz not null default now()
);

-- ---------- la cuenta, que es lo que la persona controla ----------
--  Un DNI, una cuenta. `llave` es el mismo invento que en
--  `esquema.sql`: el secreto de ESTE teléfono, que viaja en cada
--  escritura y nunca sale en una consulta.
create table if not exists cuentas (
  dni          text primary key references padron(dni) on delete restrict,
  llave        text not null,
  clave_hash   text not null,
  creada       timestamptz not null default now(),
  ultimo_visto timestamptz,
  borrado_en   timestamptz
);

-- ---------- el código de seis dígitos ----------
--  Uno vivo por DNI como mucho: pedir otro pisa el anterior, así no
--  quedan cinco códigos válidos dando vueltas.
create table if not exists codigos (
  dni       text primary key references padron(dni) on delete cascade,
  hash      text not null,                 -- bcrypt, nunca el código
  vence_en  timestamptz not null,
  intentos  int not null default 0,
  creado_en timestamptz not null default now()
);

-- ---------- el libro de pedidos, que es el freno ----------
--  Una fila por intento, exista el DNI o no. De acá salen los tres
--  límites. `dni_pedido` puede ser un DNI que no existe: eso es
--  justamente lo que hay que contar para que no se pueda barrer.
create table if not exists pedidos (
  id         bigserial primary key,
  dni_pedido text not null,
  cuando     timestamptz not null default now()
);

-- ---------- la migración ----------
--  Mismo criterio que en `esquema.sql`: en una base que ya existe
--  agregan la columna sin tocar los datos; en una nueva no hacen nada.
alter table padron  add column if not exists tel_dudoso boolean not null default false;
alter table padron  add column if not exists activo     boolean not null default true;
alter table cuentas add column if not exists borrado_en timestamptz;

-- ---------- los índices ----------
--  Los dos que usan los frenos, y el del mail para el día que se
--  entre con la dirección en vez del DNI.
create index if not exists pedidos_por_rato  on pedidos (cuando);
create index if not exists pedidos_por_dni   on pedidos (dni_pedido, cuando);
create index if not exists padron_por_mail   on padron (lower(mail)) where mail is not null;

-- ============================================================
--  LOS AYUDANTES · nadie los llama de afuera
-- ============================================================

-- ---------- tapar el mail ----------
--  `juanperez@gmail.com` → `j•••••••z@gmail.com`. Se ven la primera
--  y la última letra y el dominio entero: alcanza para que uno
--  reconozca su casilla y no alcanza para adivinarla.
create or replace function tapar_mail(t text) returns text
language sql immutable as $$
  select case
    when t is null or position('@' in t) = 0 then null
    when length(split_part(t,'@',1)) <= 2
      then left(split_part(t,'@',1),1) || '•••@' || split_part(t,'@',2)
    else left(split_part(t,'@',1),1)
       || repeat('•', greatest(length(split_part(t,'@',1)) - 2, 1))
       || right(split_part(t,'@',1),1) || '@' || split_part(t,'@',2)
  end
$$;
revoke execute on function tapar_mail(text) from public, anonymous, authenticated;

-- ---------- tapar el teléfono ----------
create or replace function tapar_tel(t text) returns text
language sql immutable as $$
  select case when t is null or length(t) < 4 then null
              else repeat('•', greatest(length(t)-4,0)) || right(t,4) end
$$;
revoke execute on function tapar_tel(text) from public, anonymous, authenticated;

-- ---------- seis dígitos al azar ----------
--  `gen_random_bytes` y no `random()`: el segundo es predecible si
--  se conoce la semilla, y acá esto ES la credencial.
create or replace function codigo_nuevo() returns text
language sql as $$
  select lpad((((get_byte(b,0)::int << 16) | (get_byte(b,1)::int << 8) | get_byte(b,2)::int)
               % 1000000)::text, 6, '0')
  from (select gen_random_bytes(3) as b) _
$$;
revoke execute on function codigo_nuevo() from public, anonymous, authenticated;

-- ---------- el freno ----------
--  Tres capas, y la tercera es la que importa:
--   1. tres pedidos por hora para el MISMO DNI — contra el que
--      insiste con uno solo;
--   2. sesenta pedidos por hora en total — contra el que prueba
--      miles de DNI distintos, que es como se barre un padrón;
--   3. y la respuesta pasado el límite es la misma que la de un DNI
--      que no existe, así el freno tampoco cuenta nada.
create or replace function limite_ok(p_dni text) returns boolean
language plpgsql as $$
declare v_mio int; v_todos int;
begin
  insert into pedidos (dni_pedido) values (p_dni);
  delete from pedidos where cuando < now() - interval '2 hours';
  select count(*) into v_mio   from pedidos
   where dni_pedido = p_dni and cuando > now() - interval '1 hour';
  select count(*) into v_todos from pedidos
   where cuando > now() - interval '1 hour';
  return v_mio <= 3 and v_todos <= 60;
end $$;
revoke execute on function limite_ok(text) from public, anonymous, authenticated;

-- ============================================================
--  LA PUERTA DEL ALTA · sólo la llama la Function del servidor
-- ============================================================

-- ---------- pedir el código ----------
--  Devuelve CUATRO estados, que son los cuatro que la app ya sabe
--  dibujar: `codigo`, `usado`, `sincontacto`, `nopadron`.
--
--  El campo `codigo` del JSON sale UNA sola vez y sólo para quien
--  llama a esta función, que es la Neon Function que manda el mail.
--  El teléfono recibe la respuesta de la Function, no ésta.
--
--  Sobre el tiempo: el `crypt()` es lo caro de todo esto —unos 60
--  milisegundos a propósito— y se corre SIEMPRE, incluso cuando el
--  DNI no existe y el código se tira a la basura. Si sólo se
--  corriera para los que existen, la diferencia de tiempo sería, de
--  hecho, la respuesta: "este DNI tardó más, entonces es socio".
create or replace function codigo_pedir(p_dni text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_dni text := regexp_replace(coalesce(p_dni,''), '\D', '', 'g');
  v_p   padron%rowtype;
  v_cod text := codigo_nuevo();
  v_h   text;
  v_hay boolean;
begin
  if length(v_dni) < 7 or length(v_dni) > 8 then
    return json_build_object('estado','nopadron');
  end if;

  if not limite_ok(v_dni) then
    -- Misma respuesta que un DNI que no existe: el freno no delata nada.
    perform crypt(v_cod, gen_salt('bf', 8));
    return json_build_object('estado','nopadron');
  end if;

  select * into v_p from padron where dni = v_dni and activo;

  -- El trabajo caro, siempre, exista o no el socio.
  v_h := crypt(v_cod, gen_salt('bf', 8));

  if v_p.dni is null then
    return json_build_object('estado','nopadron');
  end if;

  if exists (select 1 from cuentas where dni = v_dni and borrado_en is null) then
    return json_build_object('estado','usado');
  end if;

  v_hay := (v_p.mail is not null) or (v_p.tel is not null and not v_p.tel_dudoso);
  if not v_hay then
    return json_build_object('estado','sincontacto');
  end if;

  insert into codigos (dni, hash, vence_en, intentos)
  values (v_dni, v_h, now() + interval '10 minutes', 0)
  on conflict (dni) do update
    set hash = excluded.hash, vence_en = excluded.vence_en,
        intentos = 0, creado_en = now();

  return json_build_object(
    'estado', 'codigo',
    'pista',  coalesce(tapar_mail(v_p.mail), tapar_tel(v_p.tel)),
    -- lo que sigue es para la Function que manda el mail, y muere ahí
    'mail',   v_p.mail,
    'tel',    v_p.tel,
    'codigo', v_cod
  );
end $$;
revoke execute on function codigo_pedir(text) from public, anonymous, authenticated;

-- ============================================================
--  LO QUE SÍ LLAMA EL TELÉFONO
-- ============================================================

-- ---------- verificar el código ----------
--  Cinco intentos y el código se muere. No devuelve el nombre ni
--  nada del socio: devuelve un TICKET de cinco minutos, que es lo
--  único que sirve para crear la cuenta. Así, aunque alguien
--  adivinara un código, todavía tiene que usarlo ya.
create or replace function codigo_verificar(p_dni text, p_codigo text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_dni text := regexp_replace(coalesce(p_dni,''), '\D', '', 'g');
  v_c   codigos%rowtype;
  v_t   text;
begin
  --  `intentos >= 0` deja afuera la fila del ticket, que usa -1: un ticket ya
  --  ganado no se puede volver a gastar como si fuera un código.
  select * into v_c from codigos where dni = v_dni and intentos >= 0;

  if v_c.dni is null or v_c.vence_en < now() or v_c.intentos >= 5 then
    -- Se corre igual para que fallar cueste lo mismo que acertar.
    perform crypt(coalesce(p_codigo,''), gen_salt('bf', 8));
    delete from codigos where dni = v_dni and (vence_en < now() or intentos >= 5);
    return json_build_object('error', 'ese código no sirve');
  end if;

  update codigos set intentos = intentos + 1 where dni = v_dni;

  if v_c.hash <> crypt(coalesce(p_codigo,''), v_c.hash) then
    return json_build_object('error', 'ese código no sirve');
  end if;

  -- Acertó: el código muere acá y queda un ticket corto en su lugar.
  v_t := replace(gen_random_uuid()::text, '-', '');
  delete from codigos where dni = v_dni;
  insert into codigos (dni, hash, vence_en, intentos)
  values (v_dni, crypt(v_t, gen_salt('bf', 8)), now() + interval '5 minutes', -1);

  return json_build_object('ok', true, 'ticket', v_t);
end $$;

-- ---------- crear la cuenta ----------
--  El nombre sale del PADRÓN, no de lo que escriba la persona: ése
--  es el sentido de haber verificado. La clave se guarda hasheada;
--  el largo mínimo lo comprueba también la app, pero acá se repite
--  porque el servidor no confía en el teléfono.
create or replace function cuenta_crear(p_dni text, p_ticket text, p_clave text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_dni text := regexp_replace(coalesce(p_dni,''), '\D', '', 'g');
  v_c   codigos%rowtype;
  v_p   padron%rowtype;
  v_ll  text;
begin
  if length(coalesce(p_clave,'')) < 8 then
    return json_build_object('error', 'la clave necesita ocho caracteres');
  end if;

  select * into v_c from codigos where dni = v_dni and intentos = -1;
  if v_c.dni is null or v_c.vence_en < now()
     or v_c.hash <> crypt(coalesce(p_ticket,''), v_c.hash) then
    return json_build_object('error', 'volvé a pedir el código');
  end if;

  select * into v_p from padron where dni = v_dni and activo;
  if v_p.dni is null then
    return json_build_object('error', 'volvé a pedir el código');
  end if;

  if exists (select 1 from cuentas where dni = v_dni and borrado_en is null) then
    return json_build_object('error', 'ese DNI ya tiene una cuenta');
  end if;

  v_ll := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  insert into cuentas (dni, llave, clave_hash, ultimo_visto)
  values (v_dni, v_ll, crypt(p_clave, gen_salt('bf', 10)), now())
  on conflict (dni) do update
    set llave = excluded.llave, clave_hash = excluded.clave_hash,
        borrado_en = null, ultimo_visto = now();

  delete from codigos where dni = v_dni;

  return json_build_object('ok', true, 'llave', v_ll,
    'nombre', v_p.nombres, 'apellido', v_p.apellido,
    'socio', v_p.socio, 'mail', v_p.mail);
end $$;

-- ---------- entrar ----------
--  Con DNI y clave. Devuelve la llave de vuelta: es lo que el
--  teléfono guarda y presenta después. Un DNI que no existe y una
--  clave equivocada dan el mismo error y tardan lo mismo.
create or replace function entrar(p_dni text, p_clave text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_dni text := regexp_replace(coalesce(p_dni,''), '\D', '', 'g');
  v_cu  cuentas%rowtype;
  v_p   padron%rowtype;
begin
  select * into v_cu from cuentas where dni = v_dni and borrado_en is null;

  if v_cu.dni is null then
    perform crypt(coalesce(p_clave,''), gen_salt('bf', 10));
    return json_build_object('error', 'no coinciden el DNI y la clave');
  end if;

  if v_cu.clave_hash <> crypt(coalesce(p_clave,''), v_cu.clave_hash) then
    return json_build_object('error', 'no coinciden el DNI y la clave');
  end if;

  update cuentas set ultimo_visto = now() where dni = v_dni;
  select * into v_p from padron where dni = v_dni;

  return json_build_object('ok', true, 'llave', v_cu.llave,
    'nombre', v_p.nombres, 'apellido', v_p.apellido,
    'socio', v_p.socio, 'mail', v_p.mail);
end $$;

-- ============================================================
--  LO QUE CORRE EL CLUB A MANO · nadie de afuera
-- ============================================================

-- ---------- cargar el padrón ----------
--  Se llama una vez por socio desde el SQL Editor, con el CSV que
--  sale de `preparar-padron.py`. Vuelve a correrse sin miedo: pisa
--  el contacto y deja las cuentas donde están.
create or replace function padron_cargar(
  p_dni text, p_apellido text, p_nombres text,
  p_mail text, p_tel text, p_tel_dudoso boolean, p_socio text
) returns json
language plpgsql security definer set search_path = public as $$
declare v_dni text := regexp_replace(coalesce(p_dni,''), '\D', '', 'g');
begin
  if length(v_dni) < 7 then return json_build_object('error','DNI corto'); end if;
  insert into padron (dni, apellido, nombres, mail, tel, tel_dudoso, socio)
  values (v_dni, recortar(p_apellido,60), recortar(p_nombres,60),
          lower(recortar(p_mail,120)), recortar(p_tel,30),
          coalesce(p_tel_dudoso,false), recortar(p_socio,12))
  on conflict (dni) do update
    set apellido = excluded.apellido, nombres = excluded.nombres,
        mail = excluded.mail, tel = excluded.tel,
        tel_dudoso = excluded.tel_dudoso, socio = excluded.socio,
        activo = true;
  return json_build_object('ok', true);
end $$;
revoke execute on function padron_cargar(text,text,text,text,text,boolean,text)
  from public, anonymous, authenticated;

-- ---------- habilitar a mano ----------
--  Para los que no tienen a dónde recibir el código (dos dominios de
--  empresa muertos y uno sin mail). El club los verifica en persona
--  y les carga un contacto, o les crea la cuenta con una clave que
--  la persona cambia después.
create or replace function habilitar_contacto(p_dni text, p_mail text, p_tel text)
returns json
language plpgsql security definer set search_path = public as $$
declare v_dni text := regexp_replace(coalesce(p_dni,''), '\D', '', 'g');
begin
  update padron set mail = lower(recortar(p_mail,120)),
                    tel = recortar(p_tel,30), tel_dudoso = false
   where dni = v_dni and activo;
  if not found then return json_build_object('error','ese DNI no está en el padrón'); end if;
  return json_build_object('ok', true);
end $$;
revoke execute on function habilitar_contacto(text,text,text)
  from public, anonymous, authenticated;

-- ---------- dar de baja ----------
--  Baja lógica, siempre. El socio que se va deja de poder entrar,
--  pero sus tarjetas siguen siendo la prueba de las vueltas que jugó.
create or replace function socio_baja(p_dni text) returns json
language plpgsql security definer set search_path = public as $$
declare v_dni text := regexp_replace(coalesce(p_dni,''), '\D', '', 'g');
begin
  update padron  set activo = false     where dni = v_dni;
  update cuentas set borrado_en = now() where dni = v_dni and borrado_en is null;
  delete from codigos where dni = v_dni;
  return json_build_object('ok', true);
end $$;
revoke execute on function socio_baja(text) from public, anonymous, authenticated;

-- ---------- barrer lo vencido ----------
--  Códigos muertos y libro de pedidos viejo. Lo puede correr la
--  Function por reloj, una vez por día, o el club a mano.
create or replace function limpiar_alta() returns json
language plpgsql security definer set search_path = public as $$
declare v_c int; v_p int;
begin
  delete from codigos where vence_en < now() - interval '1 hour';
  get diagnostics v_c = row_count;
  delete from pedidos where cuando < now() - interval '2 hours';
  get diagnostics v_p = row_count;
  return json_build_object('codigos', v_c, 'pedidos', v_p);
end $$;
revoke execute on function limpiar_alta() from public, anonymous, authenticated;

-- ============================================================
--  QUIÉN PUEDE TOCAR QUÉ
-- ============================================================
--  Mismo criterio que `esquema.sql`, y acá pesa más: en estas
--  tablas hay datos personales de 123 personas.
--
--  RLS activa y sin políticas = todo bloqueado, más un `revoke all`.
--  Un `select * from padron` desde la app rebota por permisos, no
--  devuelve una lista vacía que después alguien confunda con "no hay
--  socios cargados".

alter table padron  enable row level security;
alter table cuentas enable row level security;
alter table codigos enable row level security;
alter table pedidos enable row level security;

revoke all on padron, cuentas, codigos, pedidos from anonymous, authenticated;
revoke all on sequence pedidos_id_seq from anonymous, authenticated;

--  Y el cierre: se revoca TODO y se devuelven sólo las tres que el
--  teléfono necesita. `codigo_pedir` NO está en esta lista a
--  propósito: ésa la llama la Function del servidor, con su propia
--  conexión, y el teléfono no la alcanza nunca.
revoke execute on function codigo_verificar(text,text) from public, anonymous, authenticated;
revoke execute on function cuenta_crear(text,text,text) from public, anonymous, authenticated;
revoke execute on function entrar(text,text)            from public, anonymous, authenticated;

grant execute on function codigo_verificar(text,text) to anonymous;
grant execute on function cuenta_crear(text,text,text) to anonymous;
grant execute on function entrar(text,text)            to anonymous;
