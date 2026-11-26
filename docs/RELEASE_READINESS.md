# Preparación para publicación

Rama `security/hardening`, 2026-11-26. Nada se ha publicado ni desplegado.

---

## 1. Criterios de aceptación

| Criterio | Estado |
| --- | --- |
| Migraciones reproducibles | **Cumplido** — `db diff` sobre base vacía: sin diferencias |
| Pruebas automatizadas satisfactorias | **Cumplido** — 137 unitarias, 48 SQL, 1 E2E |
| Firma atómica | **Cumplido** — `sign_minutes`, transacción única con bloqueo |
| No finalizar sin firmas obligatorias | **Cumplido** — verificado en `INSERT` y `UPDATE` |
| Actas y firmas definitivas protegidas | **Cumplido** |
| Permisos con aislamiento institucional | **Cumplido** — `anon` sin superficie, `TRUNCATE` revocado |
| La aplicación compila | **Cumplido** |
| Sin vulnerabilidades conocidas sin evaluar | **Cumplido** — `npm audit --omit=dev`: 0 |
| Sin credenciales expuestas | **Cumplido** — ver §3 |
| Cambios documentados | **Cumplido** |
| Commits locales preparados | **Cumplido** — 5 en la rama |
| Sin duplicaciones documentales indebidas | **Pendiente** — fase de PDF no ejecutada |
| Verificaciones de integridad PDF | **Parcial** — existen de antes; sin pruebas automatizadas |
| Pruebas de concurrencia | **Pendiente** — el bloqueo existe; falta la prueba con dos sesiones |

**La fase local no está cerrada.** Falta la idempotencia de PDF y parte de la
automatización de pruebas.

## 2. Riesgos residuales

| Riesgo | Gravedad | Estado |
| --- | --- | --- |
| El esquema remoto **no tiene** el endurecimiento | Alta | Sin aplicar; requiere su autorización |
| Idempotencia de PDF sin implementar | Media | Puede generar registros documentales duplicados |
| Límite de tasa por proceso | Media | Con varias instancias el tope se multiplica |
| Sin CSP con nonces | Media | Defensa en profundidad |
| Concurrencia no probada con dos sesiones | Media | El bloqueo está razonado, no medido |
| Consentimiento sin revisión jurídica | Alta para uso real | Marcado como borrador institucional |
| Retención y borrado sin implementar | Alta para uso real | No hay borrado programado |

## 3. Revisión de secretos

- `.env.local` está en `.gitignore` y no aparece en ningún commit.
- `supabase/snippets/` se excluyó: eran 48 borradores de Studio.
- `git diff --check` limpio.
- Las claves que muestra `supabase status` son las de demostración del stack
  local, públicas y documentadas por Supabase; no son secretos.

## 4. Procedimiento de recuperación local

```bash
npx supabase start
```

```bash
npx supabase migration up
```

```bash
npm run verify:security
```

Si la base local queda inservible, `npx supabase db reset` la reconstruye desde
las migraciones. **Destruye los datos locales**; no se ejecutó en esta fase.

## 5. Plan de sincronización con GitHub

La rama está lista salvo las fases pendientes. Cuando autorice:

```bash
git push -u origin security/hardening
```

No se ha creado ni fusionado ningún Pull Request. `main` no se ha tocado.

## 6. Plan de sincronización con Supabase remoto

**No ejecutado. Requiere su autorización explícita.**

### Antes de nada: comprobaciones de solo lectura

1. Inventariar los datos reales: cuántas instituciones, perfiles, reuniones,
   actas, firmas y documentos hay, y si alguno es real y no de demostración.
2. Comprobar si los enums heredados tienen dependencias (consulta en
   [`SUPABASE_MIGRATION_HISTORY.md`](SUPABASE_MIGRATION_HISTORY.md) §4).
3. Comprobar si los datos existentes **violarían** las nuevas restricciones:
   reuniones cuyo docente o estudiante pertenezca a otra institución, `sha256`
   con formato inválido, firmas duplicadas por rol, o reuniones en `signed`
   sin las dos firmas. Esto es lo que decide si la migración es aplicable sin
   pérdida.

### Respaldo

Antes de escribir nada: copia completa mediante el respaldo del panel de
Supabase y además un volcado lógico. Sin respaldo verificado, no se aplica.

### Orden de aplicación

Las cuatro migraciones ausentes, en orden, con `supabase migration up --remote`
(no `db push`, que compara esquemas y puede generar sentencias no previstas).

El riesgo real está en la quinta migración: añade claves foráneas compuestas e
índices únicos. Si los datos existentes las violan, **falla** y revierte, que
es el comportamiento correcto. Por eso la comprobación previa del punto 3 es
obligatoria.

### Después

Repetir `supabase db diff --remote`: debe quedar vacío. Ejecutar `db lint`.
Verificar que `anon` y `authenticated` ya no tienen `TRUNCATE`.

### Reversión

Las migraciones no traen `down`. La reversión es restaurar el respaldo. Esto
es una limitación real y por eso el respaldo verificado no es negociable.

### Sobre reconstruir el esquema remoto

**No lo recomiendo todavía.** El remoto contiene datos de demostración que
usted describe como representativos de un flujo completo —incluida un acta
aprobada con firmas y un PDF almacenado—, y son precisamente los datos con los
que comprobar que las nuevas restricciones no rompen nada existente.
Reconstruir los destruiría y perdería esa evidencia. Solo tendría sentido si la
comprobación del punto 3 revelara incompatibilidades irresolubles.

## 7. Autorizaciones pendientes

1. `git push` de la rama `security/hardening`.
2. Inspección remota con credenciales de base de datos para las comprobaciones
   de solo lectura del punto 6.
3. Aplicación de las cuatro migraciones ausentes en remoto, después del
   respaldo y de la comprobación de compatibilidad.
