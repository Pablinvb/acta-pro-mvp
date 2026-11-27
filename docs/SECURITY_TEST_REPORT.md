# Informe de pruebas de seguridad

Ejecutado el 2026-11-26 sobre `security/hardening`, contra Supabase local y
—las 25 últimas comprobaciones— contra el proyecto remoto ya migrado. Todos los
números de esta página provienen de comandos ejecutados; nada está estimado.

---

## 1. Comando único

```bash
npm run verify:security
```

Encadena, en este orden: `typecheck`, `lint`, pruebas unitarias, pruebas SQL,
pruebas de concurrencia y pruebas de integración. Si cualquiera falla, la
cadena se detiene.

Cada banco por separado:

```bash
npm run test:security
```

```bash
npm run test:concurrency
```

```bash
npm run test:integration
```

```bash
npm run verify:clean-install
```

Los archivos SQL corren dentro de una transacción que **siempre revierte**, con
datos ficticios, sin dejar residuos y sin consumir créditos de Anthropic,
Deepgram ni Resend. Las de concurrencia son la excepción y se explica por qué
en §4.

**Ninguna de estas pruebas se omite sola si falta Docker: falla.** Una prueba
que se salta en silencio informa de un éxito que nadie comprobó, y eso era
exactamente el problema que tenían las pruebas smoke antes de esta fase.

## 2. Resultados

| Verificación | Resultado |
| --- | --- |
| `npm run typecheck` | Sin errores |
| `npm run lint` | Sin errores ni advertencias |
| `npm test` (Vitest, unitarias) | **154 / 154** en 18 archivos |
| `npm run test:security` (SQL) | **156 / 156** en 7 archivos |
| `npm run test:concurrency` (dos conexiones) | **18 / 18** |
| `npm run test:integration` (Supabase local real) | **56 / 56** en 5 archivos |
| `npm run verify:clean-install` (pila desechable) | **16 / 16** |
| `scripts/verify-restore.mjs` (restauración sobre Supabase nuevo) | **9 / 9** |
| `vitest -c vitest.remote.config.mts` (proyecto remoto real) | **16 / 16**, residuo cero |
| `npm run build` | Compilado correctamente |
| `npm run test:e2e` (E2E, modo demostración) | **1 / 1** |
| `npm run test:e2e:local` (recorrido completo, Supabase local + Anthropic real) | **1 / 1**, quince pasos |
| `npm audit` | **0 vulnerabilidades** |
| `npm audit --omit=dev` | **0 vulnerabilidades** |
| `supabase db lint` | Sin errores de esquema |
| `supabase db diff` | **Sin diferencias** entre las 9 migraciones y la base local |
| `supabase db lint --remote` | Sin errores de esquema |
| `supabase db diff --remote` | **Sin diferencias** entre las 9 migraciones y el proyecto remoto |

**Total: 386 comprobaciones automatizadas** (156 unitarias, 156 SQL, 18 de concurrencia, 56 de integración), 25 de ellas sobre el proyecto
remoto real y quince pasos de recorrido funcional contra Supabase local con
Anthropic de verdad.

## 3. Cobertura SQL por archivo

### `0001_signing_and_finalization.sql` — 20 casos

Creación de reuniones en estados avanzados (bloqueada en `signed` y `approved`,
permitida en `scheduled`); finalización sin firmas, con una sola firma y con
ambas; firma duplicada por rol; modificación de un acta firmada; retroceso
desde `signed`; reapertura que elimina firmas, revoca la aprobación y deja
auditoría; y el contrato de `sign_minutes`, incluido que un rechazo no deja
firmas parciales ni mueve el estado.

### `0002_signature_write_paths.sql` — 10 casos

`INSERT`, `UPDATE` y `DELETE` directos sobre `signatures` como `authenticated`
(los tres denegados), lectura todavía permitida, firma por la vía autorizada,
idempotencia con contenido idéntico e independiente del orden, y rechazo de la
repetición con contenido distinto sin alterar lo almacenado.

### `0003_privileges_and_audit.sql` — 20 casos

`TRUNCATE` sobre `audit_logs`, `meetings` y `minutes`; escritura en `profiles`;
lectura de `google_credentials`; suplantación de actor; anotación en otra
institución o sobre una reunión ajena; fabricación de eventos `minutes.signed`
y `minutes.reopened`; anotación legítima; reescritura y borrado de la
auditoría; aislamiento institucional en lectura; y superficie anónima.

> **Dos casos nuevos, y la razón concreta por la que se añadieron.** Al probar
> el par corrección/reversión de `TRUNCATE` sobre la base local se descubrió un
> falso aprobado: las pruebas que intentan `TRUNCATE` sobre `meetings` y
> `minutes` **pasaban igual con el privilegio concedido**, porque esas tablas
> están referenciadas por claves foráneas y el `TRUNCATE` falla por eso. Solo la
> de `audit_logs` —tabla sin referencias entrantes— delataba la debilidad. Los
> casos `G6` y `G7` miran el privilegio en sí (`has_table_privilege`,
> `information_schema.role_table_grants`), que es lo que no admite equívocos.

### `0004_document_idempotency.sql` — 15 casos

Registro de un documento con huella; rechazo de la misma huella repetida en la
misma acta; convivencia de huellas distintas (vista previa y definitivo);
huella con formato inválido; `kind` fuera de sus dos valores; compatibilidad de
los documentos históricos sin huella, incluidos dos conviviendo bajo el índice
parcial; inmutabilidad de la huella, de `kind`, del `sha256` y de la ruta;
actualización del acuse de envío, que sí debe seguir permitida; y que la
evidencia no se puede retirar desde la aplicación —`documents` no tiene política
de `DELETE`, a propósito—.

### `0005_state_machine.sql` — 67 casos

**Las 64 combinaciones posibles entre los ocho estados, una por una**, más tres
comprobaciones sobre la propia matriz: que cubre las 64, que solo 19 están
permitidas (8 identidades y 11 avances legítimos) y que `sent` es terminal.

La matriz esperada se escribe en el archivo de prueba de forma **independiente
del disparador**, a partir del modelo de `src/lib/meeting-state.ts`. Si alguien
altera el disparador, estas pruebas lo dicen. Cada escenario lleva una reunión
propia con un acta aprobada y las dos firmas obligatorias, para que lo único que
se mida sea la legalidad de la transición; la precondición de finalización se
prueba aparte, en `0001`.

## 4. Concurrencia real: dos conexiones, no una simulación

`npm run test:concurrency` abre **dos procesos `psql`**, que son dos conexiones
con sus propias transacciones y sus propios bloqueos. Un bloqueo razonado no es
un bloqueo medido, y desde una sola sesión no se puede medir.

A diferencia del resto de la suite, estos escenarios **confirman** sus
transacciones: una carrera no se puede observar dentro de una transacción que
luego revierte. El guion retira sus propios datos al empezar y al terminar, con
identificadores fijos y reconocibles, y comprueba el destino local antes de
tocar nada.

| Escenario | Casos | Qué se observa |
| --- | --- | --- |
| Dos sesiones firman la misma acta a la vez | 6 | Una firma, la otra reconoce que ya estaba firmada; exactamente dos firmas; la reunión queda `signed`; **la auditoría anota la firma una sola vez** |
| Firma contra reapertura | 4 | La firma se completa, la reapertura simultánea se rechaza, la reunión sigue firmada y las dos firmas siguen ahí |
| Reapertura contra firma tardía | 4 | La reapertura se completa, la firma tardía se rechaza, no queda ninguna firma suelta y la reunión queda en borrador |
| Dos generaciones de PDF con la misma huella | 4 | Una registra, la otra choca con el índice único por clave duplicada, y solo queda un documento |

El resultado correcto de la primera no es que una falle: es que una firme y la
otra reconozca lo ya hecho, sin duplicar firmas ni anotaciones.

## 5. Instalación limpia sobre una pila desechable

Que las migraciones funcionen sobre la base de desarrollo no demuestra que
funcionen sobre una base nueva: la de desarrollo ha ido acumulando el resultado
de cada intento, incluidos los fallidos.

`npm run verify:clean-install` levanta una pila local **independiente**, con su
propio `project_id` (`acta-pro-clean`) y sus propios puertos (base en 54422),
aplica el historial desde cero y la destruye al terminar.

| Grupo | Comprobaciones |
| --- | --- |
| Esquema | La pila responde en su propio puerto; las 9 migraciones se aplican sobre base vacía; quedan 9 de 9 registradas; `db diff` sin diferencias; `db lint` sin avisos |
| Datos semilla | El archivo declara la cuenta docente; se carga sin errores; `institutions` (1), `profiles` (1), `students` (2), `representatives` (2), `student_representatives` (2) y `meetings` (3) quedan con datos; el bucket `acta-documents` existe y es privado |
| Suite completa | Las **132** pruebas SQL pasan contra la pila limpia |
| Aplicación real | Las **33** pruebas de integración pasan contra ese PostgreSQL |

Studio, analíticas, realtime y funciones de borde se dejan apagados en la pila
desechable: no participan en lo que se valida y levantarlos duplicaría el
consumo de una máquina que ya tiene otra pila en pie. Queda dicho en el propio
guion.

**Hallazgo de esta fase:** el archivo semilla **no era autosuficiente**. El
perfil docente apunta a `auth.users`, que se gestiona por la API de
autenticación y no por SQL de aplicación, de modo que en una instalación limpia
la primera inserción fallaba por clave foránea. El encabezado de
`supabase/seed.sql` lo advierte ahora y da la sentencia concreta; el guion hace
ese paso por su cuenta. No se guarda ninguna contraseña en el repositorio.

## 6. Almacenamiento real y rutas de API

`npm run test:integration` corre contra el stack local de verdad: el bucket
real y PostgreSQL real, no dobles de prueba. Las claves se leen de
`supabase status`, nunca de `.env.local`, de modo que no hay manera de que una
prueba acabe apuntando al proyecto remoto.

### `storage.test.ts` — 8 casos

El bucket existe y no es público; guarda y recupera el archivo con el mismo
hash; repetir la subida con los mismos bytes no es un error; subir otros bytes
en la misma ruta se rechaza como conflicto de integridad; una sesión anónima no
descarga ni sube; **una sesión autenticada tampoco descarga directamente del
bucket** —el acceso legítimo pasa por la ruta autenticada de la aplicación, que
comprueba institución y pertenencia—.

### `document-routes.test.ts` — 10 casos

Se invoca el **manejador real** de las rutas. Lo único sustituido es la lectura
de la cookie, que pertenece al servidor de Next y no a lo que aquí se comprueba.

Generación verificable (fila, archivo y `sha256` que coinciden); repetir la
solicitud devuelve el mismo documento y **no crea otro**; la reutilización no
vuelve a anotar la generación en la auditoría; la descarga entrega el PDF con
`content-type` y `cache-control` correctos y hash verificado; no entrega un acta
de otra institución; sin sesión no se genera nada; un archivo manipulado da 409
tanto al descargar como al regenerar; un archivo desaparecido da 409 **y el
registro sigue intacto**, porque no se borra la evidencia por que falte el
archivo, se informa; un identificador inexistente da 404.

### `data-api-permissions.test.ts` — 15 casos

Separa dos preguntas que se confunden con facilidad:

- **Concedido en PostgreSQL** (6 casos): `anon` sin ningún privilegio en
  `public`; `authenticated` sin `TRUNCATE` en ninguna tabla; sin `UPDATE` ni
  `DELETE` sobre `audit_logs`; `google_credentials` solo para el rol de
  servicio; RLS activo en todas las tablas; **todas las funciones
  `SECURITY DEFINER` con `search_path` fijo**.
- **Alcanzable por la API de datos** (9 casos): `anon` no lee ni escribe
  ninguna de las 12 tablas ni puede invocar la firma; la docente ve su reunión y
  no la ajena; no puede escribir firmas por la vía directa; no puede ascenderse
  a administradora; no puede borrar ni alterar un documento; sí puede firmar por
  la vía transaccional; no puede firmar el acta de otra institución.

La segunda superficie es más estrecha que la primera. `TRUNCATE` no tiene forma
de expresarse en PostgREST, y eso **no lo hacía inofensivo**: la primera
pregunta seguía respondiendo que sí, y `TRUNCATE` no pasa por RLS.

## 6 quinquies. Aislamiento entre instituciones, por la API

[`tests/integration/institution-isolation.test.ts`](../tests/integration/institution-isolation.test.ts)
— 16 casos con **dos instituciones ficticias**.

Lo que distingue esta prueba de mirar la interfaz: aquí no se pulsa nada. Se
habla con PostgREST usando la sesión de una docente de la institución A y se le
pide, tabla por tabla, lo que pertenece a la B. Que un menú no tenga el enlace
no significa que el dato no se pueda pedir.

Cubre `institutions`, `profiles`, `students`, `representatives`,
`student_representatives`, `meetings`, `minutes`, `signatures`,
`meeting_participants`, `transcript_segments`, `documents`,
`commitment_tracking`, `audit_logs` y el bucket de documentos. Comprueba además
que A no puede **escribir** en la institución de B ni apropiarse de una reunión
ajena moviéndola a la suya.

**`representatives` es el caso que más merecía la prueba**: no tiene columna de
institución, de modo que su aislamiento depende enteramente del rodeo
`student_representatives → students`. Aguanta. Y la vía que lo rompería
—enlazar a un representante ajeno con un estudiante propio— está cerrada porque
`authenticated` no tiene `INSERT` sobre esa tabla.

**No se encontró ninguna vulnerabilidad.** El valor de la prueba no es haber
encontrado algo, sino que a partir de ahora una migración que rompa el
aislamiento falla aquí.

## 6 quater. El recorrido funcional contra Supabase local y Anthropic real

[`tests/e2e-local/journey.spec.ts`](../tests/e2e-local/journey.spec.ts), con
[`playwright.local.config.ts`](../playwright.local.config.ts).

```bash
npm run test:e2e:local
```

El recorrido de `tests/e2e/happy-path.spec.ts` corre en **modo demostración**,
contra un repositorio en memoria: prueba la interfaz, no la integración. Por eso
pasaba mientras la aplicación desplegada estaba rota. Este recorre los mismos
pasos contra Postgres, el bucket y el modelo **de verdad**, y levanta su propia
institución ficticia, que retira al terminar.

Quince pasos: acceso · creación de la reunión · participantes · consentimiento ·
incorporación de la transcripción · **generación real del borrador con IA** ·
edición del acta · aprobación · firma · PDF · idempotencia al repetir ·
descarga con cotejo de `SHA-256` · repositorio · seguimiento · cierre de sesión.

Tres cosas que conviene decir de él:

- **Comprueba que el acta la escribió el modelo**, no el generador
  determinístico: lee `generator` en la base y exige `anthropic`. Un recorrido
  que pasara con el borrador de demostración no probaría la integración.
- **Un paso no pasa por la interfaz**: la transcripción se siembra en la base.
  El navegador no puede hablar por un micrófono, y el botón de transcripción de
  demostración está desactivado a propósito con `DEMO_MODE=false`. Queda dicho
  en el propio archivo en lugar de disimularlo.
- **Consume una llamada real a Anthropic** por ejecución, de modo que no es una
  prueba para ejecutar en bucle.

Encontró dos fallos que ninguna otra prueba veía, y los dos estaban **vivos en
producción**: la generación del borrador (§5 ter de
[`DEPLOY.md`](DEPLOY.md)) y la creación de reuniones (§7 bis de
[`SECURITY_HARDENING.md`](SECURITY_HARDENING.md)).

## 6 ter. Las consultas con tablas incrustadas, y el fallo que llegó a producción

[`tests/integration/repository-queries.test.ts`](../tests/integration/repository-queries.test.ts)
— 6 casos. Se añadieron **después** de que el panel de la aplicación desplegada
se cayera con un error de servidor, y por eso conviene dejar escrito el hueco que
los hizo necesarios.

La migración `20261125212938` añadió una segunda clave foránea de `meetings` a
`students`. PostgREST, ante dos caminos posibles, responde `300` y rechaza la
consulta: `listDocuments` y `listCommitments` dejaron de funcionar. **Ninguna
prueba las ejecutaba contra una base de datos**, de modo que las 154 unitarias,
las 132 SQL, las 33 de integración y las 16 remotas pasaron todas mientras la
aplicación estaba rota.

La lección no es «faltaba una prueba». Es que una consulta de PostgREST es una
**cadena de texto** que nadie valida hasta que el servidor la recibe: ni el
tipado ni un doble de prueba pueden detectar que el esquema dejó de admitirla. Un
cambio de esquema puede romperla sin tocar una línea de código. Por eso estas
consultas tienen que ejecutarse de verdad en alguna prueba, y ahora lo hacen las
tres que existen, con datos presentes y comprobando que lo incrustado llega.

## 6 bis. Verificación contra el proyecto remoto

[`tests/remote/production.test.ts`](../tests/remote/production.test.ts) — 16
casos, ejecutados contra `lmscltbyehofrwtddbfn` después de aplicar las nueve
migraciones.

```bash
ACTA_VERIFY_REMOTE=<referencia> npx vitest run -c vitest.remote.config.mts
```

Hace falta nombrar el archivo de configuración **y** la referencia del proyecto:
dos veces hay que decir que se quiere, y `npm test` no puede arrastrarlo por
descuido. Con `ACTA_VERIFY_REMOTE=local` y las variables `ACTA_TEST_*` se ensaya
contra la pila local, que es lo que se hizo antes de tocar el remoto.

| Grupo | Qué comprueba |
| --- | --- |
| Acceso | El inicio de sesión entrega una sesión utilizable; la clave publicable sin sesión no lee nada |
| Aislamiento | Una docente solo ve las reuniones de su institución, y ve exactamente una |
| Permisos | La escritura directa sobre `signatures` está revocada; la auditoría no se puede alterar ni borrar, y la fila sigue ahí después de intentarlo |
| Guardas | Transición inválida rechazada; identidad de la reunión inmutable; no se alcanza `signed` sin las firmas obligatorias |
| Firma | `sign_minutes` está publicada y rechaza lo que no corresponde |
| Documentos | Genera el PDF y su hash cuadra con el archivo; repetir no crea un segundo documento; los metadatos son inmutables; la descarga coteja el `SHA-256` |
| Almacenamiento | El bucket no es público; el documento histórico de la institución sigue íntegro byte a byte |
| Reapertura | Reabrir revoca la aprobación y descarta las firmas |

**Residuo cero.** El bloque de limpieza compara el recuento de ocho tablas antes
y después y **falla si algo no cuadra**. La retirada va por el camino legítimo
—reabrir primero, que revoca la aprobación y descarta las firmas, y solo entonces
borrar— porque en el remoto no se puede desactivar un disparador. Se comprobó
además por separado: el inventario del proyecto quedó igual al de antes, tabla
por tabla, y con las mismas dos cuentas de acceso.

## 7. Reproducibilidad de los bytes del PDF

`tests/unit/pdf-idempotency.test.ts` — 17 casos. Trece sobre la huella de
generación y la fecha determinista, y **tres sobre el archivo real**: dos
generaciones con los mismos datos producen el mismo PDF byte a byte, la ruta de
almacenamiento es por tanto la misma, y cambiar el instante del documento sí
cambia los bytes.

Esta es la prueba que sostiene toda la idempotencia. Si los bytes no fueran
reproducibles, el `SHA-256` del archivo y su ruta cambiarían en cada generación
y no habría forma de reutilizar un documento existente.

## 8. Lo que estas pruebas todavía no cubren

Se declara explícitamente para no dar una sensación de cobertura que no existe:

- **El E2E sigue corriendo en modo demostración, en memoria.** Hay un solo
  recorrido Playwright. Las rutas de documentos sí están cubiertas contra
  Supabase local (§6), pero el recorrido completo de una reunión por la interfaz
  no lo está.
- **No hay pruebas de la interfaz de firma manuscrita** más allá del recorrido
  demostrativo: el lienzo, el trazo y su conversión a PNG no tienen pruebas
  propias.
- **Ninguna página se renderiza en una prueba contra una base real.** Lo que se
  añadió tras el fallo del panel cubre las **consultas** del repositorio, no el
  render de la página que las usa. Una página puede seguir cayéndose por algo que
  ocurra fuera de esas consultas, y eso se vería antes en un recorrido por el
  navegador que aquí.
- **El límite de tasa no está probado bajo carga**, y es por proceso: con varias
  instancias el tope efectivo se multiplica.
- **La firma correcta no se ha ejercitado nunca contra el proyecto remoto.** Las
  16 comprobaciones de [`tests/remote/production.test.ts`](../tests/remote/production.test.ts)
  cubren el rechazo de `sign_minutes`, no su éxito, porque desde `signed` la
  única transición permitida es `sent` y las guardas de finalización vigilan
  también el `DELETE`: una firma de prueba quedaría para siempre en la base de la
  institución. Lo que allí no se puede probar sin dejar rastro se da por
  demostrado sobre la base local, cuyo esquema y cuyos privilegios resultaron
  idénticos a los del remoto.
- **La transcripción y la generación del acta se prueban con dobles.** Las
  pruebas smoke contra Deepgram y Anthropic existen (`npm run test:smoke`) pero
  se ejecutan aparte y dependen del saldo de la cuenta.
- **La restauración del respaldo se ha ensayado sobre un Supabase local nuevo,
  no sobre un proyecto alojado nuevo.** El ensayo
  (`scripts/verify-restore.mjs`, 9 / 9) demuestra que los datos de la institución
  se restauran y cuadran, pero las tablas internas de `auth` y `storage` no son
  comparables entre la versión alojada y la local, de modo que esa parte del
  procedimiento sigue sin ejercitarse de punta a punta.
