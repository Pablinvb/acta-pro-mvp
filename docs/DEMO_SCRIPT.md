# Guion de demostración — 4 minutos

**Escenario:** Ana Pérez, docente. Reunión de seguimiento académico con María López, representante, y Juan Pérez López, estudiante de 5.º EGB A. Todos los datos son ficticios.

## Antes de empezar

```bash
npm run dev
```

- Ingrese en <http://localhost:3000> con `ana.perez@demo.actapro.ec` / `demo1234` y **déjelo en el dashboard**.
- Si ya ensayó el flujo, reinicie el escenario:

```bash
curl -X POST http://localhost:3000/api/demo/reset
```

- Micrófono probado, volumen del portátil al mínimo para evitar acoples.
- Segunda pestaña abierta en `/settings/integrations`, por si preguntan por las integraciones.

---

## 0:00 — 0:30 · El problema

> «Cuando una docente se reúne con un representante, tiene que elegir: escuchar o escribir. Si escribe, deja de escuchar. Si escucha, el acta se redacta después, de memoria, y se pierden acuerdos, responsables y fechas. Y cuando meses después hay un desacuerdo, no hay evidencia de lo que se dijo.»

> «ACTA PRO no reemplaza el criterio de la docente. Convierte la conversación en evidencia institucional trazable, sin que ella tenga que dejar de escuchar.»

---

## 0:30 — 1:00 · Consentimiento primero

Dashboard → **Seguimiento académico — Juan Pérez** → **Continuar en «Participantes»** → confirmar las tres personas → **Confirmar y continuar**.

Muestre la pantalla de aviso.

> «Antes de nada: aquí no hay botón de grabar. El micrófono está bloqueado hasta que todas las personas presentes acepten, y se guarda qué versión del aviso leyeron y cuándo. Si alguien no acepta, la reunión se hace igual y el acta se escribe a mano.»

Marque las tres casillas y la confirmación de lectura → **Registrar consentimiento**. Aparece el botón de grabar.

---

## 1:00 — 1:45 · Grabar y transcribir

**Con Deepgram configurado:** pulse **Iniciar grabación** y mantenga 30–40 segundos de conversación. Señale la transcripción en vivo separada por hablante y el texto provisional en gris.

> «El texto gris es provisional y no se guarda. Solo se conserva lo confirmado, con su hablante, su inicio y su fin.»

Pulse **Finalizar**.

**Sin Deepgram, o si el micrófono falla:** pulse **Cargar transcripción de demostración**.

> «Esto es el plan B de la demostración: carga una transcripción ficticia y la aplicación lo dice explícitamente. No simulamos servicios en silencio.»

---

## 1:45 — 2:15 · Quién es quién

Pantalla de hablantes.

> «El sistema separó tres voces distintas. No sabe quiénes son: no hay biometría. La docente confirma la correspondencia, y puede corregirla cuando quiera.»

Asigne `speaker_0` → Ana Pérez, `speaker_1` → María López, `speaker_2` → Juan Pérez López → **Guardar asignación** → **Generar borrador con IA**.

---

## 2:15 — 3:15 · El momento clave

El acta aparece marcada como **BORRADOR**.

Señale, en este orden:

1. **Acuerdos con responsable y fecha.** «Entregar las tres tareas pendientes, Juan, 21 de agosto.»
2. **Un acuerdo sin fecha.** «La tutoría de refuerzo no tiene fecha porque en la reunión nadie la dijo. El sistema escribe *no consta*. No inventa.»
3. **Ver origen en la transcripción.** Despliegue un acuerdo. «Cada acuerdo enlaza con el momento exacto en que se dijo. Esto es lo que convierte un resumen en evidencia.»
4. **Sugerencia de lenguaje objetivo.** «En la reunión se dijo que el estudiante *es bastante flojo*. Eso califica a la persona; no es un hecho. La herramienta propone una redacción observable. La docente acepta o rechaza —y la transcripción original no se toca nunca.»

Pulse **Aceptar sugerencia**.

5. **Discrepancias.** «La docente lo atribuye a distracción; el estudiante, a que se traba cuando no entiende. El acta registra las dos versiones sin decidir cuál es cierta.»

Pulse **Aprobar acta y continuar a firmas**.

---

## 3:15 — 3:45 · Firmar y archivar

Firme en los dos recuadros, marque las aceptaciones → **Firmar y generar PDF**.

> «Firma manuscrita digitalizada, en el mismo dispositivo. No es una firma electrónica cualificada y la aplicación lo dice, aquí y en el propio PDF.»

Muestre las dos huellas.

> «El PDF se guarda en un bucket privado con su huella SHA-256. Si dentro de seis meses alguien discute el documento, se compara la huella del archivo con la que quedó registrada. Y la huella del contenido se recalcula desde el acta guardada.»

Abra **Ver en el repositorio** → señale el historial de auditoría.

> «Creación, consentimiento, grabación, generación, aprobación, firma, PDF. Todo con hora.»

---

## 3:45 — 4:00 · Límites e impacto

> «Qué es honesto decir: Runachay aparece como *No disponible*, porque no hay API oficial y no vamos a fingir una integración. El audio no se guarda nunca. Y esto no da validez legal automática: da evidencia trazable, que es lo que hoy no existe.»

> «El objetivo es que una reunión termine con un acta firmada, no con una tarea pendiente para el viernes.»

---

## Plan B

| Falla | Qué hacer |
| --- | --- |
| Micrófono o permisos | **Cargar transcripción de demostración**. El flujo continúa completo. |
| Deepgram caído o sin clave | Igual que arriba. La interfaz ya rotula la simulación. |
| Anthropic caído o sin clave | El borrador se genera con el generador determinístico, marcado como demostración. Contiene los mismos acuerdos, la misma sugerencia de lenguaje y el mismo dato ausente. |
| Sin red | Todo el modo demostración es local salvo el streaming. Ejecute con `DEMO_MODE=true` y use el plan B del micrófono. |
| Estado sucio de un ensayo previo | `curl -X POST http://localhost:3000/api/demo/reset` |
| Se acaba el tiempo | Corte tras el punto 4 de las 2:15–3:15 y salte directo a las huellas y la auditoría. |

## Preguntas probables

**¿Y si la IA se equivoca?**
Por eso el acta es un borrador y cada afirmación enlaza con su origen. Revisar es más rápido que redactar, y el error queda a la vista.

**¿Reconoce quién habla?**
No. Separa voces distintas; la persona confirma quién es cada una. No hay biometría y no la afirmamos.

**¿Esto tiene valor legal?**
Es evidencia institucional trazable: versiones, firmas, huella y auditoría. La validez formal depende de las políticas de la institución y de la normativa. No prometemos más que eso.

**¿Dónde queda el audio?**
En ningún sitio. Se transcribe y se descarta. No hay un bucket de audios.

**¿Funciona sin internet?**
El modo demostración sí. La transcripción en vivo, no.
