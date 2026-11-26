# Informe de pruebas de seguridad

Ejecutado el 2026-11-26 sobre `security/hardening`, contra Supabase local.
Todos los números de esta página provienen de comandos ejecutados; nada está
estimado.

---

## Comando único

```bash
npm run verify:security
```

Encadena typecheck, lint, pruebas unitarias y pruebas SQL. Las SQL solas:

```bash
npm run test:security
```

Cada archivo SQL corre dentro de una transacción que **siempre revierte**, con
datos ficticios, sin dejar residuos y sin consumir créditos de Anthropic,
Deepgram ni Resend.

## Resultados

| Verificación | Resultado |
| --- | --- |
| `npm run typecheck` | Sin errores |
| `npm run lint` | Sin errores ni advertencias |
| `npm test` (Vitest) | **137 / 137** en 17 archivos |
| `npm run test:security` (SQL) | **48 / 48** en 3 archivos |
| `npm run build` | Compilado correctamente |
| `npx playwright test` (E2E) | **1 / 1** |
| `npm audit --omit=dev` | **0 vulnerabilidades** |
| `supabase db lint` | Sin errores de esquema |
| `supabase db diff` | **Sin diferencias** entre migraciones y base local |

## Cobertura SQL por archivo

### `0001_signing_and_finalization.sql` — 20 casos

Creación de reuniones en estados avanzados (bloqueada en `signed` y
`approved`, permitida en `scheduled`); finalización sin firmas, con una sola
firma y con ambas; firma duplicada por rol; modificación de un acta firmada;
retroceso desde `signed`; reapertura que elimina firmas, revoca la aprobación
y deja auditoría; y el contrato de `sign_minutes`, incluido que un rechazo no
deja firmas parciales ni mueve el estado.

### `0002_signature_write_paths.sql` — 10 casos

`INSERT`, `UPDATE` y `DELETE` directos sobre `signatures` como `authenticated`
(los tres denegados), lectura todavía permitida, firma por la vía autorizada,
idempotencia con contenido idéntico e independiente del orden, y rechazo de la
repetición con contenido distinto sin alterar lo almacenado.

### `0003_privileges_and_audit.sql` — 18 casos

`TRUNCATE` sobre `audit_logs`, `meetings` y `minutes`; escritura en `profiles`;
lectura de `google_credentials`; suplantación de actor; anotación en otra
institución o sobre una reunión ajena; fabricación de eventos `minutes.signed`
y `minutes.reopened`; anotación legítima; reescritura y borrado de la
auditoría; aislamiento institucional en lectura; y superficie anónima.

## Reproducibilidad de migraciones

`supabase db diff` crea una base sombra **vacía**, aplica las 8 migraciones en
orden y compara con la base local. Resultado: `No schema changes found`. Es
decir, las migraciones reproducen el esquema desde cero y la base local no
tiene deriva respecto de ellas.

Se verificó además que el bucket `acta-documents` existe y es privado.

## Lo que estas pruebas todavía no cubren

Se declara explícitamente para no dar una sensación de cobertura que no existe:

- Las 64 combinaciones de transición de estado una por una. Se cubren las
  transiciones legítimas del camino completo y varias inválidas, no la matriz
  entera.
- Concurrencia real con dos sesiones simultáneas. El bloqueo `FOR UPDATE` está
  implementado y razonado, pero no hay una prueba que lance dos conexiones a la
  vez.
- Almacenamiento real contra el bucket local: creación, reutilización de
  archivo idéntico, rechazo de archivo distinto en la misma ruta y descargas
  con hash incorrecto.
- Idempotencia de la generación de PDF.
- Pruebas de integración de las rutas API contra Supabase local; el E2E corre
  en modo demostración, en memoria.
