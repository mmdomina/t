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
--  LA SECCIÓN 6 ES LA QUE JUSTIFICA EL DISEÑO. La llave es del PUESTO, no de
--  la persona, y ahí se comprueba lo que eso compra: cuando el profesional de
--  la cancha deja el club y entra otro, la llave sigue sirviendo, los permisos
--  no se tocan, los avisos que publicó siguen firmados con su nombre, y lo
--  único que cambia es quién firma de ahí en adelante.
--
--  La sección 7 es adversaria, y se pone del lado de dos personas distintas:
--  el de afuera que quiere publicar un aviso a nombre del club, y el de
--  ADENTRO que tiene acceso pero no a esto — el profesional maneja salidas y
--  no tiene por qué poder cerrar la cancha. El segundo es el que se olvida.
--
--  Los nombres de persona de acá son inventados. No hay ni un dato real.
-- ============================================================

\set ON_ERROR_STOP on
\pset pager off

create temp table _r (ok boolean, que text);
create or replace function _ok(p boolean, q text) returns void
language sql as $$ insert into _r values (p, q) $$;

do $$
declare
  j json; k json; n int;
  lladmin text; llpro text; llcd text; llotro text; llnueva text;
  idav bigint; t0 timestamptz; v_por text;
begin
  -- ---------- 0. terreno limpio ----------
  delete from avisos   where club in ('TEST-CLUB','OTRO-CLUB');
  delete from cancha   where club in ('TEST-CLUB','OTRO-CLUB');
  delete from comision where club in ('TEST-CLUB','OTRO-CLUB');

  -- ---------- 1. crear los puestos ----------
  j := comision_alta('TEST-CLUB','Administración','admin','Ana Prueba');
  lladmin := j->>'llave';
  perform _ok((j->>'ok')::boolean and length(lladmin) = 64,
     'el alta devuelve una llave de 64, como la de la ronda');
  perform _ok(j->>'puesto' = 'Administración', 'y la fila es el PUESTO, no la persona');

  j := comision_alta('TEST-CLUB','Profesional de la cancha','salidas','Pablo Primero');
  llpro := j->>'llave';
  j := comision_alta('TEST-CLUB','Comisión Directiva','avisos','Carla Segunda');
  llcd := j->>'llave';
  j := comision_alta('OTRO-CLUB','Administración','admin','Otro Club');
  llotro := j->>'llave';
  perform _ok(lladmin <> llpro and llpro <> llcd, 'cada puesto recibe una llave distinta');

  j := comision_alta('TEST-CLUB','Puesto Raro','rolinventado', null);
  perform _ok(j->>'error' is not null, 'un rol que no existe no se da de alta');
  j := comision_alta('TEST-CLUB', null, 'admin', null);
  perform _ok(j->>'error' is not null, 'un puesto sin nombre tampoco');
  j := comision_alta('TEST-CLUB','Comisión Directiva','avisos','Otra Persona');
  perform _ok(j->>'error' is not null,
     'UN PUESTO, UNA LLAVE VIVA: no se puede duplicar sin dar de baja la anterior');

  -- ---------- 2. entrar al panel ----------
  j := comision_entrar(llcd);
  perform _ok((j->>'ok')::boolean and j->>'puesto' = 'Comisión Directiva',
     'la llave abre el puesto');
  perform _ok(j->>'persona' = 'Carla Segunda', 'y dice quién lo ocupa hoy');
  perform _ok(j->>'rol' = 'avisos', 'con su rol');
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

  j := cancha_poner(llcd, false, 'Aireación de greens, miércoles y jueves');
  perform _ok((j->>'ok')::boolean, 'la Comisión Directiva cierra la cancha');
  j := club_estado('TEST-CLUB', null, false);
  perform _ok((j->'cancha'->>'abierta')::boolean = false, 'y el socio la ve cerrada');
  perform _ok(j->'cancha'->>'nota' like 'Aireación%', 'con la aclaración que escribió');
  perform _ok(j->'cancha'->>'por' = 'Carla',
     'Y FIRMADA CON LA PERSONA, no con el puesto: "lo dijo Carla" pesa más');
  perform _ok(j->'cancha'->>'desde' is not null, 'y desde cuándo');

  perform cancha_poner(llcd, true, null);
  j := club_estado('TEST-CLUB', null, false);
  perform _ok((j->'cancha'->>'abierta')::boolean, 'y la vuelve a abrir: es un estado, no un historial');
  select count(*) into n from cancha where club = 'TEST-CLUB';
  perform _ok(n = 1, 'una sola fila por club, no una por cambio');

  -- ---------- 4. los avisos ----------
  j := aviso_poner(llcd, '🌱', 'Cancha cerrada el jueves', 'Aireación de greens', false, 0);
  idav := (j->>'id')::bigint;
  perform _ok((j->>'ok')::boolean and idav is not null, 'publica un aviso');

  j := aviso_poner(llcd, '💳', 'Cuota de noviembre', 'Vence el 10', true, 0);
  perform _ok((j->>'ok')::boolean, 'y otro, pero marcado solo para socios');

  j := club_estado('TEST-CLUB', null, true);
  perform _ok(json_array_length(j->'avisos') = 2, 'un socio ve los dos');
  j := club_estado('TEST-CLUB', null, false);
  perform _ok(json_array_length(j->'avisos') = 1,
     'y el que NO es socio ve sólo el público: lo de plata no sale');
  --  Pero que quede escrito qué NO protege: el "soy socio" lo manda el
  --  teléfono, y un teléfono miente. Cualquiera pide el token anónimo y
  --  llama con `p_socio => true`. Lo encontró un ataque dirigido el
  --  23/10/2026 y no se puede cerrar hasta que los socios tengan cuenta.
  --  Esta comprobación está acá para que nadie crea que es un secreto:
  --  el día que SÍ haga falta llave, se pone en rojo sola y hay que
  --  cambiarla a propósito.
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(json_array_length(j->'avisos') = 2,
     'OJO · pidiendo "soy socio" los ve cualquiera: el marcador filtra, no protege');
  perform _ok(j->'avisos'->0->>'titulo' = 'Cancha cerrada el jueves', 'y es el que corresponde');
  perform _ok(j->'avisos'->0->>'por' = 'Carla', 'firmado por quien lo puso');

  j := aviso_poner(llcd, '📣', null, 'sin título', false, 0);
  perform _ok(j->>'error' is not null, 'un aviso sin título no se publica');

  -- ---------- 5. bajar un aviso, y que el borrado VIAJE ----------
  t0 := now();
  j := aviso_bajar(llcd, idav);
  perform _ok((j->>'ok')::boolean, 'baja el aviso');
  select count(*) into n from avisos where id = idav;
  perform _ok(n = 1, 'LA FILA SIGUE EN LA BASE (no fue un delete)');

  j := club_estado('TEST-CLUB', null, true);
  perform _ok(json_array_length(j->'avisos') = 1, 'y en la primera carga ya no aparece');

  j := club_estado('TEST-CLUB', t0 - interval '1 second', true);
  perform _ok(exists (select 1 from json_array_elements(j->'avisos') e
                      where (e->>'id')::bigint = idav and e->>'borrado_en' is not null),
     'EL BORRADO VIAJA: al que ya lo tenía le llega marcado, para que lo saque');

  j := aviso_bajar(llcd, idav);
  perform _ok(j->>'error' is not null, 'bajar dos veces el mismo avisa que ya no está');

  -- ---------- 6. SE VA UNA PERSONA Y EL PUESTO SIGUE ----------
  --  Esto es lo que compra haber atado la llave al puesto. Es la sección
  --  que hay que leer si alguien propone volver a atarla a la persona.
  --  Se hace sobre la Comisión Directiva porque es el puesto que publica
  --  avisos; el profesional tiene otro rol y eso se prueba más abajo.
  perform aviso_poner(llcd, '📣', 'Primer aviso de Carla', null, false, 0);
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(exists (select 1 from json_array_elements(j->'avisos') e
                      where e->>'titulo' = 'Primer aviso de Carla' and e->>'por' = 'Carla'),
     'la Directiva publica, y firma Carla');

  --  Carla deja el puesto. Entra Diego.
  j := comision_persona('TEST-CLUB','Comisión Directiva','Diego Cuarto');
  perform _ok((j->>'ok')::boolean, 'cambia quién ocupa el puesto, en un renglón');

  j := comision_entrar(llcd);
  perform _ok((j->>'ok')::boolean, 'LA MISMA LLAVE SIGUE SIRVIENDO: no hay que rehacer nada');
  perform _ok(j->>'persona' = 'Diego Cuarto', 'y ahora dice que el puesto lo ocupa Diego');
  perform _ok(j->>'rol' = 'avisos' and (j->'permisos')::jsonb ? 'avisos',
     'con los mismos permisos de siempre, porque son del puesto');

  perform aviso_poner(llcd, '📣', 'Primer aviso de Diego', null, false, 0);
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(exists (select 1 from json_array_elements(j->'avisos') e
                      where e->>'titulo' = 'Primer aviso de Diego' and e->>'por' = 'Diego'),
     'lo nuevo lo firma Diego');
  perform _ok(exists (select 1 from json_array_elements(j->'avisos') e
                      where e->>'titulo' = 'Primer aviso de Carla' and e->>'por' = 'Carla'),
     'Y LO QUE PUBLICÓ CARLA SIGUE FIRMADO POR CARLA: no se reescribe la historia');

  --  Un puesto vacante firma con el puesto, nunca vacío.
  perform comision_persona('TEST-CLUB','Comisión Directiva', null);
  perform aviso_poner(llcd, '📣', 'Aviso sin titular', null, false, 0);
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(exists (select 1 from json_array_elements(j->'avisos') e
                      where e->>'titulo' = 'Aviso sin titular'
                        and e->>'por' = 'Comisión Directiva'),
     'con el puesto vacante, firma el puesto: un aviso nunca sale sin firma');
  perform comision_persona('TEST-CLUB','Comisión Directiva','Carla Segunda');

  --  Renombrar el puesto.
  j := comision_puesto('TEST-CLUB','Comisión Directiva','Comisión Directiva (avisos)');
  perform _ok((j->>'ok')::boolean, 'un puesto se puede renombrar');
  j := comision_entrar(llcd);
  perform _ok(j->>'puesto' = 'Comisión Directiva (avisos)' and (j->>'ok')::boolean,
     'y la llave sigue valiendo después de renombrarlo');
  perform comision_puesto('TEST-CLUB','Comisión Directiva (avisos)','Comisión Directiva');

  --  Rotar la llave de un puesto: la vieja muere, la nueva sirve.
  perform comision_baja('TEST-CLUB','Profesional de la cancha');
  j := comision_entrar(llpro);
  perform _ok(j->>'error' is not null, 'dado de baja el puesto, la llave vieja deja de servir');
  j := comision_alta('TEST-CLUB','Profesional de la cancha','salidas','Paula Tercera');
  llnueva := j->>'llave';
  perform _ok((j->>'ok')::boolean and llnueva <> llpro, 'y el alta nueva da otra llave');
  j := comision_entrar(llnueva);
  perform _ok((j->>'ok')::boolean and j->>'persona' = 'Paula Tercera', 'que sí sirve');
  llpro := llnueva;

  -- ---------- 7. ADVERSARIO ----------
  j := cancha_poner('llaveinventadaquenoexisteenningunladoxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', false, 'jaja');
  perform _ok(j->>'error' is not null, 'ADVERSARIO · sin llave no se cierra la cancha');
  j := aviso_poner(null, '📣', 'El club cierra para siempre', null, false, 0);
  perform _ok(j->>'error' is not null, 'ADVERSARIO · ni se publica un aviso a nombre del club');
  j := cancha_poner('corta', false, null);
  perform _ok(j->>'error' is not null, 'ADVERSARIO · una llave corta tampoco');

  --  EL DE ADENTRO, que es el que se olvida.
  j := cancha_poner(llpro, false, 'cierro yo');
  perform _ok(j->>'error' is not null,
     'ADVERSARIO · el profesional NO puede cerrar la cancha: no es lo suyo');
  j := aviso_poner(llpro, '📣', 'Aviso del profesional', null, false, 0);
  perform _ok(j->>'error' is not null, 'ADVERSARIO · ni publicar un aviso');
  j := aviso_bajar(llpro, (select id from avisos where club='TEST-CLUB' and borrado_en is null limit 1));
  perform _ok(j->>'error' is not null, 'ADVERSARIO · ni bajar el aviso que puso otro');
  j := club_estado('TEST-CLUB', null, true);
  perform _ok((j->'cancha'->>'abierta')::boolean, 'y la cancha quedó como la dejó la Directiva');

  --  El de otro club.
  j := aviso_poner(llotro, '📣', 'Aviso metido de otro club', null, false, 0);
  perform _ok((j->>'ok')::boolean, 'el de otro club sí publica… en SU club');
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(not exists (select 1 from json_array_elements(j->'avisos') e
                          where e->>'titulo' like '%otro club%'),
     'ADVERSARIO · pero ese aviso NO aparece en el nuestro');
  j := aviso_bajar(llotro, (select id from avisos where club='TEST-CLUB' and borrado_en is null limit 1));
  perform _ok(j->>'error' is not null, 'ADVERSARIO · ni puede bajar un aviso de otro club');

  -- ---------- 8. el tope de avisos ----------
  for n in 1..20 loop perform aviso_poner(lladmin, '📣', 'Aviso '||n, null, false, 0); end loop;
  j := aviso_poner(lladmin, '📣', 'Uno más', null, false, 0);
  perform _ok(j->>'error' is not null, 'veinte avisos en una hora y se corta: algo anda mal');

  -- ---------- 9. un aviso con vencimiento ----------
  delete from avisos where club = 'TEST-CLUB';
  perform aviso_poner(lladmin, '🏆', 'Torneo del sábado', 'Inscripción abierta', false, 7);
  update avisos set vence = now() - interval '1 day' where club = 'TEST-CLUB';
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(json_array_length(j->'avisos') = 0, 'un aviso vencido deja de mostrarse solo');

  -- ---------- 10. las llaves no salen nunca ----------
  j := club_estado('TEST-CLUB', null, true);
  perform _ok(position(lladmin in j::text) = 0, 'LA LLAVE NO VIAJA en lo que ve el socio');
  j := comision_lista('TEST-CLUB');
  perform _ok(position(lladmin in j::text) = 0, 'ni en la lista de la comisión');
  perform _ok(j::text like '%Profesional de la cancha%', 'que sí trae los puestos y los roles');
end $$;

-- ---------- 11. los permisos, desde afuera ----------
do $$
declare n int;
begin
  perform _ok(has_function_privilege('anonymous','comision_entrar(text)','execute'),
     'anonymous puede entrar al panel con una llave');
  perform _ok(has_function_privilege('anonymous','club_estado(text,timestamptz,boolean)','execute'),
     'y leer lo que el club le dice a los socios');
  perform _ok(has_function_privilege('anonymous','cancha_poner(text,boolean,text)','execute'),
     'y llamar a publicar la cancha (adentro se le pide la llave)');

  perform _ok(not has_function_privilege('anonymous','comision_alta(text,text,text,text)','execute'),
     'anonymous NO puede crear un puesto');
  perform _ok(not has_function_privilege('anonymous','comision_baja(text,text)','execute'),
     'ni dar de baja uno');
  perform _ok(not has_function_privilege('anonymous','comision_persona(text,text,text)','execute'),
     'ni cambiar quién ocupa un puesto');
  perform _ok(not has_function_privilege('anonymous','comision_puesto(text,text,text)','execute'),
     'ni renombrarlo');
  perform _ok(not has_function_privilege('anonymous','comision_lista(text)','execute'),
     'ni listar quién tiene acceso');
  perform _ok(not has_function_privilege('anonymous','comision_quien(text,text)','execute'),
     'ni preguntar por la puerta directamente');
  perform _ok(not has_function_privilege('anonymous','roles_srv()','execute'),
     'ni leer la tabla de roles del servidor');
  perform _ok(not has_function_privilege('anonymous','firma_de(text,text)','execute'),
     'ni usar los ayudantes');

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
