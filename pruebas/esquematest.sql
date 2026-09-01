-- ============================================================
--  PRUEBAS DEL ESQUEMA · borrado lógico e identidad
-- ============================================================
--  Cómo correrlo, contra un Postgres vacío:
--
--    createdb t && psql -d t -c 'create role anon' -c 'create role authenticated'
--    psql -d t -f esquema.sql
--    psql -d t -f esquema.sql          -- otra vez: tiene que ser idempotente
--    psql -d t -f pruebas/esquematest.sql
--
--  Da una línea por comprobación y un resumen al final. Cualquier ✗ es un bug.
--
--  La sección 10 es adversaria: se pone del lado del que tiene el código de
--  seis letras y quiere romper la ronda de otro. Ese código se dicta en voz
--  alta y se manda por WhatsApp, así que hay que asumir que lo tiene cualquiera.
-- ============================================================

\set ON_ERROR_STOP on
\pset pager off

create temp table _r (ok boolean, que text);
create or replace function _ok(p boolean, q text) returns void
language sql as $$ insert into _r values (p, q) $$;

do $$
declare j json; n int; v int; ka text; kb text; kx text;
begin
  -- ---------- 0. terreno limpio ----------
  delete from rondas where codigo in ('TEST01','TEST02','VIEJA1');

  -- ---------- 1. una ronda normal sigue andando ----------
  j  := ronda_abrir('TEST01','Trisquelia','9 hoyos',18,true,'ja','Mauro','MD',7.4,7,'mixta');
  ka := j->>'llave';
  perform _ok(j->'ronda'->>'codigo' = 'TEST01', 'se abre una ronda');
  perform _ok((j->>'borrada')::boolean = false, 'una ronda nueva no viene marcada como borrada');
  perform _ok(ka is not null and length(ka) = 64, 'el que abre recibe su llave');

  j  := ronda_unirse('TEST01','jb','Félix','FC',12.0,12,'mixta');
  kb := j->>'llave';
  perform _ok(json_array_length(j->'jugadores') = 2, 'se suma el segundo jugador');
  perform _ok(kb is not null and kb <> ka, 'y recibe una llave distinta de la del primero');

  perform anotar('TEST01',ka,'ja','ja',1,4,2,0,0,'fw');
  perform anotar('TEST01',ka,'ja','jb',1,5,2,0,0,'fw');   -- el marcador anota la de otro
  j := ronda_estado('TEST01', null);
  perform _ok(json_array_length(j->'anotaciones') = 2, 'entran las dos anotaciones del cruce');

  -- ---------- 2. borrar es lógico, no destructivo ----------
  j := borrar_ronda('TEST01');
  perform _ok((j->>'ok')::boolean, 'borrar_ronda contesta ok');
  perform _ok((j->>'anotaciones')::int = 2, 'borra las dos anotaciones');
  perform _ok((j->>'jugadores')::int = 2, 'borra los dos jugadores');

  select count(*) into n from rondas where codigo = 'TEST01';
  perform _ok(n = 1, 'LA FILA SIGUE EN LA BASE (no fue un delete)');
  select count(*) into n from anotaciones where ronda = 'TEST01';
  perform _ok(n = 2, 'las anotaciones siguen en la base');

  j := ronda_estado('TEST01', null);
  perform _ok((j->>'ronda') is null, 'la ronda borrada ya no se devuelve');
  perform _ok((j->>'borrada')::boolean, 'y el teléfono se entera: borrada = true');
  perform _ok(json_array_length(j->'jugadores') = 0, 'no vuelven los jugadores');

  -- ---------- 3. el borrado viaja como cambio ----------
  j := ronda_estado('TEST01', now() - interval '1 minute');
  perform _ok(json_array_length(j->'anotaciones') = 2,
              'en el delta viajan las anotaciones borradas (lápidas)');
  perform _ok((j->'anotaciones'->0->>'borrado_en') is not null,
              'y vienen con borrado_en, para que el teléfono las saque');

  -- ---------- 4. nadie escribe en una ronda borrada ----------
  j := anotar('TEST01',ka,'ja','ja',2,4,2,0,0,'fw');
  perform _ok(j->>'error' is not null, 'anotar rebota en una ronda borrada');
  j := ronda_unirse('TEST01','jc','Otro','OT',20,20,'mixta');
  perform _ok(j->>'error' is not null, 'no se puede entrar a una ronda borrada');
  j := ronda_abrir('TEST01','Trisquelia','9 hoyos',18,true,'jd','X','XX',10,10,'mixta');
  perform _ok(j->>'error' = 'ese código está ocupado',
              'no se resucita una ronda borrada reusando el código');

  -- ---------- 5. volver atrás ----------
  j := restaurar_ronda('TEST01');
  perform _ok((j->>'ok')::boolean, 'restaurar_ronda contesta ok');
  j := ronda_estado('TEST01', null);
  perform _ok(j->'ronda'->>'codigo' = 'TEST01', 'la ronda vuelve');
  perform _ok(json_array_length(j->'jugadores') = 2, 'vuelven los dos jugadores');
  perform _ok(json_array_length(j->'anotaciones') = 2, 'vuelven las dos anotaciones');
  j := restaurar_ronda('TEST01');
  perform _ok(j->>'error' is not null, 'restaurar una ronda viva avisa que no está borrada');

  -- ---------- 6. la limpieza de los 30 días no destruye ----------
  perform ronda_abrir('VIEJA1','Trisquelia','9 hoyos',18,false,'jv','V','VV',10,10,'mixta');
  update rondas set creada = now() - interval '40 days' where codigo = 'VIEJA1';
  n := limpiar_rondas_viejas();
  perform _ok(n >= 1, 'limpiar_rondas_viejas marca la ronda de 40 días');
  select count(*) into v from rondas where codigo = 'VIEJA1';
  perform _ok(v = 1, 'PERO NO LA BORRA: la fila sigue');
  select count(*) into v from rondas where codigo = 'TEST01' and borrado_en is null;
  perform _ok(v = 1, 'y no se lleva puesta una ronda de hoy');

  -- ---------- 7. la purga sí destruye, con meses de gracia ----------
  n := purgar_borradas(90);
  select count(*) into v from rondas where codigo = 'VIEJA1';
  perform _ok(v = 1, 'purgar_borradas(90) NO toca lo que se borró recién');
  update rondas set borrado_en = now() - interval '200 days' where codigo = 'VIEJA1';
  n := purgar_borradas(90);
  select count(*) into v from rondas where codigo = 'VIEJA1';
  perform _ok(v = 0, 'lo borrado hace 200 días sí desaparece de verdad');

  -- ---------- 8. los permisos ----------
  perform _ok(has_function_privilege('anon','anotar(text,text,text,text,int,int,int,int,int,text)','execute'),
              'anon puede anotar');
  perform _ok(not has_function_privilege('anon','borrar_ronda(text)','execute'),
              'anon NO puede borrar rondas');
  perform _ok(not has_function_privilege('anon','purgar_borradas(int)','execute'),
              'anon NO puede purgar');
  perform _ok(not has_function_privilege('public','purgar_borradas(int)','execute'),
              'public tampoco puede purgar (la trampa de Postgres)');
  perform _ok(not has_function_privilege('anon','llave_nueva()','execute'),
              'anon NO puede fabricarse una llave');
  perform _ok(not has_function_privilege('anon','entrar_jugador(text,text,text,text,numeric,int,text,text)','execute'),
              'anon NO puede llamar al alta de jugador por atrás');
  perform _ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public' and p.proname='anotar'
                  and pg_get_function_identity_arguments(p.oid)
                      = 'text, text, text, integer, integer, integer, integer, integer, text'),
              'la firma vieja de anotar(), sin llave, ya no existe');

  -- ---------- 9. las tablas siguen cerradas con llave ----------
  perform _ok((select relrowsecurity from pg_class where relname='rondas'),
              'rondas sigue con row level security');
  perform _ok(not has_table_privilege('anon','anotaciones','select'),
              'anon no puede leer anotaciones directo');

  -- ---------- 10. ADVERSARIO: tengo el código, ¿qué puedo hacer? ----------
  --  El atacante escuchó "TEST01" y llama a ronda_estado, que es su derecho:
  --  necesita poder entrar. Lo que NO puede es ser otro.
  j := ronda_estado('TEST01', null);
  perform _ok((j->'jugadores'->0->>'llave') is null,
              'ADVERSARIO · ronda_estado NO reparte las llaves de los demás');
  perform _ok(j->'jugadores'->0->>'id' is not null,
              '(el id sí se ve: hace falta para el cruce)');

  perform _ok((anotar('TEST01','llave-inventada','ja','ja',3,9,0,0,0,'fw'))->>'error' = 'no sos vos',
              'ADVERSARIO · no puede anotar con una llave inventada');
  perform _ok((anotar('TEST01',null,'ja','ja',3,9,0,0,0,'fw'))->>'error' = 'no sos vos',
              'ADVERSARIO · ni sin llave');
  perform _ok((anotar('TEST01',kb,'ja','ja',3,9,0,0,0,'fw'))->>'error' = 'no sos vos',
              'ADVERSARIO · ni con la llave de OTRO jugador de la ronda');
  select golpes into v from anotaciones where ronda='TEST01' and de='ja' and por='ja' and hoyo=1;
  perform _ok(v = 4, 'y el score que había sigue intacto');

  --  Suplantación: pisarle el nombre y el handicap a alguien que ya está.
  j := ronda_unirse('TEST01','ja','NO SOY YO','ZZ',54,54,'negras');
  perform _ok(j->>'error' is not null,
              'ADVERSARIO · no puede reescribir a un jugador que ya tiene llave');
  perform _ok((select nombre from jugadores where id='ja') = 'Mauro',
              'el nombre del jugador quedó como estaba');
  perform _ok((select index_hcp from jugadores where id='ja') = 7.4,
              'y su handicap también');
  --  Y tampoco por la puerta de ronda_abrir con un código propio.
  j := ronda_abrir('TEST02','Trisquelia','9 hoyos',18,true,'ja','NO SOY YO','ZZ',54,54,'negras');
  perform _ok(j->>'error' is not null, 'ADVERSARIO · ni entrando por ronda_abrir con otro código');
  perform _ok((select index_hcp from jugadores where id='ja') = 7.4, 'el handicap sigue intacto');

  --  Cerrar la ronda de otro era gratis.
  perform _ok((ronda_cerrar('TEST01','llave-inventada'))->>'error' is not null,
              'ADVERSARIO · no puede cerrarle la ronda al grupo');
  perform _ok((select not cerrada from rondas where codigo='TEST01'), 'la ronda sigue abierta');

  --  Marcar por otro.
  perform _ok((marcar_a('TEST01','llave-inventada','ja','jb'))->>'error' is not null,
              'ADVERSARIO · no puede decidir a quién marca otro');

  --  Inventar jugadores fantasma para llenar la tabla.
  perform _ok((anotar('TEST01',ka,'ja','fantasma-1',5,4,0,0,0,'fw'))->>'error' is not null,
              'ADVERSARIO · no puede anotarle a un jugador que no existe');

  --  Textos gigantes.
  j := ronda_unirse('TEST01','jz', repeat('A',5000), repeat('B',900), 10,10, repeat('C',900));
  perform _ok(length((select nombre from jugadores where id='jz')) = 40,
              'ADVERSARIO · un nombre de 5.000 caracteres se recorta a 40');
  perform _ok(length((select iniciales from jugadores where id='jz')) = 4, 'y las iniciales a 4');

  --  Inflar la ronda con jugadores infinitos.
  for n in 1..12 loop
    perform ronda_unirse('TEST01','flood'||n,'F','F',10,10,'mixta');
  end loop;
  select count(*) into v from jugadores where ronda='TEST01' and borrado_en is null;
  perform _ok(v <= 8, 'ADVERSARIO · la ronda no pasa de 8 jugadores (quedó en '||v||')');

  --  El dueño de la llave sí puede todo lo suyo.
  perform _ok((anotar('TEST01',ka,'ja','ja',6,5,2,0,0,'fw'))->>'ok' is not null,
              'y el dueño de la llave anota normalmente');
  perform _ok((marcar_a('TEST01',ka,'ja','jb'))->>'ok' is not null, 'y elige a quién marca');
  perform _ok((ronda_cerrar('TEST01',ka))->>'ok' is not null, 'y puede cerrar su ronda');
  perform _ok((anotar('TEST01',ka,'ja','ja',7,5,2,0,0,'fw'))->>'error' is not null,
              'con la ronda cerrada ya no se anota, ni siendo del grupo');

  --  Volver a entrar con la llave propia (recarga del teléfono) sigue andando.
  j := ronda_unirse('TEST02','jn','Nuevo','NN',10,10,'mixta');
  kx := j->>'llave';
  j := ronda_unirse('TEST02','jn','Nuevo','NN',10,10,'damas', kx);
  perform _ok(j->>'error' is null and j->>'llave' = kx,
              'el mismo teléfono vuelve a entrar con su llave y la conserva');

  delete from rondas where codigo in ('TEST01','TEST02','VIEJA1');
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
