# Firmas e identidad de quien firma

> **Estado: diseño, con una parte ya implementada y otra pendiente de decisión.**
> Lo que está en pie se señala como tal; lo propuesto, también. Este documento no
> afirma validez jurídica de nada: eso es [`PROTECCION_DATOS.md`](PROTECCION_DATOS.md) §9.

---

## 1. Lo que una firma de ACTA PRO ya garantiza hoy

Conviene empezar por aquí, porque es más de lo que parece y evita rehacer
trabajo. Cada firma está atada a:

| A qué queda atada | Cómo |
| --- | --- |
| **Un acta concreta y su versión** | `signatures.minutes_id` apunta a una fila de `minutes` que lleva su `version` |
| **Una fecha y hora** | `signed_at`, escrito por la base, no por el navegador |
| **Un texto de aceptación versionado** | `acceptance_text_version`; queda registrado qué redacción leyó quien firmó |
| **Un rol único por acta** | Índice `signatures_minutes_role_unique`: no puede haber dos firmas de docente en la misma acta |
| **Un consentimiento previo registrado** | La reunión no puede grabarse sin consentimiento de todas las personas participantes, y sin grabación no hay acta |

Y está protegida contra tres cosas, por la base y no por la interfaz:

- **Modificación.** `protect_finalized_signatures` vigila `INSERT`, `UPDATE` y
  `DELETE`. Una firma finalizada no se altera ni se borra, tampoco con el rol
  de servicio por la vía normal.
- **Escritura directa.** `authenticated` **no tiene `INSERT` sobre
  `signatures`**. La única vía es la función transaccional `sign_minutes`, que
  comprueba sesión, acceso a la reunión, versión vigente, aprobación y la
  presencia de ambas firmas obligatorias, todo en una transacción.
- **Reutilización entre textos.** Al reabrir un acta se revoca la aprobación y
  **se descartan las firmas**. Una firma recogida para un texto no puede acabar
  respaldando otro distinto.

## 2. Lo que **no** garantiza

Una sola cosa, y es la importante: **no acredita quién dibujó el trazo.**

`signer_name` es un texto. No hay ninguna columna que ate la firma a una
identidad verificada. Hoy, quien tenga la sesión de la docente abierta puede
firmar como docente, y la firma del representante la dibuja quien tenga el
dispositivo delante. El control es **presencial y procedimental**: la docente
está ahí. Eso puede ser suficiente para un acta escolar y es como funcionan
muchas actas en papel, pero hay que decirlo en voz alta en lugar de dejar que
la pantalla sugiera otra cosa.

### Firma manuscrita digitalizada ≠ firma electrónica certificada

| | Firma manuscrita digitalizada (lo que hay) | Firma electrónica certificada |
| --- | --- | --- |
| Qué es | Un trazo dibujado en pantalla, guardado como PNG | Un certificado emitido por una entidad acreditada |
| Qué acredita | Que alguien dibujó algo en ese dispositivo, en esa fecha | La identidad del firmante, con respaldo de la entidad certificadora |
| Quién la respalda | La institución, por su propio procedimiento | Una entidad de certificación acreditada |
| Qué cuesta | Nada | Emisión por firmante |

En el Ecuador la firma electrónica certificada la emiten entidades acreditadas
y su régimen es el de la normativa de comercio electrónico y firma electrónica.
**Si el acta necesita ese valor probatorio, ACTA PRO no lo da hoy y no basta con
ajustar el código: hay que contratar certificados.** Esa es una decisión de la
institución, con coste, y está fuera de lo autorizado aquí.

La aplicación ya rotula la diferencia en el texto de aceptación. Conviene que
siga rotulada en el propio PDF.

## 3. Mecanismo propuesto

### 3.1 Docentes — atar la firma a la sesión verificada · **IMPLEMENTADO**

Es lo que mejor relación tiene entre esfuerzo y resultado, y **no necesita
ningún servicio nuevo**: el personal docente ya se autentica con Supabase Auth.

Aplicado en la migración `20261127040000` (solo en local; la remota queda
pendiente de autorización):

```sql
ALTER TABLE public.signatures
    ADD COLUMN signed_by uuid REFERENCES public.profiles(id),
    ADD COLUMN verification_method text NOT NULL
        DEFAULT 'presencial_atestiguada';
```

`sign_minutes` los rellena desde `auth.uid()` —nunca desde algo que mande el
navegador— y la firma del rol `teacher` queda marcada `sesion_verificada`
**solo si quien opera la sesión es la docente que convoca la reunión**; en
cualquier otro caso queda `presencial_atestiguada`. La auditoría de
`minutes.signed` registra además el método de cada firma.

Con eso, la firma del rol `teacher` pasa de «alguien escribió este nombre» a
«la sesión verificada de esta persona firmó esta versión del acta a esta hora».

Las firmas anteriores a la migración se quedan con el valor por defecto, que es
el correcto: se capturaron así. No se reescribe el pasado para que encaje con la
regla nueva.

Comprobado en `supabase/tests/security/0007_signature_identity.sql`, 12 casos.
Dos de ellos intentan modificar los valores **con los privilegios del dueño de
la tabla**, no solo desde la Data API: si se probara solo desde ahí, la negativa
vendría de que `authenticated` no tiene `UPDATE`, y eso no demostraría nada
sobre el disparador.

Del lado de la interfaz, conviene además una **reautenticación en el momento de
firmar** cuando la sesión lleva abierta más de un rato: firmar no debería ser
igual de barato que pulsar cualquier otro botón.

> **Pendiente de decisión:** guardar o no un hash de la IP. Añade trazabilidad y
> añade un dato personal más. La inclinación es **no guardarlo** salvo que la
> revisión jurídica lo pida.

### 3.2 Representantes — el problema real

Los representantes **no tienen cuenta** en la aplicación. `representatives` ni
siquiera tiene columna de institución (su aislamiento se consigue por el rodeo
`student_representatives → students`, y está comprobado). Atar su firma a una
identidad verificada exige darles algún tipo de credencial, y ahí todas las
opciones tienen coste o fricción:

| Opción | Qué prueba | Coste | Veredicto |
| --- | --- | --- | --- |
| **Código de un solo uso por correo** (Supabase Auth, `signInWithOtp`) | Control de esa cuenta de correo | Ninguno en licencias; necesita un emisor de correo | **Recomendada**, con reservas (§3.3) |
| Código de un solo uso por SMS | Control de ese número | Por mensaje | **Descartada**: cuesta dinero |
| Firma electrónica certificada | Identidad acreditada | Por certificado | Fuera de alcance; decisión institucional |
| Código generado en pantalla y dictado | Presencia en la sala | Ninguno | Aporta poco: prueba presencia, que ya se da por supuesta |
| **Presencial atestiguada por la docente** (lo de hoy) | Nada, técnicamente | Ninguno | Es el estado actual; hay que **registrarlo como tal** |

### 3.3 Sobre los códigos de un solo uso, sin contratar nada

Supabase Auth trae el mecanismo incorporado: `signInWithOtp` envía un código al
correo y lo valida. No hay que programar la criptografía ni contratar un
servicio de verificación. Dos obstáculos reales, y ninguno es de programación:

1. **Hace falta un emisor de correo.** El SMTP de cortesía de Supabase tiene
   límites estrictos y su documentación desaconseja usarlo en producción. En el
   proyecto ya está previsto Resend, pero hoy figura como `missing`. Su plan
   gratuito existe; usarlo no es contratar nada, pero **alta y verificación de
   dominio son decisión suya**.
2. **Hace falta el correo del representante, y que lo lea en ese momento.** En
   una reunión presencial, pedir a una madre que abra su correo para firmar un
   acta añade una fricción que puede acabar en «fírmelo usted por mí», que es
   exactamente lo que se quería evitar.

**Recomendación para el piloto:** implementar el código de un solo uso como
**opcional y por acta**, no obligatorio. Cuando se usa, la firma queda marcada
como verificada por correo; cuando no, queda marcada como **presencial
atestiguada por la docente**. Lo que no debe pasar es que las dos se vean igual
en el PDF y en la auditoría.

```sql
ALTER TABLE public.signatures
  ADD COLUMN verification_method text NOT NULL DEFAULT 'presencial_atestiguada'
    CHECK (verification_method IN ('presencial_atestiguada', 'codigo_correo', 'sesion_verificada'));
```

Que el acta diga cómo se verificó cada firma es, probablemente, más valioso
para la institución que verificarlas todas de la misma manera: convierte una
ambigüedad en un dato.

## 4. Suplantación, reutilización y modificación

| Riesgo | Estado |
| --- | --- |
| Modificar una firma ya registrada | **Cubierto** por `protect_finalized_signatures` |
| Borrar una firma para rehacerla | **Cubierto**: el disparador vigila también el `DELETE` |
| Insertar una firma saltándose la aplicación | **Cubierto**: `authenticated` no tiene `INSERT`; solo `sign_minutes` |
| Firmar dos veces con el mismo rol | **Cubierto** por el índice único |
| Reutilizar una firma en otro texto | **Cubierto**: reabrir descarta las firmas |
| Firmar un acta de otra institución | **Cubierto**: comprobado por la API con dos instituciones |
| Repetir la llamada con contenido distinto | **Cubierto**: idempotencia honesta, se rechaza |
| **Que quien firma no sea quien dice ser** | **No cubierto.** Es §3 |

Siete de ocho están cerradas en la base de datos. La octava es la que no se
cierra con código.

## 5. Coste y decisiones pendientes

**Coste adicional de lo propuesto: cero en licencias.** `signed_by`,
`verification_method` y la reautenticación al firmar se hacen con lo que ya
hay. El código por correo necesita un emisor; el plan gratuito de Resend
cubriría un piloto.

Decisiones que no me corresponden:

1. **¿El acta necesita firma electrónica certificada?** Si la respuesta es sí,
   lo demás es secundario y hay que presupuestar certificados.
2. **¿Se da de alta el emisor de correo** para los códigos de un solo uso?
3. **¿Se registra un hash de la IP** al firmar?
4. **¿Se aceptan firmas presenciales atestiguadas** en el piloto, marcadas como
   tales?

Mientras 1 y 2 no se decidan, lo implementable sin preguntar era §3.1 —atar la
firma del personal docente a su sesión verificada— y el campo
`verification_method`, que no cambia lo que la aplicación hace pero sí lo que
el acta es capaz de declarar. **Las dos cosas están hechas** y probadas en
local; la migración remota espera autorización.

Lo que queda, por orden de valor:

1. **Mostrar el método de verificación en el PDF y en la pantalla de firmas.**
   Hoy el dato se registra pero no se enseña, y un dato que no se ve no informa
   a nadie. Es trabajo de interfaz, sin decisiones pendientes.
2. **Reautenticación al firmar** cuando la sesión lleva mucho abierta.
3. **El código de un solo uso**, cuando se decida el emisor de correo.
