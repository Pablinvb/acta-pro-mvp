# Transición a la firma verificada

> **Estado: preparado, no ejecutado.** Ninguno de los pasos de aquí se ha
> aplicado al proyecto remoto.

## 1. Dónde estamos

| | Produción (`6b08f931`) | Borrador (`6b09b964`) |
| --- | --- | --- |
| Firma | `public.sign_minutes` | `public.sign_minutes_verified` |
| Verificación de firmantes | ninguna | reautenticación docente + código al representante |
| CSP con nonce | no | **sí**, comprobado en el navegador |
| Generación en segundo plano | no | sí, función desplegada |

En la base de datos **ambas funciones existen y ambas están concedidas a
`authenticated`**. Eso es lo que permite que la versión antigua siga firmando
mientras el borrador se valida.

## 2. La propiedad que ordena todo lo demás

`acta_private.require_signing_proof()` **falla abierto**: cuando no encuentra un
desafío verificado, solo rechaza si alguien activó el indicador
`acta.require_verified_signing`, y eso únicamente lo hace
`sign_minutes_verified`.

De ahí se siguen dos cosas, y conviene tenerlas delante:

- **Hoy la verificación es opcional.** Cualquiera que llame a `sign_minutes`
  por la API de datos firma sin verificar a nadie. Está concedida a
  `authenticated`. No es una vía que use la aplicación, pero está abierta.
- **Tras aplicar `0002`, toda la verificación descansa sobre esa retirada de
  permiso.** No hay una segunda barrera. Si alguien devolviera el `EXECUTE`,
  la verificación desaparecería sin que nada fallara ruidosamente.

Por eso existe [`0003_fail_closed_signing.sql`](../supabase/fixes/0003_fail_closed_signing.sql):
convierte el disparador en fallo cerrado, de modo que devolver el permiso deje
de reabrir nada. Es el paso que hace que la recuperación de urgencia sea segura.

## 3. Requisito que no se puede saltar

> **Resend tiene que funcionar antes de aplicar `0002`.**

Después de retirar `sign_minutes`, la única vía de firma es
`sign_minutes_verified`, que exige un desafío verificado, que exige que el
representante reciba un código por correo. **Si el correo no sale, nadie puede
firmar: ni con el mecanismo nuevo ni con el viejo.**

Hoy `RESEND_API_KEY` está vacía en Netlify. Aplicar `0002` con el correo sin
configurar deja la aplicación sin capacidad de firmar. No es un riesgo teórico;
es la consecuencia directa.

## 4. Orden de la transición

Cada paso tiene una condición de salida. Si no se cumple, no se pasa al
siguiente.

| # | Paso | No seguir hasta que |
| --- | --- | --- |
| 1 | Configurar `RESEND_API_KEY` y `EMAIL_FROM` en producción | Un código de prueba llegue de verdad a una bandeja |
| 2 | Respaldo verificado del proyecto remoto | `verify-backup.mjs --contra-destino` en verde |
| 3 | **Promover el borrador** a producción | La aplicación cargue y el panel responda |
| 4 | Recorrido real: generar, verificar y **firmar un acta** | La firma quede con `docente_reautenticado` y `codigo_correo` |
| 5 | Aplicar `0002_activate_verified_signing.sql` | Su propia comprobación interna pase |
| 6 | Repetir una firma completa | Siga funcionando con la vía antigua ya retirada |
| 7 | Aplicar `0003_fail_closed_signing.sql` | Su comprobación interna pase |

Entre el paso 3 y el 5 hay una ventana en la que `sign_minutes` sigue concedida
aunque la aplicación ya no la use. Es deliberado: permite volver atrás sin
dejar a nadie sin firmar. Conviene que sea corta, no que no exista.

## 5. Recuperación, sin reabrir la puerta

La tentación, si algo falla tras el paso 5, es devolver el `EXECUTE` sobre
`sign_minutes` para «desbloquear la firma». **Eso reabre la vía sin
verificación**, y es justo lo que hay que no hacer.

| Qué falla | Qué hacer | Qué **no** hacer |
| --- | --- | --- |
| La aplicación promovida no carga | Volver a publicar el despliegue anterior. `0002` aún no se aplicó, así que la firma antigua sigue disponible | — |
| Falla algo tras aplicar `0002` | Arreglar hacia adelante. Si hay que volver al despliegue anterior, **la firma queda temporalmente indisponible**, y eso es preferible a firmar sin verificar | Devolver el `EXECUTE` sobre `sign_minutes` |
| El correo deja de salir | Tratarlo como incidencia de disponibilidad: nadie puede firmar hasta restablecerlo | Desactivar la verificación «mientras tanto» |
| Hace falta firmar con urgencia y el correo no va | Decisión de la institución, por escrito, con constancia en auditoría | Un atajo técnico silencioso |

Con `0003` aplicado, la última columna deja de ser un riesgo: aunque alguien
devuelva el permiso, sin desafío verificado no se firma.

## 6. Lo que `0003` arrastra consigo

Comprobado ensayándolo en la base local: **aplicar `0003` hace fallar tres
archivos de pruebas SQL** (`0001`, `0007` y `0008`), porque sus montajes firman
por la vía antigua sin desafío. No es un defecto de `0003`: es exactamente lo
que debe pasar.

Antes de aplicarlo en remoto hay que actualizar esos montajes para que creen un
desafío verificado, o marcar explícitamente que prueban el comportamiento
anterior. Si no, la suite se queda en rojo y deja de servir para nada.

## 7. Comprobación posterior

```bash
npm run test:security
```

Y contra el proyecto remoto, sin escribir nada:

```bash
node scripts/audit-remote-readonly.mjs
```

Lo que debe cumplirse al final:

- `authenticated` **no** ejecuta `sign_minutes`.
- `authenticated` **sí** ejecuta `sign_minutes_verified`.
- `anon` no ejecuta ninguna de las dos.
- `authenticated` no tiene `INSERT`, `UPDATE` ni `DELETE` sobre `signatures`.
- Una firma nueva sin desafío verificado se rechaza, también con los
  privilegios del dueño de la tabla.

Las cuatro primeras están probadas en
[`0008_verified_signing_activation.sql`](../supabase/tests/security/0008_verified_signing_activation.sql);
la quinta la comprueba el propio `0003` antes de confirmar.
