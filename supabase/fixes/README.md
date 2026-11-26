# Correcciones independientes del historial de migraciones

Lo que vive aquí **no** es una migración. Son correcciones que se pueden
aplicar y revertir por su cuenta, sin arrastrar nada más.

La razón es práctica: `supabase migration up --remote` aplica el historial
completo en orden, de modo que corregir una sola cosa obligaría a aplicar
también las seis migraciones de esquema pendientes. Separar lo que solo toca
privilegios permite decidir sobre ello sin que la decisión quede atada al resto.

Cada corrección trae su reversión en un archivo hermano.

| Corrección | Qué hace | Estado |
| --- | --- | --- |
| [`0001_revoke_truncate.sql`](0001_revoke_truncate.sql) | Retira `TRUNCATE` de `anon` y `authenticated` | **Pendiente de autorización** |

---

## 0001 · Retirada de `TRUNCATE`

### El problema, con precisión

El proyecto remoto tiene `GRANT ALL` sobre todas las tablas para `anon` y
`authenticated`. `ALL` incluye `TRUNCATE`, y **`TRUNCATE` no pasa por RLS**.
Unas políticas correctas no impiden vaciar una tabla a quien tenga ese
privilegio: lo único que lo impide es no tenerlo.

Lo más grave no es la pérdida de datos, que un respaldo cubre, sino que
`audit_logs` se puede vaciar. Un registro de auditoría que se puede borrar no
prueba nada, y con él se iría el rastro de la propia operación.

Conviene no exagerarlo ni minimizarlo. Son dos cosas distintas:

| Pregunta | Respuesta hoy |
| --- | --- |
| ¿Está **concedido** en PostgreSQL? | Sí, en las 28 tablas de `public` y del esquema archivado, para los dos roles |
| ¿Es **alcanzable** con la clave publicable? | No. PostgREST no tiene forma de expresar `TRUNCATE`, y el remoto no expone ninguna función invocable (`/rpc/` vacío) |

No es una puerta abierta: es una puerta sin cerradura. Se vuelve aprovechable
en cuanto aparezca cualquier vía que ejecute SQL con esos roles —una función
invocable con SQL dinámico, una función `SECURITY DEFINER` sin `search_path`
fijo, acceso directo a la base, una conexión por el pooler—. Retirar el
privilegio cuesta un `REVOKE`; descubrir que hacía falta, bastante más.

De dónde viene: de la exposición automática de tablas nuevas de Supabase, que
concede privilegios a los roles de la Data API sin `GRANT` explícito.

### Privilegios afectados

Exactamente uno: `TRUNCATE`. Nada más se toca.

| Rol | Esquemas | Tablas | Antes | Después |
| --- | --- | --- | --- | --- |
| `anon` | `public` | 14 | `TRUNCATE` concedido | retirado |
| `anon` | `acta_legacy_20261124` | 14 | `TRUNCATE` concedido | retirado |
| `authenticated` | `public` | 14 | `TRUNCATE` concedido | retirado |
| `authenticated` | `acta_legacy_20261124` | 14 | `TRUNCATE` concedido | retirado |

`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `REFERENCES` y `TRIGGER` quedan como
están. La migración pendiente `20261126031630` sí los recorta, pero eso es otra
decisión y va aparte.

El esquema archivado se incluye a propósito: también es evidencia, y vaciarlo
sería igual de irreversible.

### Se ha comprobado que el privilegio no es necesario

La aplicación no emite `TRUNCATE` en ningún punto. Las únicas apariciones de
esa palabra en el código son clases CSS de Tailwind para recortar texto:

```bash
grep -rni "truncate" src/ --include=*.ts --include=*.tsx
```

### Impacto sobre la aplicación actual

**Ninguno.** No hay ninguna ruta, repositorio ni función que dependa de
`TRUNCATE`. La corrección no cambia el esquema, no toca datos, no altera
políticas RLS y no modifica ninguna otra concesión.

La única forma de notarla sería un proceso externo al repositorio que vaciara
tablas con la clave anónima o con una sesión de usuario. Si existe tal proceso,
esta corrección lo rompería —y sería, en sí misma, un hallazgo que conviene
conocer.

### Compatibilidad con las migraciones pendientes

Total, en los dos órdenes posibles:

- **Si se aplica esta corrección primero**, la migración `20261126031630`
  vuelve a emitir el `REVOKE` sobre un privilegio que ya no está. Es idempotente
  —recorre las tablas y revoca— y no falla por ello.
- **Si se aplican las migraciones primero**, `20261126031630` hace el mismo
  trabajo y esta corrección se vuelve innecesaria: su ejecución encontraría cero
  concesiones y no haría nada.

No hay orden incorrecto. La corrección existe para no tener que esperar a la
decisión sobre el esquema.

### Verificación previa

Qué hay ahora mismo, sin cambiar nada:

```sql
SELECT n.nspname AS esquema, c.relname AS tabla, r.rolname AS rol
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')) r
WHERE c.relkind = 'r'
  AND n.nspname IN ('public','acta_legacy_20261124')
  AND has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
ORDER BY 1, 2, 3;
```

Esperado antes de aplicar: **28 filas** por rol. El propio archivo de
corrección imprime esta lista y, además, **las sentencias exactas de reversión
para el estado que encuentre**. Conserve esa salida: describe el estado real,
que es más fiable que el estado que suponemos.

### Aplicación

```bash
psql "$CADENA_DE_CONEXION" -v ON_ERROR_STOP=1 -f supabase/fixes/0001_revoke_truncate.sql
```

Es una transacción única. Dentro de ella: registra el estado previo, lo imprime,
retira el privilegio —empezando por `audit_logs`, `documents`, `signatures` y
`minutes`, que es el orden de prioridad— y **comprueba que no queda ninguna
concesión antes de confirmar**. Si quedara alguna, lanza excepción y no se
confirma nada.

No usa el CLI de Supabase a propósito: `migration up` arrastraría el historial.

### Verificación posterior

La misma consulta de arriba. Esperado: **cero filas**.

Y en la base local, donde el endurecimiento ya está aplicado, los dos casos que
lo comprueban como parte de la suite:

```bash
npm run test:security
```

`G6 authenticated no tiene TRUNCATE en ninguna tabla` y
`G7 anon no tiene ningun privilegio en public`.

### Procedimiento de reversión

```bash
psql "$CADENA_DE_CONEXION" -v ON_ERROR_STOP=1 -f supabase/fixes/0001_revoke_truncate_rollback.sql
```

Devuelve `TRUNCATE` a ambos roles en las mismas tablas. **Reintroduce la
debilidad**, de modo que solo tiene sentido si la corrección rompiera algo que
hoy no se ve —y en ese caso conviene averiguar qué dependía de `TRUNCATE` antes
de dejarlo así.

Si al aplicar la corrección el estado encontrado fue distinto del auditado, use
las sentencias que ese archivo imprimió, no el archivo de reversión: describen
el estado real.

### Probado en los dos sentidos

El par se ejercitó sobre la base local, donde el privilegio ya estaba retirado:

1. La reversión lo devolvió en **28 concesiones**.
2. La suite de seguridad lo detectó: `G1 TRUNCATE sobre audit_logs` y
   `J3 anon no puede vaciar tablas` pasaron a fallar.
3. La corrección lo retiró de nuevo, con su comprobación interna en verde.
4. La suite volvió a pasar completa.

Ese ejercicio destapó además un falso aprobado en la propia suite: los casos que
intentan `TRUNCATE` sobre `meetings` y `minutes` **pasaban igual con el
privilegio concedido**, porque esas tablas están referenciadas por claves
foráneas y el `TRUNCATE` falla por ese motivo y no por falta de permiso. Solo el
de `audit_logs` —sin referencias entrantes— delataba la debilidad. De ahí
vienen `G6` y `G7`, que miran el privilegio en sí.
