-- ============================================================
--  PRUEBAS DEL ALTA DE SOCIOS · padron.sql
-- ============================================================
--  Cómo correrlo, contra un Postgres vacío:
--
--    createdb t
--    psql -d t -f esquema.sql
--    psql -d t -f padron.sql
--    psql -d t -f padron.sql           -- otra vez: tiene que ser idempotente
--    psql -d t -f pruebas/altatest.sql
--
--  Da una línea por comprobación y un resumen al final. Cualquier ✗ es un bug.
--
--  LOS DATOS DE ACÁ SON INVENTADOS. DNI que empiezan en 70000 (rango que no
--  existe), apellidos comunes y direcciones en `ejemplo.test`, que es un
--  dominio reservado justamente para esto y no puede ser de nadie. En este
--  repositorio no entra ni un dato de una persona real, tampoco de prueba.
--
--  La sección 7 es adversaria: se pone del lado del que quiere la lista de
--  socios del club, o quiere entrar siendo otro. Es la razón de ser del
--  archivo entero — un alta que se pueda barrer le entrega el padrón a
--  cualquiera, y son 123 personas con nombre, DNI y mail.
-- ============================================================

\set ON_ERROR_STOP on
\pset pager off

create temp table _r (ok boolean, que text);
create or replace function _ok(p boolean, q text) returns void
language sql as $$ insert into _r values (p, q) $$;

do $$
declare
  j json; k json; n int;
  v_cod text; v_tk text; v_ll text; v_ll2 text; v_h text;
  t0 timestamptz; t_hay numeric; t_no numeric;
begin
  -- ---------- 0. terreno limpio ----------
  delete from cuentas where dni like '70000%';
  delete from codigos where dni like '70000%';
  delete from padron  where dni like '70000%';
  delete from pedidos;

  -- ---------- 1. cargar el padrón ----------
  perform padron_cargar('70000001','Pérez','Juan','juanperez@ejemplo.test',null,false,'#11');
  perform padron_cargar('70000002','Gómez','Ana', null,'2302400001',false,'#12');
  perform padron_cargar('70000003','Sosa','Luis', null,'400002',true,'#13');
  perform padron_cargar('70000004','Díaz','Eva','eva@ejemplo.test',null,false,'#14');
  select count(*) into n from padron where dni like '70000%';
  perform _ok(n = 4, 'se cargan los cuatro socios de prueba');

  --  Volver a cargar el mismo padrón es lo normal: el club manda la lista
  --  actualizada y se pisa. No puede duplicar ni romper nada.
  perform padron_cargar('70000001','Pérez','Juan Carlos','juanperez@ejemplo.test',null,false,'#11');
  select count(*) into n from padron where dni like '70000%';
  perform _ok(n = 4, 'recargar el padrón pisa, no duplica');
  select nombres into v_h from padron where dni = '70000001';
  perform _ok(v_h = 'Juan Carlos', 'y actualiza el dato que cambió');

  j := padron_cargar('123','X','Y',null,null,false,null);
  perform _ok(j->>'error' is not null, 'un DNI corto no entra al padrón');

  --  El mail se guarda en minúsculas: si no, el mismo socio con MAYÚSCULAS
  --  parece otro y el día que se entre por mail no lo encuentra.
  perform padron_cargar('70000004','Díaz','Eva','EVA@Ejemplo.Test',null,false,'#14');
  select mail into v_h from padron where dni = '70000004';
  perform _ok(v_h = 'eva@ejemplo.test', 'el mail se guarda en minúsculas');

  -- ---------- 2. los cuatro estados que la app sabe dibujar ----------
  delete from pedidos;
  j := codigo_pedir('70000001');
  perform _ok(j->>'estado' = 'codigo', 'un socio con mail recibe código');
  v_cod := j->>'codigo';
  perform _ok(v_cod ~ '^[0-9]{6}$', 'el código son seis dígitos');

  j := codigo_pedir('70000002');
  perform _ok(j->>'estado' = 'codigo', 'un socio con teléfono bueno también');

  j := codigo_pedir('70000003');
  perform _ok(j->>'estado' = 'sincontacto',
     'un socio cuyo teléfono es dudoso cae en sincontacto, no se le manda nada');

  j := codigo_pedir('79999999');
  perform _ok(j->>'estado' = 'nopadron', 'un DNI que no está en el padrón: nopadron');

  j := codigo_pedir('  70.000.001  ');
  perform _ok(j->>'estado' <> 'nopadron', 'el DNI se limpia de puntos y espacios');

  -- ---------- 3. el mail nunca sale entero ----------
  delete from pedidos;
  j := codigo_pedir('70000001');
  perform _ok(position('juanperez' in (j->>'pista')) = 0,
     'LA PISTA NO TRAE LA CASILLA ENTERA');
  perform _ok(j->>'pista' like 'j%z@ejemplo.test',
     'pero sí la primera letra, la última y el dominio: ' || (j->>'pista'));

  j := codigo_pedir('70000002');
  perform _ok(position('2302400001' in (j->>'pista')) = 0, 'el teléfono tampoco sale entero');
  perform _ok(j->>'pista' like '%0001', 'sí los últimos cuatro: ' || (j->>'pista'));

  -- ---------- 4. el código ----------
  delete from pedidos;
  j := codigo_pedir('70000001');
  v_cod := j->>'codigo';
  select hash into v_h from codigos where dni = '70000001';
  perform _ok(v_h <> v_cod and v_h like '$2%',
     'EL CÓDIGO NO SE GUARDA: en la base hay un hash bcrypt, no los seis dígitos');
  perform _ok(v_h <> crypt('000000', v_h) or v_cod = '000000', 'y el hash no vale para cualquier código');

  select vence_en into t0 from codigos where dni = '70000001';
  perform _ok(t0 > now() + interval '9 minutes' and t0 < now() + interval '11 minutes',
     'el código vence a los diez minutos');

  j := codigo_verificar('70000001','000000');
  perform _ok(j->>'error' is not null, 'un código equivocado no pasa');
  select intentos into n from codigos where dni = '70000001';
  perform _ok(n = 1, 'y queda contado el intento');

  j := codigo_verificar('70000001', v_cod);
  perform _ok((j->>'ok')::boolean, 'el código bueno pasa');
  v_tk := j->>'ticket';
  perform _ok(length(v_tk) = 32, 'y devuelve un ticket, no el nombre del socio');
  perform _ok(j->>'nombre' is null and j->>'mail' is null,
     'verificar NO devuelve ningún dato del socio todavía');

  j := codigo_verificar('70000001', v_cod);
  perform _ok(j->>'error' is not null, 'EL CÓDIGO MUERE AL USARSE: el mismo ya no sirve');

  --  Cinco intentos y se acabó.
  delete from pedidos;
  j := codigo_pedir('70000002'); v_cod := j->>'codigo';
  for n in 1..5 loop perform codigo_verificar('70000002','000000'); end loop;
  j := codigo_verificar('70000002', v_cod);
  perform _ok(j->>'error' is not null,
     'a los cinco intentos fallidos el código se muere, aunque después acierten');

  --  Y uno vencido no sirve ni siendo correcto.
  delete from pedidos;
  j := codigo_pedir('70000002'); v_cod := j->>'codigo';
  update codigos set vence_en = now() - interval '1 minute' where dni = '70000002';
  j := codigo_verificar('70000002', v_cod);
  perform _ok(j->>'error' is not null, 'un código vencido no sirve ni siendo el correcto');

  -- ---------- 5. crear la cuenta ----------
  delete from pedidos;
  j := codigo_pedir('70000001'); v_cod := j->>'codigo';
  j := codigo_verificar('70000001', v_cod); v_tk := j->>'ticket';

  k := cuenta_crear('70000001', v_tk, 'corta');
  perform _ok(k->>'error' is not null, 'una clave de menos de ocho no entra');

  k := cuenta_crear('70000001', 'ticketinventado', 'clavelarga123');
  perform _ok(k->>'error' is not null, 'sin el ticket bueno no se crea la cuenta');

  k := cuenta_crear('70000001', v_tk, 'clavelarga123');
  perform _ok((k->>'ok')::boolean, 'con el ticket sí');
  v_ll := k->>'llave';
  perform _ok(length(v_ll) = 64, 'la cuenta recibe una llave de 64, igual que en la ronda');
  perform _ok(k->>'nombre' = 'Juan Carlos' and k->>'apellido' = 'Pérez',
     'EL NOMBRE SALE DEL PADRÓN, no de lo que escriba la persona');
  perform _ok(k->>'socio' = '#11', 'y con él viene el número de socio del club');

  select clave_hash into v_h from cuentas where dni = '70000001';
  perform _ok(v_h <> 'clavelarga123' and v_h like '$2%', 'la clave se guarda hasheada');

  select count(*) into n from codigos where dni = '70000001';
  perform _ok(n = 0, 'y el ticket se quema: no queda nada que reusar');

  -- ---------- 6. un DNI, una cuenta ----------
  delete from pedidos;
  j := codigo_pedir('70000001');
  perform _ok(j->>'estado' = 'usado', 'un DNI que ya tiene cuenta da usado, y no manda nada');
  perform _ok(j->>'pista' is null and j->>'codigo' is null,
     'y en esa respuesta no viaja ni la pista ni un código');

  -- ---------- 7. entrar ----------
  j := entrar('70000001','clavelarga123');
  perform _ok((j->>'ok')::boolean, 'entra con su clave');
  perform _ok(j->>'llave' = v_ll, 'y recupera la MISMA llave');
  perform _ok(j->>'nombre' = 'Juan Carlos', 'con su nombre del padrón');

  j := entrar('70000001','otraclave123');
  perform _ok(j->>'error' is not null, 'con la clave equivocada no entra');
  k := entrar('79999999','otraclave123');
  perform _ok(k->>'error' = j->>'error',
     'y un DNI que NO EXISTE da exactamente el mismo error: no se puede averiguar quién tiene cuenta');

  -- ---------- 8. ADVERSARIO · quiere la lista de socios ----------
  delete from pedidos;
  --  Insiste con un DNI: tres por hora y al cuarto la puerta contesta como si
  --  el socio no existiera. El que barre no aprende nada.
  perform codigo_pedir('70000002');
  perform codigo_pedir('70000002');
  perform codigo_pedir('70000002');
  j := codigo_pedir('70000002');
  perform _ok(j->>'estado' = 'nopadron',
     'ADVERSARIO · al cuarto pedido del mismo DNI en una hora, contesta como si no existiera');
  perform _ok(j::text = codigo_pedir('79999998')::text,
     'y esa respuesta es IDÉNTICA a la de un DNI inventado: el freno tampoco delata');

  --  Prueba miles de DNI distintos: sesenta por hora en total y se corta.
  delete from pedidos;
  for n in 1..60 loop perform codigo_pedir((79000000 + n)::text); end loop;
  j := codigo_pedir('70000002');
  perform _ok(j->>'estado' = 'nopadron',
     'ADVERSARIO · pasados sesenta pedidos en la hora, ni un socio de verdad recibe código');

  delete from pedidos;
  --  Le pide el código a un socio y prueba de adivinarlo en otro DNI.
  j := codigo_pedir('70000004'); v_cod := j->>'codigo';
  k := codigo_verificar('70000002', v_cod);
  perform _ok(k->>'error' is not null, 'ADVERSARIO · un código no sirve para el DNI de otro');

  --  Y no puede crear la cuenta de un socio sin haber recibido nada.
  k := cuenta_crear('70000004', 'loquesea', 'clavelarga123');
  perform _ok(k->>'error' is not null, 'ADVERSARIO · no se crea una cuenta sin ticket');
  select count(*) into n from cuentas where dni = '70000004';
  perform _ok(n = 0, 'y el socio sigue sin cuenta');

  --  Un nombre kilométrico en el padrón se recorta, como en `esquema.sql`.
  perform padron_cargar('70000005', repeat('A',5000), repeat('B',5000), null,'2302400005',false,null);
  select length(apellido) into n from padron where dni = '70000005';
  perform _ok(n = 60, 'ADVERSARIO · un apellido de 5.000 caracteres se recorta a 60');

  -- ---------- 9. el tiempo no delata ----------
  --  Lo caro es el bcrypt, y se corre siempre. Si sólo se corriera para los
  --  socios que existen, la demora SERÍA la respuesta.
  delete from pedidos;
  t0 := clock_timestamp(); perform codigo_pedir('70000004');
  t_hay := extract(epoch from clock_timestamp() - t0) * 1000;
  t0 := clock_timestamp(); perform codigo_pedir('79999997');
  t_no  := extract(epoch from clock_timestamp() - t0) * 1000;
  perform _ok(greatest(t_hay,t_no) < least(t_hay,t_no) * 3,
     'un DNI que existe y uno que no tardan parecido (' ||
     round(t_hay)::text || ' ms contra ' || round(t_no)::text || ' ms)');

  -- ---------- 10. la baja es lógica ----------
  perform socio_baja('70000001');
  select count(*) into n from padron where dni = '70000001';
  perform _ok(n = 1, 'dar de baja NO borra la fila del padrón');
  select count(*) into n from padron where dni = '70000001' and activo;
  perform _ok(n = 0, 'pero queda inactivo');
  select count(*) into n from cuentas where dni = '70000001' and borrado_en is null;
  perform _ok(n = 0, 'y su cuenta queda dada de baja');
  j := entrar('70000001','clavelarga123');
  perform _ok(j->>'error' is not null, 'con la baja hecha ya no entra');

  delete from pedidos;
  j := codigo_pedir('70000001');
  perform _ok(j->>'estado' = 'nopadron', 'y para el alta es como si no estuviera');

  -- ---------- 11. limpiar ----------
  j := limpiar_alta();
  perform _ok(j->>'codigos' is not null and j->>'pedidos' is not null,
     'limpiar_alta cuenta lo que barrió');
end $$;

-- ---------- 12. los permisos, que se prueban desde afuera ----------
do $$
declare n int;
begin
  --  Lo único que el teléfono puede llamar son estas tres.
  perform _ok(has_function_privilege('anonymous','codigo_verificar(text,text)','execute'),
     'anonymous puede verificar un código');
  perform _ok(has_function_privilege('anonymous','cuenta_crear(text,text,text)','execute'),
     'anonymous puede crear su cuenta');
  perform _ok(has_function_privilege('anonymous','entrar(text,text)','execute'),
     'anonymous puede entrar');

  --  Y NADA más. `codigo_pedir` es la que devuelve el código en claro: si el
  --  teléfono pudiera llamarla, el alta entera no serviría para nada.
  perform _ok(not has_function_privilege('anonymous','codigo_pedir(text)','execute'),
     'anonymous NO puede pedir un código (eso lo hace la Function del servidor)');
  perform _ok(not has_function_privilege('anonymous','padron_cargar(text,text,text,text,text,boolean,text)','execute'),
     'anonymous NO puede cargar el padrón');
  perform _ok(not has_function_privilege('anonymous','habilitar_contacto(text,text,text)','execute'),
     'anonymous NO puede cambiarle el contacto a un socio');
  perform _ok(not has_function_privilege('anonymous','socio_baja(text)','execute'),
     'anonymous NO puede dar de baja a nadie');
  perform _ok(not has_function_privilege('anonymous','limpiar_alta()','execute'),
     'anonymous NO puede correr la limpieza');
  perform _ok(not has_function_privilege('anonymous','tapar_mail(text)','execute'),
     'anonymous NO puede usar los ayudantes');
  perform _ok(not has_function_privilege('anonymous','codigo_nuevo()','execute'),
     'ni generar códigos por su cuenta');
  perform _ok(not has_function_privilege('anonymous','limite_ok(text)','execute'),
     'ni tocar el freno');

  --  Las tablas: cerradas dos veces, con RLS y sin permisos.
  select count(*) into n from pg_tables
   where tablename in ('padron','cuentas','codigos','pedidos') and rowsecurity;
  perform _ok(n = 4, 'las cuatro tablas tienen RLS prendida');

  select count(*) into n from pg_policies
   where tablename in ('padron','cuentas','codigos','pedidos');
  perform _ok(n = 0, 'y ninguna política: RLS sin políticas = todo bloqueado');

  select count(*) into n from information_schema.table_privileges
   where table_name in ('padron','cuentas','codigos','pedidos')
     and grantee in ('anonymous','authenticated');
  perform _ok(n = 0, 'anonymous no tiene NINGÚN permiso sobre las cuatro tablas');
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
