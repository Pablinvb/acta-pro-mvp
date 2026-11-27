-- ACTA PRO · corrección independiente 0001
-- Retira el privilegio TRUNCATE de `anon` y `authenticated`.
--
-- ===========================================================================
-- PENDIENTE DE AUTORIZACIÓN. No se ha ejecutado en el proyecto remoto.
-- ===========================================================================
--
-- Por qué
-- -------
-- El proyecto remoto tiene `GRANT ALL` sobre todas las tablas para `anon` y
-- `authenticated`, y ALL incluye TRUNCATE. **TRUNCATE no pasa por RLS.** Unas
-- políticas correctas no impiden vaciar una tabla a quien tenga ese
-- privilegio: lo único que lo impide es no tenerlo.
--
-- Lo más grave no es la pérdida de datos, que un respaldo cubre, sino que
-- `audit_logs` se puede vaciar. Un registro de auditoría que se puede borrar
-- no prueba nada, y con él se iría el rastro de la propia operación.
--
-- Hasta dónde llega el riesgo, con precisión
-- ------------------------------------------
-- Conviene no exagerarlo ni minimizarlo. Son dos cosas distintas:
--
--   * Lo que el rol tiene **concedido** en PostgreSQL: TRUNCATE sobre todas
--     las tablas. Eso es lo que esta corrección retira.
--   * Lo que es **alcanzable** con la clave publicable a través de la API de
--     datos: TRUNCATE no tiene forma de expresarse en PostgREST, de modo que
--     hoy no se puede ejecutar solo con esa clave.
--
-- Es decir: no es una puerta abierta, es una puerta sin cerradura. Se vuelve
-- aprovechable en cuanto aparezca cualquier vía que ejecute SQL con esos
-- roles -una función invocable con SQL dinámico, una función SECURITY DEFINER
-- sin `search_path` fijo, el acceso directo a la base, una conexión por el
-- pooler-. Retirar el privilegio cuesta esto; descubrir que hacía falta,
-- bastante más.
--
-- Por qué va aparte de las migraciones
-- ------------------------------------
-- `migration up --remote` aplicaría también las cinco migraciones pendientes,
-- que cambian el esquema. Esta corrección solo toca privilegios, se puede
-- aplicar y revertir por su cuenta y no depende de ninguna otra. Se ofrece
-- separada precisamente para que la decisión sobre el resto no la retenga.
--
-- Se ha comprobado que el privilegio no es necesario
-- --------------------------------------------------
-- La aplicación no emite TRUNCATE en ningún punto. Las únicas apariciones de
-- esa palabra en el código son clases CSS de Tailwind para recortar texto.
--
-- Cómo revertir
-- -------------
-- `0001_revoke_truncate_rollback.sql`, en este mismo directorio. La ejecución
-- de este archivo imprime además las sentencias exactas de reversión para el
-- estado que encuentre, que es lo que debe conservarse antes de aplicarlo.
--
-- Cómo aplicar (solo con su autorización)
-- ---------------------------------------
--   psql "$CADENA_DE_CONEXION" -v ON_ERROR_STOP=1 -f supabase/fixes/0001_revoke_truncate.sql
--
-- Es una transacción única: si algo falla, no queda a medias.

\set ON_ERROR_STOP on

BEGIN;

-- Estado previo. Se imprime para poder revertir con exactitud, y no "a lo que
-- creemos que había".
CREATE TEMP TABLE privilegios_previos AS
SELECT
    n.nspname AS esquema,
    c.relname AS tabla,
    r.rolname AS rol,
    -- Orden de prioridad: primero lo que constituye evidencia.
    CASE c.relname
        WHEN 'audit_logs' THEN 1
        WHEN 'documents'  THEN 2
        WHEN 'signatures' THEN 3
        WHEN 'minutes'    THEN 4
        ELSE 5
    END AS prioridad
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (
    SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
) r
WHERE c.relkind = 'r'
  AND n.nspname IN ('public', 'acta_legacy_20261124')
  AND has_table_privilege(r.rolname, c.oid, 'TRUNCATE');

\echo ''
\echo 'Privilegio TRUNCATE encontrado en:'
SELECT esquema, tabla, rol
FROM privilegios_previos
ORDER BY prioridad, esquema, tabla, rol;

\echo ''
\echo 'Sentencias de reversion para este estado exacto (conservelas):'
SELECT format('GRANT TRUNCATE ON TABLE %I.%I TO %I;', esquema, tabla, rol) AS reversion
FROM privilegios_previos
ORDER BY esquema, tabla, rol;

-- La retirada. El esquema archivado se incluye a propósito: también es
-- evidencia, y vaciarlo sería igual de irreversible.
DO $revocar$
DECLARE
    fila record;
BEGIN
    FOR fila IN
        SELECT esquema, tabla, rol FROM privilegios_previos ORDER BY prioridad
    LOOP
        EXECUTE format(
            'REVOKE TRUNCATE ON TABLE %I.%I FROM %I',
            fila.esquema, fila.tabla, fila.rol
        );
    END LOOP;
END;
$revocar$;

-- Comprobación en la misma transacción. Si quedara alguno, no se confirma.
DO $comprobar$
DECLARE
    restantes integer;
BEGIN
    SELECT count(*) INTO restantes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (
        SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
    ) r
    WHERE c.relkind = 'r'
      AND n.nspname IN ('public', 'acta_legacy_20261124')
      AND has_table_privilege(r.rolname, c.oid, 'TRUNCATE');

    IF restantes > 0 THEN
        RAISE EXCEPTION
            'Quedan % concesiones de TRUNCATE. No se confirma el cambio.', restantes;
    END IF;

    RAISE NOTICE 'TRUNCATE retirado de anon y authenticated en public y en el esquema archivado.';
END;
$comprobar$;

COMMIT;
