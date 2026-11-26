# Preparación para publicación

Rama `security/hardening`, 2026-11-26. Publicada en GitHub; **nada desplegado y
nada aplicado en el proyecto remoto.**

---

## 1. Criterios de aceptación

| Criterio | Estado |
| --- | --- |
| Migraciones reproducibles | **Cumplido** — `db diff` sobre base vacía: sin diferencias |
| Instalación limpia validada | **Cumplido** — pila desechable independiente, 16 / 16 |
| Pruebas automatizadas satisfactorias | **Cumplido** — 353 comprobaciones, detalle en §2 |
| Firma atómica | **Cumplido** — `sign_minutes`, transacción única con bloqueo |
| No finalizar sin firmas obligatorias | **Cumplido** — verificado en `INSERT` y `UPDATE` |
| Actas y firmas definitivas protegidas | **Cumplido** |
| Permisos con aislamiento institucional | **Cumplido** en local — `anon` sin superficie, `TRUNCATE` revocado |
| Sin duplicaciones documentales indebidas | **Cumplido** — huella determinista e índice único |
| Verificaciones de integridad PDF | **Cumplido** — con pruebas automatizadas sobre el archivo real |
| Pruebas de concurrencia | **Cumplido** — dos conexiones reales, 18 / 18 |
| Pruebas de almacenamiento real | **Cumplido** — contra el bucket local, no dobles |
| Pruebas de integración de rutas de API | **Cumplido** — manejadores reales contra Supabase local |
| La aplicación compila | **Cumplido** |
| Sin vulnerabilidades conocidas sin evaluar | **Cumplido** — `npm audit`: 0, también con `--omit=dev` |
| Sin credenciales expuestas | **Cumplido** — ver §3 |
| Cambios documentados | **Cumplido** |
| Procedimiento de respaldo | **Cumplido** — ejecutado y verificado, ver §5 |
| Corrección de `TRUNCATE` en remoto | **Preparada, pendiente de autorización** — ver §7 |
| Esquema remoto sincronizado | **Pendiente de autorización** — faltan 6 migraciones, ver §6 |

**La fase local está cerrada.** Lo que queda son decisiones sobre el proyecto
remoto, y ninguna se ha tomado por cuenta propia.

## 2. Resultados de las pruebas

| Banco | Resultado |
| --- | --- |
| Unitarias (Vitest) | **154 / 154** en 18 archivos |
| SQL de seguridad | **132 / 132** en 5 archivos |
| Concurrencia (dos conexiones reales) | **18 / 18** |
| Integración contra Supabase local | **33 / 33** en 3 archivos |
| Instalación limpia (pila desechable) | **16 / 16** |
| E2E (Playwright, modo demostración) | **1 / 1** |
| `typecheck` · `lint` · `build` | Sin errores |
| `npm audit` · `npm audit --omit=dev` | 0 vulnerabilidades |

Detalle por archivo y lo que todavía **no** se cubre:
[`SECURITY_TEST_REPORT.md`](SECURITY_TEST_REPORT.md).

## 3. Revisión de secretos

- `.env.local` está en `.gitignore` y no aparece en ningún commit.
- `supabase/snippets/` se excluyó: eran 48 borradores de Studio.
- `acta-pro-respaldos/` y `respaldos/` están en `.gitignore`. **Un respaldo
  contiene datos personales de estudiantes y no debe acabar en el control de
  versiones.**
- `git diff --check` limpio.
- Las claves que muestra `supabase status` son las de demostración del stack
  local, públicas y documentadas por Supabase; no son secretos. Las pruebas de
  integración las leen de ahí y **nunca de `.env.local`**, de modo que no hay
  manera de que una prueba acabe escribiendo en el proyecto remoto.
- `scripts/audit-remote-readonly.mjs` y `scripts/backup-remote.mjs` leen la
  clave de servicio de `.env.local` y **no la imprimen**, ni completa ni
  parcial.
- No se guarda ninguna contraseña en el repositorio. El archivo semilla
  documenta cómo crear la cuenta de demostración, no su contraseña.

## 4. Los commits de esta rama

Trece commits, del más reciente al más antiguo:

| Commit | Qué resuelve |
| --- | --- |
| `5b2e72f` | Auditoría remota de solo lectura, corrección aislada de `TRUNCATE` y procedimiento de respaldo |
| `7b8035e` | Validación de instalación limpia en una pila local desechable |
| `1a4acbe` | Máquina de estados completa, concurrencia real, bucket real y rutas de API |
| `3c053a2` | Idempotencia de la generación documental |
| `ca03ead` | Documentación de la arquitectura, las pruebas y la divergencia remota |
| `184b0e3` | Retirada de `TRUNCATE` para `anon` y `authenticated`; blindaje de la auditoría |
| `c10ef3d` | La aplicación firma a través de la operación transaccional |
| `edf04fe` | Firma atómica, finalización con firmas y reapertura controlada |
| `797d98e` | Migraciones de integridad reproducibles |
| `cb10819` | Prevención de sobrescritura de PDF y pruebas de integridad de almacenamiento |
| `1921d91` | Rutas de almacenamiento direccionadas por contenido |
| `f931933` | Verificación de integridad del PDF antes de la descarga |
| `5bcd52e` | Dependencias vulnerables parcheadas y credenciales aisladas del E2E |

## 5. Respaldo del proyecto remoto

```bash
node scripts/backup-remote.mjs
```

```bash
node scripts/verify-backup.mjs <directorio del respaldo>
```

Es de solo lectura sobre el proyecto remoto y escribe **fuera del
repositorio**, en `../acta-pro-respaldos/<marca de tiempo>/`.

### El punto que se pasa por alto

**Un volcado SQL no contiene los archivos del almacenamiento.**
`storage.objects` guarda la ruta y el tamaño; los bytes de los PDF están en un
servicio de objetos aparte. Restaurar solo el volcado deja una base que afirma
tener documentos cuyos archivos no existen, y cada descarga fallaría la
verificación de `SHA-256` —que es exactamente lo que la aplicación comprueba—.
Por eso el guion descarga los archivos uno a uno.

Lo mismo con las cuentas: `auth.users` no viaja en el volcado del esquema de la
aplicación y se exporta por separado, con la API de administración.

### Qué cubre, y qué no

| Pieza | Contenido |
| --- | --- |
| `esquema.sql` | Tablas, índices, políticas, funciones, disparadores y privilegios |
| `datos.sql` | Filas de las tablas de la aplicación, auditoría incluida |
| `roles.sql` | Roles del clúster |
| `auth-usuarios.json` | Cuentas, **sin contraseñas** |
| `historial-migraciones.json` | Qué migraciones constan aplicadas |
| `almacenamiento/` | Los PDF, con su ruta original |
| `MANIFIESTO.json` | `SHA-256` y tamaño de cada pieza, y la lista explícita de lo que el respaldo no cubre |
| `RESTAURACION.md` | El procedimiento, con sus límites |

**No contiene** contraseñas en claro —no son recuperables—, secretos de
configuración, registros del servidor ni ajustes del panel (proveedores de
autenticación, plantillas de correo, claves de API). Eso se vuelve a establecer
a mano, y está dicho en el manifiesto para que no se descubra durante una
restauración.

### Verificación de integridad

`verify-backup.mjs` comprueba que cada pieza está presente, que ninguna se ha
alterado respecto del manifiesto, que no hay archivos ajenos, y —la que
distingue un respaldo útil de uno que solo lo parece— que **cada ruta de
documento que aparece en `datos.sql` tiene su archivo en `almacenamiento/`**.
`datos.sql` puede traer la tabla `documents` entera sin que exista un solo PDF
detrás.

El propio `backup-remote.mjs` coteja además, contra el proyecto remoto, que el
`SHA-256` de cada archivo descargado coincide con el registrado en la fila.

### Un respaldo incompleto se declara incompleto

En una ejecución con la red caída, cuatro de los nueve pasos fallaron y el guion
salió con error en lugar de dejar un directorio con forma de respaldo. Es el
comportamiento previsto: un respaldo que no se puede dar por válido no sirve de
nada, y creerlo válido es peor que no tenerlo.

### Periodicidad

El plan gratuito **no incluye respaldos automáticos con retención**. Mientras
siga en ese plan, este guion es el respaldo: antes de cada cambio de esquema, y
en operación normal con la periodicidad que corresponda al dato que esté
dispuesto a perder. Un respaldo guardado en la misma máquina que se quiere
proteger no es un respaldo: copie el directorio a otro soporte.

## 6. Sincronización del esquema remoto

**No ejecutado. Requiere su autorización explícita.**

Al proyecto `lmscltbyehofrwtddbfn` le faltan **seis** migraciones. Las tres
primeras del historial sí están aplicadas.

### Las seis, en orden

| Orden | Identificador | Qué introduce | Riesgo |
| --- | --- | --- | --- |
| 1 | `20261125163219_security_hardening` | Esquema `acta_private`, funciones de autorización, políticas RLS por institución | Bajo — crea objetos nuevos |
| 2 | `20261125212938_document_and_meeting_integrity` | **7 restricciones** y 5 disparadores: claves foráneas compuestas institucionales, referencia documental, formato `SHA-256`, unicidad de firma por rol | **El más alto** — si los datos existentes las violaran, falla |
| 3 | `20261126025018_atomic_signing_and_finalization` | `sign_minutes`, precondiciones de finalización, guarda de creación, revocación al reabrir | Bajo |
| 4 | `20261126030401_harden_signature_writes` | Idempotencia honesta; revoca la escritura directa en `signatures` | **Medio** — cambia permisos de los que depende la aplicación |
| 5 | `20261126031630_least_privilege_and_audit_integrity` | Retira `TRUNCATE` y la superficie de `anon`; blinda `audit_logs` | **Medio** — cambia permisos |
| 6 | `20261126033310_document_generation_idempotency` | Huella de generación, `kind`, índice único parcial | Bajo — el índice es parcial, los documentos históricos no se invalidan |

### Verificaciones previas

**1. Compatibilidad de los datos existentes.** Es la comprobación que decide si
la migración 2 es aplicable sin pérdida.

```bash
node scripts/audit-remote-readonly.mjs
```

Ejecutada el 2026-11-26: **las seis comprobaciones en verde**. Ninguna reunión
con docente o estudiante de otra institución, ninguna finalizada sin las dos
firmas, ninguna firma duplicada por rol, ningún `sha256` mal formado, ninguna
referencia documental descolgada, ninguna acta con documentos de sobra. Detalle
en [`SUPABASE_MIGRATION_HISTORY.md`](SUPABASE_MIGRATION_HISTORY.md) §6.

**Repítala inmediatamente antes de aplicar.** El resultado vale para los datos
que había cuando se ejecutó; si alguien ha usado la aplicación desde entonces,
la respuesta puede haber cambiado.

**2. Los enums heredados no bloquean.** Están en uso por
`acta_legacy_20261124.meetings` y su vista, pero ninguna de las seis migraciones
los toca. La decisión sobre el esquema archivado puede tomarse después.

**3. Respaldo verificado.** Sin esto, no se aplica:

```bash
node scripts/backup-remote.mjs
```

```bash
node scripts/verify-backup.mjs <directorio del respaldo>
```

### Dry run

Antes de aplicar nada, comprobar qué vería el CLI:

```bash
node node_modules/supabase/dist/supabase.js migration list --remote
```

```bash
node node_modules/supabase/dist/supabase.js db diff --remote
```

El primero debe seguir mostrando seis migraciones con la columna remota vacía.
El segundo describe la diferencia real de esquema: si lo que imprime no se
corresponde con la tabla de arriba, **pare** — significa que alguien ha
cambiado el remoto por otra vía.

### Aplicación

```bash
node node_modules/supabase/dist/supabase.js migration up --remote
```

Con `migration up`, **no con `db push`**: `db push` compara esquemas y puede
generar sentencias no previstas. `migration up` aplica los archivos en orden,
los mismos que se han probado.

El CLI las aplica una a una. Si la segunda falla por datos incompatibles,
revierte y se detiene: ese es el comportamiento correcto, y por eso la
verificación previa es obligatoria y no opcional.

### Coordinación entre la aplicación y los permisos

Es el punto delicado de toda la operación y conviene tenerlo claro **antes** de
empezar, no durante.

Las migraciones 4 y 5 **retiran permisos de los que la versión desplegada de la
aplicación depende hoy**. En concreto, la migración 4 revoca el `INSERT` directo
sobre `signatures`, que es la vía que usa el código anterior al commit
`c10ef3d`. Si se aplican las migraciones sin desplegar la aplicación de esta
rama, **la firma deja de funcionar**: la versión desplegada intentará escribir
directamente y recibirá `permission denied`.

El orden seguro es:

1. Respaldo verificado.
2. Verificación de compatibilidad de datos.
3. **Desplegar primero la aplicación de esta rama.** Firma a través de
   `sign_minutes`, que todavía no existe en remoto: la ruta de firma devolverá
   un error controlado durante la ventana, pero nada se corrompe. Es preferible
   a lo contrario, donde la aplicación escribiría por una vía que ya no tiene
   permiso.
3. *(Alternativa, si la ventana sin firma no es aceptable)* Aplicar las
   migraciones 1 a 3 —que solo añaden objetos y no retiran permisos—, desplegar
   la aplicación, y aplicar después 4, 5 y 6. Con `sign_minutes` ya creada, la
   aplicación nueva funciona desde el primer momento y la retirada de permisos
   llega cuando ya nadie usa la vía antigua. **Es el camino recomendado.**
4. Verificaciones posteriores.

Elija uno de los dos antes de empezar. Hacer la mitad de cada uno es la única
forma de salir mal de aquí.

### Verificaciones posteriores

```bash
node node_modules/supabase/dist/supabase.js db diff --remote
```

Debe quedar **vacío**.

```bash
node node_modules/supabase/dist/supabase.js db lint --remote
```

Y las comprobaciones que confirman que el endurecimiento está vivo de verdad:

- `supabase migration list --remote`: las nueve con columna remota.
- `anon` sin ningún privilegio en `public`; `authenticated` sin `TRUNCATE`.
- Los 7 disparadores de protección presentes.
- `public.sign_minutes` presente e invocable.
- Un recorrido completo en la aplicación con datos de prueba: grabar, generar
  acta, aprobar, firmar las dos partes, generar el PDF, **pulsar dos veces y
  comprobar que no aparece un segundo documento**, y descargar.
- Ejecutar los Advisors de seguridad y rendimiento del panel de Supabase y
  anotar los avisos residuales con su justificación. Los Advisors son una
  función del panel y no tienen equivalente local: `db lint` cubre el esquema,
  no la configuración del proyecto.

### Recuperación ante fallos

| Situación | Qué hacer |
| --- | --- |
| Una migración falla y revierte | El esquema queda como estaba. Corregir la causa —normalmente datos incompatibles— y repetir. No forzar. |
| Una migración se aplica a medias | No debería ocurrir: cada archivo es transaccional. Si ocurriera, restaurar el respaldo. |
| La aplicación falla tras aplicar 4 y 5 | Casi con seguridad es el desajuste de la ventana de despliegue. Desplegar la aplicación de esta rama; no devolver los permisos. |
| Hay que volver atrás del todo | Restaurar el respaldo. **Las migraciones no traen `down`.** Es una limitación real y por eso el respaldo verificado no es negociable. |

### Sobre reconstruir el esquema remoto

**No es necesario.** Los datos existentes son compatibles con todas las
restricciones pendientes, de modo que no hay nada que fuerce a empezar de cero.
Reconstruir destruiría los datos de demostración, que son precisamente los que
permiten comprobar que las restricciones nuevas no rompen nada existente.

## 7. Corrección prioritaria de `TRUNCATE`

Preparada, **aparte de las migraciones** y **pendiente de autorización**:

- [`supabase/fixes/0001_revoke_truncate.sql`](../supabase/fixes/0001_revoke_truncate.sql)
- [`supabase/fixes/0001_revoke_truncate_rollback.sql`](../supabase/fixes/0001_revoke_truncate_rollback.sql)

Va aparte porque `migration up --remote` arrastraría también las seis
migraciones de esquema, y esta solo toca privilegios. Así la decisión sobre el
resto no la retiene.

Ambos archivos se probaron en la base local **en los dos sentidos**: la
reversión devolvió el privilegio en 28 concesiones, la suite de seguridad lo
detectó, y la corrección lo retiró y la suite volvió a pasar.

Detalle completo —SQL, privilegios afectados, verificación previa y posterior,
reversión, impacto e interacción con las migraciones— en el encabezado de los
propios archivos y en el informe final de la fase.

## 8. Autorizaciones pendientes

1. **Corrección de `TRUNCATE` en remoto** (§7). Independiente, reversible, sin
   impacto en la aplicación.
2. **Aplicación de las seis migraciones pendientes** (§6), después del respaldo
   verificado y de repetir la verificación de compatibilidad.
3. **Despliegue de la aplicación de esta rama**, coordinado con el punto 2 según
   uno de los dos órdenes descritos.
4. **Pull Request de `security/hardening` a `main`.** No se ha creado ni
   fusionado nada. `main` no se ha tocado.
