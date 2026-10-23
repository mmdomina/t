-- ============================================================
--  PRUEBAS DEL PANEL DEL CLUB · avisos y estado de cancha
-- ============================================================
--  Cómo correrlo, contra un Postgres vacío:
--
--    createdb t
--    psql -d t -f esquema.sql
--    psql -d t -f club.sql
--    psql -d t -f club.sql             -- otra vez: tiene que ser idempotente
--    psql -d t -f pruebas/clubtest.sql
--
--  Da una línea por comprobación y un resumen al final. Cualquier ✗ es un bug.
--
--  La sección 6 es adversaria. Se pone del lado de dos personas distintas:
--  el de afuera que quiere publicar un aviso a nombre del club, y el de
--  ADENTRO que tiene acceso pero no a esto — Félix maneja salidas y no tiene
--  por qué poder cerrar la cancha. El segundo es el que se olvida.
--
--  Los nombres de acá son inventados salvo los de la comisión, que ya están
--  en `index.html` porque son quienes son. No hay ni un dato personal.
-- ============================================================

\set ON_ERROR_STOP on
\pset pager off

create temp table _r (ok boolean, que text);
create or replace function _ok(p boolean, q text) returns void
language sql as $$ insert into _r values (p, q) $$;

do $$
declare
  j json; k json; n int;
  lladmin text; llfelix text; llchelo text; llotro text;
  idav bigint; t0 timestamptz;
begin
  -- ---------- 0. terreno limpio ----------
  delete from avisos   where club in ('TEST-CLUB','OTRO-CLUB');
  delete from cancha   where club in ('TEST-CLUB','OTRO-CLUB');
  delete from comision where club in ('TEST-CLUB','OTRO-CLUB');

  -- ---------- 1. dar de alta a la comisión ----------
  j := comision_alta('TEST-CLUB','Mauro Domina','admin');   lladmin := j->>'llave';
  perform _ok((j->>'ok')::boolean and length(lladmin) = 64,
     'el alta devuelve una llave de 64, como la de la ronda');
  j := comision_alta('TEST-CLUB','Félix Córdoba','salidas'); llfelix := j->>'llave';
  j := comision_alta('TEST-CLUB','Chelo Caballero','avisos'); llchelo := j->>'llave';
  j := comision_alta('OTRO-CLUB','Alguien De Otro Club','admin'); llotro := j->>'llave';
  perform _ok(lladmin <> llfelix and llfelix <> llchelo, 'cada uno recibe una llave distinta');

  j := comision_alta('TEST-CLUB','Nadie','rolinventado');
  perform _ok(j->>'error' is not null, 'un rol que no existe no se da de alta');

  -- ---------- 2. entrar al panel ----------
  j := comision_entrar(llchelo);
  perform _ok((j->>'ok')::boolean and j->>'nombre' = 'Chelo Caballero', 'Chelo entra con su llave');
  perform _ok(j->>'rol' = 'avisos', 'y la app se entera de su rol');
  perform _ok((j->'permisos')::jsonb ? 'avisos' and (j->'permisos')::jsonb ? 'cancha',
     'EL SERVIDOR LE DICE QUÉ PUEDE HACER: avisos y cancha');
  perform _ok(not ((j->'permisos')::jsonb ? 'admin'),
     'y lo que no: dar permisos no está en su lista');
  perform _ok(j->>'llave' is null, 'entrar NO devuelve la llave de vuelta');

  j := comision_entrar('llaveinventadaquenoexisteenningunladoxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  perform _ok(j->>'error' is not null, 'una llave inventada no entra');
  j := comision_entrar('');
  perform _ok(j->>'error' is not null, 'una llave vacía tampoco');
  j := comision_entrar(null);
  perform _ok(j->>'error' is not null, 'ni una llave nula');

  -- ---------- 3. el estado de la cancha ----------
  j := club_estado('TEST-CLUB', null, false);
  perform _ok(j->>'cancha' is null, 'sin nadie que lo haya publicado, no se inventa un estado');

  j := cancha_poner(llchelo, false, 'Aireación de greens, miércoles y jueves');
  perform _ok((j->>'ok')::boolean, 'Chelo cierra la cancha');
  j := club_estado('TEST-CLUB', null, false);
  perform _ok((j->'cancha'->>'abierta')::boolean = false, 'y el socio la ve cerrada');
  perform _ok(j->'cancha'->>'nota' like 'Aireación%', 'con la aclaración que escribió');
  perform _ok(j->'cancha'->>'por' = 'Chelo', 'y firmada: el socio sabe quién lo dijo');
  perform _ok(j->'cancha'->>'desde' is not null, 'y desde cuándo');

  perform cancha_poner(llchelo, true, null);
  j := club_estado('TEST-CLUB', null, false);
  perform _ok((j->'cancha'->>'abierta')::boolean, 'y la vuelve a abrir: es un estado, no un historial');
  select count(*) into n from cancha where club = 'TEST-CLUB';
  perform _ok(n = 1, 'una sola fila por club, no una por cambio');

  -- ---------- 4. los avisos ----------
  j := aviso_poner(llchelo, '🌱', 'Cancha cerrada el jueves', 'Aireación de greens', false, 0);
  idav := (j->>'id')::bigint;
  perform _ok((j->>'ok')::boolean and idav is not null, 'Chelo publica un aviso');

  j := aviso_poner(llchelo, '💳', 'Cuota de noviembre', 'Vence el 10', true, 0);
  perform _ok((j->>'ok')::boolean, 'y otro, pero marcado solo para socios');

  j := club_estado('TEST-CLUB', null, true);
  perform _ok(json_array_length(j->'avisos') = 2, 'un socio ve los dos');
  j := club_estado('TEST-CLUB', null, false);
  perform _ok(json_array_length(j->'avisos') = 1,
     'y el que NO es socio ve sólo el público: lo de plata no sale');
  perform _ok(j->'avisos'->0->>'titulo' = 'Cancha cerrada el jueves', 'y es el que corresponde');
  perform _ok(j->'avisos'->0->>'por' = 'Chelo', 'firmado por quien lo puso');

  j := aviso_poner(llchelo, '📣', null, 'sin título', false, 0);
  perform _ok(j->>'error' is not null, 'un aviso sin título no se publica');

  -- ---------- 5. bajar un aviso, y que el borrado VIAJE ----------
  t0 := now();
  j := aviso_bajar(llchelo, idav);
  perform _ok((j->>'ok')::boolean, 'Chelo baja el aviso');
  select count(*) into n from avisos where id = idav;
  perform _ok(n = 1, 'LA FILA SIGUE EN LA BASE (no fue un delete)');

  j := club_estado('TEST-CLUB', null, true);
  perform _ok(json_array_length(j->'avisos') = 1, 'y en la primera carga ya no aparece');

  --  Pero al que pregunta "qué cambió desde hace un rato" SÍ tiene que
  --  llegarle, con su borrado_en, o lo muestra para siempre.
  j := club_estado('TEST-CLUB', t0 - interval '1 second', true);
  perform _ok(json_array_length(j->'avisos') >= 1
              and exists (select 1 from json_array_elements(j->'avisos') e
                          where (e->>'id')::bigint = idav and e->>'borrado_en' is not null),
     'EL BORRADO VIAJA: al que ya lo tenía le llega marcado, para que lo saque');

  j := aviso_bajar(llchelo, idav);
  perform _ok(j->>'error' is not null, 'bajar dos veces el mismo avisa que ya no está');

  -- ---------- 6. ADVERSARIO ----------
  --  El de afuera.
  j := cancha_poner('llaveinventadaquenoexisteenningunladoxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', false, 'jaja');
  perform _ok(j->>'error' is not null, 'ADVERSARIO · sin llave no se cierra la cancha');
  j := aviso_poner(null, '📣', 'El club cierra para siempre', null, false, 0);
  perform _ok(j->>'error' is not null, 'ADVERSARIO · ni se publica un aviso a nombre del club');
  j := cancha_poner('corta', false, null);
  perform _ok(j->>'error' is not null, 'ADVERSARIO · una llave corta tampoco');

  --  EL DE ADENTRO, que es el que se olvida: Félix tiene acceso al panel,
  --  pero su rol es salidas y resultados.
  j := cancha_poner(llfelix, false, 'cierro yo');
  perform _ok(j->>'error' is not null, 'ADVERSARIO · Félix NO puede cerrar la cancha: no es lo suyo');
  j := aviso_poner(llfelix, '📣', 'Aviso de Félix', null, false, 0);
  perform _ok(j->>'error' is not null, 'ADVERSARIO · ni publicar un aviso');
  j := aviso_bajar(llfelix, (select id from avisos where club='TEST-CLUB' and borrado_en is null limit 1));
  perform _ok(j->>'error' is not null, 'ADVERSARIO · ni bajar el aviso que puso otro');
  j := club_estado('TEST-CLUB', null, true);
  perform _ok((j->'cancha'->>'abierta')::boolean, 'y la cancha quedó como la dejó Chelo');

  --  El de otro club.
  j := aviso_poner(llotro, '📣', 'Aviso metido de otro club', null, false, 0);
  perform _ok((j->>'ok')::boolean, 'el de otro club sí publica… en SU club');
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(not exists (select 1 from json_array_elements(j->'avisos') e
                          where e->>'titulo' like '%otro club%'),
     'ADVERSARIO · pero ese aviso NO aparece en Trisquelia');
  j := aviso_bajar(llotro, (select id from avisos where club='TEST-CLUB' and borrado_en is null limit 1));
  perform _ok(j->>'error' is not null, 'ADVERSARIO · ni puede bajar un aviso de otro club');

  --  Una persona dada de baja deja de entrar en el acto.
  perform comision_baja('TEST-CLUB','Chelo Caballero');
  j := comision_entrar(llchelo);
  perform _ok(j->>'error' is not null, 'dada de baja, la llave de Chelo deja de servir');
  j := aviso_poner(llchelo, '📣', 'Todavía puedo?', null, false, 0);
  perform _ok(j->>'error' is not null, 'y no puede publicar nada más');

  -- ---------- 7. el tope de avisos ----------
  for n in 1..20 loop perform aviso_poner(lladmin, '📣', 'Aviso '||n, null, false, 0); end loop;
  j := aviso_poner(lladmin, '📣', 'Uno más', null, false, 0);
  perform _ok(j->>'error' is not null, 'veinte avisos en una hora y se corta: algo anda mal');

  -- ---------- 8. un aviso con vencimiento ----------
  delete from avisos where club = 'TEST-CLUB';
  perform aviso_poner(lladmin, '🏆', 'Torneo del sábado', 'Inscripción abierta', false, 7);
  update avisos set vence = now() - interval '1 day' where club = 'TEST-CLUB';
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(json_array_length(j->'avisos') = 0, 'un aviso vencido deja de mostrarse solo');

  -- ---------- 9. las llaves no salen nunca ----------
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(position(lladmin in j::text) = 0, 'LA LLAVE NO VIAJA en lo que ve el socio');
  j := comision_lista('TEST-CLUB');
  perform _ok(position(lladmin in j::text) = 0, 'ni en la lista de la comisión');
  perform _ok(j::text like '%Mauro Domina%', 'que sí trae los nombres y los roles');
end $$;

-- ---------- 10. los permisos, desde afuera ----------
do $$
declare n int;
begin
  perform _ok(has_function_privilege('anonymous','comision_entrar(text)','execute'),
     'anonymous puede entrar al panel con una llave');
  perform _ok(has_function_privilege('anonymous','club_estado(text,timestamptz,boolean)','execute'),
     'y leer lo que el club le dice a los socios');
  perform _ok(has_function_privilege('anonymous','cancha_poner(text,boolean,text)','execute'),
     'y llamar a publicar la cancha (adentro se le pide la llave)');

  perform _ok(not has_function_privilege('anonymous','comision_alta(text,text,text)','execute'),
     'anonymous NO puede darse de alta en la comisión');
  perform _ok(not has_function_privilege('anonymous','comision_baja(text,text)','execute'),
     'ni dar de baja a nadie');
  perform _ok(not has_function_privilege('anonymous','comision_lista(text)','execute'),
     'ni listar quién tiene acceso');
  perform _ok(not has_function_privilege('anonymous','comision_quien(text,text)','execute'),
     'ni preguntar por la puerta directamente');
  perform _ok(not has_function_privilege('anonymous','roles_srv()','execute'),
     'ni leer la tabla de roles del servidor');

  select count(*) into n from pg_tables
   where tablename in ('comision','cancha','avisos') and rowsecurity;
  perform _ok(n = 3, 'las tres tablas con RLS prendida');
  select count(*) into n from pg_policies where tablename in ('comision','cancha','avisos');
  perform _ok(n = 0, 'y sin políticas: todo bloqueado');
  select count(*) into n from information_schema.table_privileges
   where table_name in ('comision','cancha','avisos') and grantee in ('anonymous','authenticated');
  perform _ok(n = 0, 'anonymous no tiene ningún permiso sobre las tablas (ahí viven las llaves)');
end $$;

\pset tuples_only on
\pset format unaligned
\echo ''
select case when ok then '  ✓ ' else '  ✗ ' end || que from _r;
\echo ''
select count(*) filter (where ok) || ' de ' || count(*) || ' en verde'
       || case when count(*) filter (where not ok) > 0
               then '   ← ' || count(*) filter (where not ok) || ' EN ROJO' else '' end from _r;
\echo ''
