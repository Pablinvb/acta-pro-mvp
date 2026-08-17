# Arquitectura de ACTA PRO

## 1. Principio rector

La IA **propone**; la persona docente **decide**. Todo el diseño se ordena alrededor de esa frase:

- El acta nace como `BORRADOR` y solo una acción humana explícita la aprueba.
- Cada afirmación del borrador enlaza con los segmentos de transcripción que la respaldan.
- La transcripción original nunca se reescribe: las correcciones viven como una capa de edición sobre el borrador.
- Lo que el sistema no sabe se dice: `No consta`, nunca un valor inventado.

## 2. Vista general

```
Navegador                          Servidor (Next.js)                 Terceros
─────────                          ──────────────────                 ────────
MediaRecorder ──chunks binarios──▶ (no pasa por el servidor)
      │                            POST /api/integrations/
      └──token temporal◀────────── deepgram/token ──────────────────▶ Deepgram /auth/grant
      │
      └──WebSocket Listen v1 ─────────────────────────────────────── ▶ Deepgram streaming
                                   POST /api/transcriptions/recover ▶ Deepgram pregrabado
                                   POST /api/minutes/generate ──────▶ Anthropic (Structured Outputs)
                                   POST /api/documents/[id]/pdf      @react-pdf/renderer
                                        └── SHA-256 ── Supabase Storage (bucket privado)
                                   POST /api/emails/send ───────────▶ Resend
                                   /api/integrations/google/* ──────▶ Google Calendar (solo lectura)
```

El audio **nunca** se almacena en el servidor. Viaja en directo a Deepgram por WebSocket, y en la ruta de recuperación se recibe, se transcribe y se descarta dentro de la misma petición.

## 3. Capas

### 3.1 Datos: un contrato, dos implementaciones

`src/lib/data/repository.ts` define la interfaz `Repository`. Existen dos implementaciones:

| Implementación | Cuándo se usa | Persistencia |
| --- | --- | --- |
| `DemoRepository` | Sin Supabase y con `DEMO_MODE=true` | Memoria del proceso |
| `SupabaseRepository` | Cuando Supabase está configurado | Postgres con RLS |

`getRepository()` elige. El resto de la aplicación no sabe cuál está activa. Esto permite que el flujo completo —incluida la prueba end-to-end— funcione sin ninguna clave, sin caminos de código paralelos.

`DEMO_MODE` describe la ausencia de **claves externas**, no una base de datos distinta: con Supabase configurado se usa Postgres aunque `DEMO_MODE` siga en `true`.

### 3.2 Máquina de estados

`scheduled → ready → recording → processing → draft → approved → signed → sent`

`src/lib/meeting-state.ts` es la única fuente de verdad. Se aplica dos veces: la interfaz oculta las acciones imposibles y el servidor las **rechaza** con `409`. Las transiciones de retroceso están acotadas a propósito:

- `recording → ready` y `processing → ready`: abortar una grabación o reintentar tras un fallo.
- `draft → processing`: regenerar el borrador.
- `approved → draft`: reabrir la edición **mientras no haya firmas**.
- Desde `signed` no se puede volver atrás.

### 3.3 Transcripción: dos capas coordinadas

**`LiveTranscriptService` (navegador)** — `src/lib/deepgram/live-transcript-service.ts`

- Pide un JWT temporal a `/api/integrations/deepgram/token`; `DEEPGRAM_API_KEY` nunca sale del servidor.
- Abre `wss://api.deepgram.com/v1/listen` con `Sec-WebSocket-Protocol: bearer, <token>`.
- Envía los `Blob` de `MediaRecorder` tal cual, en binario y con `timeslice` de 250 ms. Nunca en base64.
- Estados observables: `connecting`, `open`, `reconnecting`, `finalizing`, `closed`, `error`.
- Separa `interimText` de `finalSegments`; solo persiste `is_final`.
- Deduplica por `speaker + start + end`.
- Una única reconexión automática, con un token nuevo.
- Mantiene una copia local de la grabación hasta confirmar que la transcripción quedó guardada.
- En pausa envía `KeepAlive` cada 4 s. Al terminar: `Finalize` → espera el resultado → `CloseStream`.

**`DeepgramRecoveryService` (servidor)** — `src/lib/deepgram/prerecorded.ts` + `/api/transcriptions/recover`

- Recibe la grabación completa cuando el streaming falló o dejó segmentos sin confirmar.
- Transcribe con el mismo modelo y diarización y **normaliza al mismo esquema**.
- Reconcilia por rangos temporales: conserva lo ya confirmado y añade solo lo que no solapa con un segmento previo del mismo hablante.

Ambas capas comparten `src/lib/deepgram/segments.ts`, que agrupa palabras consecutivas del mismo hablante conservando `speaker`, `start`, `end` y `text`.

> **Diarización:** se usa exclusivamente `diarize_model=latest`. El parámetro `diarize=true` está deprecado; enviar ambos se trata como error de configuración y `check:env` lo señala.

> **Nota sobre el SDK:** `@deepgram/sdk` v5 es una reescritura completa. Se implementó contra el contrato HTTP/WebSocket documentado —`fetch` y `WebSocket` nativos— para no depender de una superficie de SDK en transición y para poder simularla con precisión en las pruebas. El SDK no es una dependencia del proyecto.

### 3.4 Generación del acta

`src/lib/anthropic/generate-minutes.ts`:

1. SDK nativo `@anthropic-ai/sdk`, modelo configurable en `ANTHROPIC_MODEL`.
2. **Structured Outputs** vía `output_config.format` con `zodOutputFormat(MinutesSchema)`.
3. Revalidación local con `MinutesSchema.safeParse`: una salida que no cumpla el esquema se rechaza.
4. `normalizeMinutes` descarta fechas mal formadas y convierte literales como `"No consta"` en `null`, dejando constancia en `review_warnings`.
5. `findOrphanSourceIds` detecta citas a segmentos inexistentes. No se descarta el borrador: se marca para revisión humana, porque una referencia inventada es exactamente lo que la docente necesita ver.
6. Errores traducidos a mensajes recuperables: `429` saturación, `refusal`, `max_tokens`, timeout, esquema inválido.

El esquema JSON no contiene datos personales en nombres, enums ni descripciones. El contenido sensible viaja solo en `messages`.

### 3.5 Documento y trazabilidad

Se conservan **dos huellas distintas**, y la diferencia es deliberada:

| Huella | Qué cubre | Dónde vive |
| --- | --- | --- |
| SHA-256 del contenido | JSON canónico del acta, su versión, su código y los nombres de quienes firman | Impresa en el pie del PDF |
| SHA-256 del archivo | Los bytes del PDF generado | `documents.sha256`, visible en el repositorio |

Un archivo no puede contener la huella de sí mismo. Imprimir una y almacenar la otra permite verificar tanto que el archivo descargado no se alteró como que su contenido corresponde a la versión guardada del acta. `canonicalize()` garantiza que la huella del contenido sea reproducible.

El código del documento tiene la forma `ACTA-<año>-<8 caracteres de la reunión>-v<versión>`.

### 3.6 Seguimiento de acuerdos

Al aprobar un acta, `syncCommitmentsFromMinutes` deriva sus acuerdos y compromisos hacia `commitment_tracking`. Tres decisiones importan:

1. **Se toma la versión aprobada, no el borrador de la IA.** Si la docente editó el texto, es su redacción la que entra al tablero.
2. **La operación es idempotente y conserva el avance.** Regenerar o reeditar un acta no reinicia lo que ya se marcó como completado, porque la clave es `(minutes_id, kind, item_index)`.
3. **El estado solo lo cambia una persona.** No hay ninguna regla que marque algo como cumplido al llegar su fecha: el sistema muestra el vencimiento y espera la decisión humana.

Una fecha ausente en el acta sigue ausente en el tablero: esos compromisos aparecen en una lista aparte, «sin fecha», en vez de recibir una fecha inventada.

### 3.7 Auditoría

`audit_logs` registra: creación, confirmación de participantes, consentimiento, inicio y fin de grabación, transcripción guardada o recuperada, mapeo de hablantes, generación, edición, aprobación, firma, generación del PDF, descarga, envío y sincronización con Google.

`metadata_json` guarda **recuentos e identificadores**, nunca contenido: número de segmentos, versión, huella, rol de quien firma, versión del texto de consentimiento, índice del compromiso cuyo estado cambió.

### 3.8 Capa visual

El sistema de diseño vive en `src/app/globals.css` como tokens de `@theme`; ningún componente escribe un color literal. La identidad es oscura: azul marino profundo, azul eléctrico como único acento de marca, verde solo para lo verificado, ámbar para lo que exige revisión y rojo para la grabación en curso.

Dos componentes merecen aclaración, porque parecen prometer más de lo que hacen:

- `LiveWaveform` lee un `AnalyserNode` para dibujar el nivel del micrófono. **No graba ni transmite**: el audio que viaja a Deepgram sale de `MediaRecorder`, no de aquí. Si el navegador no expone `AudioContext`, la barra queda plana y la grabación continúa igual.
- `StaticWaveform` dibuja una forma determinística derivada del texto de la intervención. **No es la onda real del audio** y no reproduce nada, porque el audio no se conserva. Sirve para distinguir voces de un vistazo.

`speakerColor` vive en `src/lib/speakers.ts`, fuera de los componentes de cliente, para poder asignar el color de cada voz también desde el servidor.

## 4. Seguridad

- **Claves:** solo en variables de entorno del servidor. El navegador recibe únicamente la URL y la clave publicable de Supabase, y tokens temporales de Deepgram.
- **RLS:** activo en todas las tablas institucionales. `current_institution_id()` y `can_access_meeting()` son `SECURITY DEFINER` para evitar recursión de políticas. `google_credentials` no tiene ninguna política: solo se accede con la service role key desde el servidor.
- **Inmutabilidad:** `transcript_segments` no tiene política de `UPDATE`. Solo puede reemplazarse por completo durante la recuperación.
- **Almacenamiento:** bucket privado. La descarga pasa por `/api/documents/download/[documentId]`, que comprueba sesión e institución antes de leer el archivo.
- **Tokens de terceros:** AES-256-GCM con `TOKEN_ENCRYPTION_KEY` de 32 bytes. El `state` de OAuth se firma con la misma clave y caduca a los 10 minutos.
- **Límite de tasa:** en memoria, por proceso, sobre las rutas de IA, transcripción, PDF y correo. Suficiente para la demostración; **debe** sustituirse por un almacén compartido antes de un despliegue con varias instancias.
- **Encabezados:** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (micrófono solo para el propio origen) y `Cross-Origin-Opener-Policy`.
- **Validación:** Zod en toda entrada de API, con límites de tamaño para el audio (40 MB) y para la imagen de la firma (400 KB).

## 5. Decisiones y sus motivos

| Decisión | Motivo |
| --- | --- |
| Repositorio en memoria para el modo demo | El flujo completo funciona sin claves y sin duplicar la lógica de negocio. |
| Dos huellas SHA-256 | Un PDF no puede contener su propia huella; fingir lo contrario sería deshonesto. |
| Componente de firma propio | `react-signature-canvas` no declara compatibilidad con React 19. El componente propio son ~100 líneas y funciona con dedo, lápiz y ratón. |
| `fetch`/`WebSocket` en lugar de `@deepgram/sdk` | La v5 es una reescritura; el contrato HTTP es estable y simulable. |
| Capa de edición separada del borrador | Permite comparar lo que propuso la IA con lo que aprobó la persona. |
| Referencia huérfana = advertencia, no rechazo | Es información valiosa para quien revisa; ocultarla empeoraría el acta. |
| `POST /api/demo/reset` | La prueba end-to-end y los ensayos parten del mismo escenario. Devuelve `409` si hay Supabase configurado. |

## 6. Lo que falta para uso institucional

1. Límite de tasa distribuido y protección anti-abuso.
2. Política de conservación configurable por institución, con borrado programado.
3. Roles administrativos y vistas por institución.
4. Content Security Policy con nonces.
5. Integración real con Runachay, cuando exista documentación oficial.
6. Portal remoto para que el representante firme desde su propio dispositivo.
7. Revisión jurídica de los textos de consentimiento y aceptación, hoy marcados como borrador institucional.
