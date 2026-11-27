# Historial de migraciones y estado del proyecto remoto

Última verificación: 2026-11-26, después de sincronizar, con
`supabase migration list --remote`, `supabase db dump --remote`,
`supabase db diff --remote` y `supabase db lint --remote`.

> **Historial de esta página.** Una versión anterior decía que al remoto le
> faltaban cuatro migraciones y que `20261125163219_security_hardening` constaba
> aplicada. Ninguna de las dos cosas era cierta: faltaban seis, y la de
> endurecimiento era una de ellas. Queda escrito en lugar de reescribirse en
> silencio, porque el error afectaba a la decisión de qué aplicar.

---

## 1. Estado real

**Las nueve migraciones están aplicadas en el proyecto remoto.** Las seis que
faltaban se aplicaron el 2026-11-26 con `supabase migration up --remote`, en una
sola pasada y en orden de identificador.

| # | Migración | Archivo local | Historial remoto | Aplicada |
| --- | --- | --- | --- | --- |
| 1 | `20261125032101_init` | sí | sí | 2026-11-25 |
| 2 | `20261125032107_storage` | sí | sí | 2026-11-25 |
| 3 | `20261125032110_commitment_tracking` | sí | sí | 2026-11-25 |
| 4 | `20261125163219_security_hardening` | sí | sí | **2026-11-26** |
| 5 | `20261125212938_document_and_meeting_integrity` | sí | sí | **2026-11-26** |
| 6 | `20261126025018_atomic_signing_and_finalization` | sí | sí | **2026-11-26** |
| 7 | `20261126030401_harden_signature_writes` | sí | sí | **2026-11-26** |
| 8 | `20261126031630_least_privilege_and_audit_integrity` | sí | sí | **2026-11-26** |
| 9 | `20261126033310_document_generation_idempotency` | sí | sí | **2026-11-26** |

**9 migraciones locales, 9 aplicadas en remoto, 0 pendientes.**

Comprobado después: `db diff --remote` sin diferencias y `db lint --remote` sin
avisos, sobre `public` y `acta_private`.

> Que coincidan los identificadores no probaría por sí solo que el esquema esté
> sincronizado. Lo que lo prueba es el volcado comparado objeto por objeto (§3) y
> la matriz de privilegios, que resultó **idéntica** a la de la base local.
> Sigue habiendo una divergencia de contenido en la primera migración, anterior
> a todo esto, y conviene conocerla (§2).

## 2. La primera migración no es idéntica a su original remota

`supabase/migration-history/` conserva las migraciones recuperadas del proyecto
remoto. La primera, `20261125032101_archive_legacy_and_0001_init.sql`, **archiva
las tablas antiguas hacia `acta_legacy_20261124` antes de crear el esquema
nuevo**.

La migración activa local con ese mismo identificador omite deliberadamente el
archivado, para que una instalación limpia no intente mover tablas que no
existen. **No son el mismo archivo.**

Las copias históricas se conservan a propósito y no deben alterarse para
disimular la diferencia: documentan lo que realmente se ejecutó en remoto.

## 3. Lo que le faltaba al esquema remoto, y cómo está ahora

Comparación con `supabase db dump --remote`, antes y después de aplicar las seis
migraciones. La columna «antes» es el estado con el que el proyecto llevaba
funcionando.

| Objeto | Local | Remoto antes | Remoto ahora |
| --- | --- | --- | --- |
| Disparadores de protección en `public` | 7 | **0** | **7** |
| Funciones en `acta_private` | 10 | **2** | **10** |
| `public.sign_minutes` | sí | **no** | **sí** |
| Restricciones `CHECK` en `public` | 25 | 23 | **25** |
| Columnas `generation_fingerprint` y `kind` | sí | **no** | **sí** |
| Índice único de huella de generación | sí | **no** | **sí** |
| `TRUNCATE` para `anon` y `authenticated` | revocado | **concedido en 28 tablas** | **revocado** |
| Privilegios de `anon` en `public` | ninguno | **`GRANT ALL`** | **ninguno** |
| Escritura directa en `signatures` | revocada | concedida | **revocada** |
| `UPDATE`/`DELETE` sobre `audit_logs` | revocados | concedidos | **revocados** |

La matriz completa de concesiones de las 14 tablas resultó **idéntica** a la de
la base local, línea por línea: 27 sentencias `GRANT` a cada lado.

> **Dos correcciones de método.** La primera: `supabase db dump` emite
> `CREATE OR REPLACE TRIGGER`, no `CREATE TRIGGER`, de modo que buscar la segunda
> forma da cero disparadores incluso en una base que los tiene todos. El recuento
> de cero en el remoto era correcto —las migraciones que los crean no estaban
> aplicadas, y eso lo prueba el historial—, pero la orden que lo midió no podía
> haber encontrado otra cosa. La segunda: esta página decía 12 funciones en
> `acta_private` y la tabla de [`SECURITY_HARDENING.md`](SECURITY_HARDENING.md)
> enumera 10. Son **10**; el 12 era un recuento mal copiado.

### El matiz sobre `TRUNCATE`, con precisión

`GRANT ALL` incluía `TRUNCATE`, y `TRUNCATE` no pasa por RLS. Convenía separar
dos cosas, y conviene seguir separándolas:

- **Concedido en PostgreSQL**: lo estaba, en las 28 tablas de `public` y del
  esquema archivado, para `anon` y `authenticated`.
- **Alcanzable con la clave publicable**: no lo estaba. PostgREST no tiene forma
  de expresar `TRUNCATE`, y la auditoría confirmó que el remoto no exponía
  ninguna función invocable (`/rpc/` vacío).

No era una puerta abierta: era una puerta sin cerradura. La migración
`20261126031630` la cerró al aplicarse, y el volcado posterior no encuentra ni
una concesión de `TRUNCATE`. Por eso la corrección independiente
[`supabase/fixes/0001_revoke_truncate.sql`](../supabase/fixes/0001_revoke_truncate.sql)
**ya no hace falta**: su propio aviso lo anticipaba —si las migraciones iban
primero, encontraría cero concesiones y no haría nada—. Se conserva por si
reapareciera la condición, por ejemplo al exponerse tablas nuevas.

## 4. Los enums heredados: ya no es una pregunta abierta

El remoto contiene dos tipos que el esquema activo no define:

```
public.data_status    = ok | verified | manual_verification_required
public.meeting_status = scheduled | in_progress | awaiting_teacher_review
                      | teacher_approved | rejected | signed | sent
                      | retry_required
```

La versión anterior de esta página decía, correctamente, que su existencia no
prueba incompatibilidad y que había que comprobar las dependencias. **Ya se
comprobó**, sobre el volcado del esquema remoto:

| Dependencia | Dónde |
| --- | --- |
| `acta_legacy_20261124.meetings.status` | columna, tipo `public.meeting_status` |
| `acta_legacy_20261124.meetings.data_status` | columna, tipo `public.data_status` |
| `acta_legacy_20261124.meetings_read` | vista que proyecta ambas columnas |

**No son restos inertes.** Están en uso por el esquema archivado, de modo que
eliminarlos no es cosmético: exige decidir antes qué se hace con ese archivo.
Ninguna de las seis migraciones pendientes los toca, así que **no bloquean la
sincronización**. La decisión puede tomarse después, por separado.

El esquema archivado, por su parte, **no se expone por la API de datos**: una
petición a `meetings_read` devuelve 404. Sus 14 tablas sí tienen `GRANT ALL`
para `anon`, lo que la corrección de `TRUNCATE` cubre.

## 5. Reproducibilidad

`supabase db diff` aplica las 9 migraciones sobre una base sombra vacía y
compara con la local: `No schema changes found`.

Para llegar ahí hubo que corregir `20261125212938`: creaba restricciones y
disparadores sin guarda, de modo que fallaba con `42P07` al reaplicarse. Se
editó ese archivo en lugar de crear otro **porque nunca llegó al remoto**;
editar una migración ya aplicada en producción sí habría sido incorrecto.

Desde el 2026-11-26 la reproducibilidad no se comprueba solo con `db diff`:
`npm run verify:clean-install` levanta una pila local **independiente y
desechable**, aplica el historial desde cero y ejecuta contra ella la suite
completa. Ver [`SECURITY_TEST_REPORT.md`](SECURITY_TEST_REPORT.md) §5.

## 6. Compatibilidad de los datos existentes

`node scripts/audit-remote-readonly.mjs` (solo lectura) comprobó el 2026-11-26
si los datos que ya existen cumplirían las restricciones que introducen las
migraciones pendientes. Es la pregunta que decide si se pueden aplicar sin
pérdida.

| Comprobación | Resultado |
| --- | --- |
| Reuniones con docente o estudiante de otra institución | ninguna |
| Reuniones finalizadas sin las dos firmas obligatorias | ninguna |
| Firmas duplicadas por rol en la misma acta | ninguna |
| Documentos con `sha256` de formato inválido | ninguno |
| Documentos cuya referencia `(acta, reunión, versión)` no cuadra | ninguno |
| Actas con más de un documento registrado | ninguna |

Inventario remoto: 1 institución, 1 perfil, 2 estudiantes, 2 representantes,
4 reuniones, 2 participantes, 1 segmento de transcripción, 1 acta, 2 firmas,
1 documento, 13 anotaciones de auditoría, 3 seguimientos de compromiso,
0 credenciales de Google.

**Conclusión: las seis migraciones pendientes son aplicables sin pérdida de
datos.** El procedimiento exacto está en
[`RELEASE_READINESS.md`](RELEASE_READINESS.md) §6.

## Validación del 27 de noviembre

Se aplicaron al proyecto ACTA PRO las migraciones `20261127030000` y `20261127040000` después del ensayo de restauración. El historial remoto pasó de nueve a once versiones. Las dos firmas previas conservan el contenido original, `signed_by IS NULL` y `verification_method = 'no_registrado'`. El cotejo incluyó las filas de documentos, cuatro reuniones y 22 eventos de auditoría.

La migración `20261127114954_processing_services` incorpora los trabajos persistentes, los contadores de solicitudes, las cargas temporales privadas y la verificación de nuevas firmas. Su activación exige coordinar la versión de la aplicación y el remitente de Resend, porque las escrituras nuevas de firmas pasan a exigir evidencia de identidad en la base.
