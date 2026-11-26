-- ACTA PRO · reversión de la corrección independiente 0001
-- Devuelve el privilegio TRUNCATE a `anon` y `authenticated`.
--
-- ===========================================================================
-- Esto **reintroduce** la debilidad que 0001 corrige. Solo tiene sentido si la
-- corrección rompiera algo que hoy no se ve, y en ese caso conviene averiguar
-- qué dependía de TRUNCATE antes de dejarlo así.
-- ===========================================================================
--
-- Restaura el estado auditado el 2026-11-26 en el proyecto remoto
-- `lmscltbyehofrwtddbfn`: `GRANT ALL` para ambos roles sobre todas las tablas
-- de `public` y del esquema archivado, de modo que TRUNCATE estaba concedido
-- en todas ellas.
--
-- Si al aplicar 0001 el estado encontrado fue distinto del auditado, use las
-- sentencias que ese archivo imprimió, no estas: describen el estado real.

\set ON_ERROR_STOP on

BEGIN;

DO $restaurar$
DECLARE
    fila record;
    total integer := 0;
BEGIN
    FOR fila IN
        SELECT n.nspname AS esquema, c.relname AS tabla, r.rolname AS rol
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (
            SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
        ) r
        WHERE c.relkind = 'r'
          AND n.nspname IN ('public', 'acta_legacy_20261124')
          AND NOT has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
    LOOP
        EXECUTE format(
            'GRANT TRUNCATE ON TABLE %I.%I TO %I',
            fila.esquema, fila.tabla, fila.rol
        );
        total := total + 1;
    END LOOP;

    RAISE NOTICE 'TRUNCATE devuelto en % concesiones.', total;
END;
$restaurar$;

COMMIT;
