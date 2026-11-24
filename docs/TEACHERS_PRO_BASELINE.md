# Baseline técnico de acta-pro-mvp

Auditoría previa a Teachers Pro AI / EduCore AI.
Ejecutada el 2026-11-23 sobre `main` @ `6f4248f`, árbol limpio.

Todos los resultados de esta página provienen de comandos ejecutados en esta
máquina. Lo que no se pudo comprobar está marcado como tal.

---

## 1. Qué se inspeccionó

| Área | Resultado |
| --- | --- |
| Rama y commit | `main` @ `6f4248f`, 4 commits, sin cambios pendientes |
| Rutas de API | 17 |
| Páginas | 15 |
| Tablas | 14, todas con RLS activo |
| Políticas RLS | 20 |
| Funciones `SECURITY DEFINER` | 2 |
| Pruebas | 122 en 15 archivos |

## 2. Comandos ejecutados

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | Sin errores |
| `npm run lint` | Sin errores ni advertencias |
| `npm test` | 122 pruebas, 15 archivos, todo en verde (2,35 s) |
| `npm run build` | Compilado en 4,2 s; 20 páginas generadas |
| `npm run test:coverage` | 62,93 % de sentencias global; `src/lib` 48,12 %; `src/lib/anthropic` 76,92 % |
| `npm audit --omit=dev` | **12 vulnerabilidades: 1 crítica, 4 altas, 7 moderadas** |
| `npm audit` (con dev) | 23 vulnerabilidades |

**`npm ci` no se ejecutó.** Habría borrado y reinstalado `node_modules`
(~8 min) sobre una instalación que funciona, justo antes de necesitar el
entorno para el resto de la auditoría. Queda pendiente como verificación de
reproducibilidad del lockfile; `package-lock.json` es v3 con 679 paquetes.

**Playwright no se ejecutó en esta auditoría.** Las pruebas E2E levantan un
servidor y requieren el navegador instalado; se ejecutaron en verde en la
sesión previa sobre este mismo commit.

## 3. Vulnerabilidades en dependencias de producción

| Severidad | Paquete | Problema | Arreglo |
| --- | --- | --- | --- |
| **CRÍTICA** | `next` (directa) | RCE no autenticada en servidores alojados en Windows; RCE en la API de optimización de imágenes | `next@16.4.6` |
| Alta | `zod` (directa) | Agotamiento de memoria al validar colecciones acotadas de gran tamaño | actualización |
| Alta | `sharp` (transitiva, vía `next`) | Vulnerabilidades en libheif y librsvg | vía `next` |
| Alta | `source-map-js` (transitiva) | DoS del bucle de eventos | transitivo |
| Alta | `brace-expansion` (transitiva) | DoS por expansión cuadrática | transitivo |
| Moderada ×7 | `gaxios`, `gcp-metadata`, `googleapis-common`, `glob`, `minimatch`, `qs`, `rimraf` | DoS y bypass de cancelación | mayoría vía `googleapis` |

Dos observaciones que elevan la prioridad:

1. La RCE de Next.js aplica específicamente a **servidores alojados en
   Windows**, que es el entorno de desarrollo de este proyecto.
2. La vulnerabilidad de `zod` describe exactamente el patrón que usa este
   código: `z.array(segmentSchema).max(2000)` en la ruta de transcripción es
   una colección acotada que un cliente controla.

## 3 bis. Estado tras la corrección (2026-11-24)

Se aplicó la corrección de seguridad **antes** de aprobar el Sprint 01, por
estar a punto de desplegar: publicar una RCE sin autenticar no era aceptable.
El cambio vive en el árbol de trabajo, sin commit.

| | Antes | Después |
| --- | --- | --- |
| Críticas | 1 | **0** |
| Altas | 4 | **0** |
| Moderadas | 7 | 6 |
| Total (producción) | 12 | **6** |

- `next` 16.3.1 → **16.4.6** (anclado exacto, como el scaffold)
- `zod` 4.4.3 → **4.6.7**
- `npm audit fix` sin `--force` para las transitivas

**Las 6 moderadas restantes provienen todas de `googleapis`** (`gaxios`,
`gcp-metadata`, `glob`, `googleapis-common`, `minimatch`, `rimraf`), que solo
se usa para la integración opcional con Google Calendar. Sustituirlo por
llamadas REST directas —como ya se hizo con Deepgram— dejaría el informe de
auditoría en cero. Queda como P1, no como P0.

Regresión tras el cambio: typecheck, lint, 122 pruebas, build y E2E en verde.

Hallazgo colateral: el E2E dependía de las claves y del saldo de quien lo
ejecutara. Ahora `playwright.config.ts` fuerza el camino de demostración, de
modo que la prueba es determinística y no gasta dinero.

## 4. Inventario de rutas

```
/api/commitments/[id]                  /api/meetings/[id]/recording
/api/demo/reset                        /api/meetings/[id]/transcript
/api/documents/[minutesId]/pdf         /api/minutes/[id]
/api/documents/download/[documentId]   /api/minutes/[id]/approve
/api/emails/send                       /api/minutes/[id]/signatures
/api/health/integrations               /api/minutes/generate
/api/integrations/deepgram/token       /api/transcriptions/recover
/api/integrations/google/callback
/api/integrations/google/start
/api/integrations/google/sync
```

Ninguna está versionada. Teachers Pro introduce `/api/v1/teachers/*`, lo que
deja dos convenciones conviviendo; se documenta como deuda aceptada en lugar de
renumerar 17 rutas en producción.

## 5. Seguridad: lo que está bien

- **RLS activo en las 14 tablas.** Ninguna quedó fuera.
- **`google_credentials` tiene RLS activo y ninguna política.** Es
  deliberado: solo la service role key la alcanza.
- **Las dos funciones `SECURITY DEFINER` fijan `search_path = public`**, que es
  la mitigación correcta contra secuestro de esquema.
- **`service_role` no aparece en ningún componente de cliente.** Su uso se
  limita a `src/lib/supabase/server.ts` (definición),
  `src/lib/data/index.ts` (almacenamiento) y `src/lib/google/credentials.ts`.
- **`transcript_segments` no tiene política de `UPDATE`.** La transcripción
  original es inmutable por diseño de base de datos, no solo por convención.
- Tokens de terceros cifrados con AES-256-GCM antes de persistirse.

## 6. Deuda técnica encontrada

| # | Hallazgo | Impacto | Prioridad |
| --- | --- | --- | --- |
| D1 | `next` con RCE crítica | Seguridad en producción | P0 |
| D2 | `zod` con DoS por memoria en la ruta que valida arreglos acotados | Disponibilidad | P0 |
| D3 | `@deepgram/sdk` declarado pero **no importado en ningún archivo** | Peso y superficie innecesarios | P1 |
| D4 | Límite de tasa en memoria por proceso (`src/lib/api/http.ts`) | Inútil con varias instancias | P1 |
| D5 | Repositorio demo en memoria sobre `globalThis` | No sobrevive a serverless multi-instancia | P1 |
| D6 | Sin Content Security Policy con nonces | Defensa en profundidad | P1 |
| D7 | Cobertura de `src/lib` al 48 % | Regresiones no detectadas al añadir Teachers Pro | P1 |
| D8 | Rutas sin versionar | Convención doble | P2 |
| D9 | `listCommitments` carga toda la institución para buscar uno (`/api/commitments/[id]`) | Escala mal | P2 |

`tsx` aparece sin importaciones pero **sí se usa**, como binario en
`npm run check:env`. No es deuda.

## 7. Qué es reutilizable para Teachers Pro

Verificado en el código, no supuesto:

| Pieza | Ubicación | Reutilización |
| --- | --- | --- |
| Instituciones y perfiles | `institutions`, `profiles` | Directa |
| Aislamiento institucional | `current_institution_id()` | Directa |
| Sesión y autorización | `src/lib/session.ts` | Directa |
| Cifrado de tokens de terceros | `src/lib/crypto/tokens.ts` | Directa |
| Errores de API y límite de tasa | `src/lib/api/http.ts` | Directa, con D4 pendiente |
| Auditoría | `audit_logs` + `appendAudit` | Directa, ampliando el enum de acciones |
| Integración con Anthropic | `src/lib/anthropic/` | **Patrón** reutilizable, no el código: el esquema es específico de actas |
| Contrato de repositorio | `src/lib/data/repository.ts` | **Patrón** reutilizable; Teachers Pro necesita el suyo |
| Selección de modo de datos | `src/lib/data/mode.ts` | Directa |
| Sistema de diseño | `src/app/globals.css` | Conflicto: ACTA PRO es azul marino oscuro; el documento maestro de Teachers Pro es azul cielo claro con naranja |
| Sincronización con Google | `/api/integrations/google/sync` | **Patrón** para Classroom |

## 8. Lo que NO debe reutilizarse

- **`transcript_segments`**: su contrato está ligado a `meetings`. Las
  transcripciones de clase necesitan tabla propia, como indica el §11 del
  encargo. Coinciden en forma, no en ciclo de vida ni en base legal.
- **`minutes`**: el esquema está modelado sobre acuerdos y compromisos de una
  reunión, no sobre objetivos curriculares.
- **El generador de actas**: su prompt prohíbe explícitamente inferir. Un
  resumen pedagógico necesita otro contrato.

## 9. Limitaciones de esta auditoría

- No se ejecutó `npm ci` ni Playwright (motivos en §2).
- No se auditó ningún proyecto remoto de Supabase: el configurado en
  `.env.local` no resuelve en DNS. Las políticas RLS se leyeron de los
  archivos de migración, no de una base en ejecución.
- No se verificó que las migraciones apliquen sin error sobre Postgres real.
- La propuesta empresarial se leyó del HTML adjunto (87.376 bytes, v2.1
  noviembre 2026), idéntico al artefacto enlazado.
