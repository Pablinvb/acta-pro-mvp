import { createHash } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { leerMontaje, sembrarTranscripcion } from "./fixture";

/**
 * Recorrido funcional completo contra Supabase local y Anthropic real.
 *
 * Qué prueba este y no el de demostración: que la aplicación funciona contra
 * Postgres, el bucket y el modelo de verdad. El de demostración usa un
 * repositorio en memoria, de modo que no puede ver una consulta que el esquema
 * dejó de admitir, un permiso retirado ni un modelo que tarda más de lo que
 * dura la función.
 *
 * Un paso **no** pasa por la interfaz y conviene decirlo: la transcripción se
 * siembra en la base. El navegador no puede hablar por un micrófono, y el botón
 * de transcripción de demostración está desactivado a propósito con
 * `DEMO_MODE=false`. Todo lo demás se hace pulsando.
 */

const datos = leerMontaje();
const admin = createClient(datos.apiUrl, datos.serviceKey, { auth: { persistSession: false } });

async function dibujarFirma(page: Page, canvas: Locator) {
  await canvas.scrollIntoViewIfNeeded();
  const caja = await canvas.boundingBox();
  if (!caja) throw new Error("El área de firma no es visible.");
  await page.mouse.move(caja.x + caja.width * 0.2, caja.y + caja.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width * 0.4, caja.y + caja.height * 0.3, { steps: 8 });
  await page.mouse.move(caja.x + caja.width * 0.6, caja.y + caja.height * 0.7, { steps: 8 });
  await page.mouse.move(caja.x + caja.width * 0.8, caja.y + caja.height * 0.4, { steps: 8 });
  await page.mouse.up();
}

test("recorrido completo contra Supabase local y Anthropic real", async ({ page }) => {
  let meetingId = "";
  let minutesId = "";
  let documentId = "";
  let sha256 = "";

  await test.step("1. iniciar sesión", async () => {
    await page.goto("/login");
    await page.getByLabel("Correo institucional").fill(datos.correo);
    await page.getByLabel("Contraseña").fill(datos.contrasena);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByRole("heading", { name: /evidencia institucional/ })).toBeVisible();
  });

  await test.step("2. crear la reunión", async () => {
    await page.goto("/meetings/new");
    await page.getByLabel("Estudiante").selectOption({ index: 0 });
    await page.getByLabel("Título de la reunión").fill("Reunión de validación funcional");
    await page.getByLabel("Fecha y hora").fill("2026-12-01T09:30");
    await page.getByRole("button", { name: "Crear y continuar" }).click();

    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}/);
    meetingId = page.url().match(/\/meetings\/([0-9a-f-]{36})/)![1];
  });

  await test.step("3. confirmar participantes", async () => {
    await page.getByRole("link", { name: /Participantes/ }).first().click();
    await expect(page.getByRole("heading", { name: /Confirme quiénes están presentes/ })).toBeVisible();

    const casillas = page.getByRole("checkbox");
    const total = await casillas.count();
    for (let i = 0; i < total; i += 1) await casillas.nth(i).check();

    await page.getByRole("button", { name: "Confirmar y continuar" }).click();
    await expect(page.getByRole("heading", { name: /Aviso de tratamiento de datos/ })).toBeVisible();
  });

  await test.step("4. registrar el consentimiento", async () => {
    const casillas = page.getByRole("checkbox");
    const total = await casillas.count();
    for (let i = 0; i < total; i += 1) await casillas.nth(i).check();

    const boton = page.getByRole("button", { name: "Registrar consentimiento" });
    await expect(boton).toBeEnabled();
    await boton.click();
    await expect(page.getByText("Consentimiento registrado")).toBeVisible();
  });

  await test.step("5. incorporar la transcripción", async () => {
    const intervenciones = await sembrarTranscripcion(meetingId);
    expect(intervenciones).toBeGreaterThan(0);
  });

  await test.step("6. generar el borrador con IA de verdad", async () => {
    await page.goto(`/meetings/${meetingId}/speakers`);

    const asignaciones = page.getByLabel("Corresponde a");
    const total = await asignaciones.count();
    expect(total).toBeGreaterThan(0);
    // Una persona distinta por hablante: la acción rechaza, con razón, que la
    // misma persona corresponda a dos. El índice 0 es «Seleccione una persona».
    for (let i = 0; i < total; i += 1) await asignaciones.nth(i).selectOption({ index: i + 1 });
    await page.getByRole("button", { name: "Guardar asignación" }).click();
    await expect(page.getByText("Asignación guardada.")).toBeVisible();

    await page.getByRole("button", { name: "Generar borrador con IA" }).click();
    // Es una llamada real al modelo: se le da margen, pero no infinito.
    await expect(page.getByText("BORRADOR", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "Acuerdos" })).toBeVisible();

    const { data } = await admin.from("minutes").select("id, generator").eq("meeting_id", meetingId).single();
    minutesId = data!.id as string;
    // La prueba vale si el acta la escribió el modelo, no el generador
    // determinístico de demostración.
    expect(data!.generator).toBe("anthropic");
  });

  await test.step("7. editar el acta", async () => {
    const resumen = page.getByLabel("Resumen");
    const original = await resumen.inputValue();
    expect(original.length).toBeGreaterThan(0);
    await resumen.fill(`${original} Añadido durante la validación funcional.`);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(/Guardado|guardados|Cambios/i).first()).toBeVisible();

    // Se mira la fila entera: el acta no vive en una columna `content` sino
    // repartida en `summary` y varias columnas `_json`, y la edición puede
    // aterrizar en `edited_content_json`.
    const { data, error } = await admin.from("minutes").select("*").eq("id", minutesId).single();
    expect(error).toBeNull();
    expect(JSON.stringify(data)).toContain("validación funcional");
  });

  await test.step("8. aprobar el acta", async () => {
    await page.getByRole("button", { name: /Aprobar acta y continuar a firmas/ }).click();
    await expect(page.getByRole("heading", { name: /Firmas manuscritas/ })).toBeVisible();
  });

  await test.step("9. firmar", async () => {
    const lienzos = page.getByRole("img", { name: /Área de firma/ });
    await expect(lienzos).toHaveCount(2);
    await dibujarFirma(page, lienzos.nth(0));
    await dibujarFirma(page, lienzos.nth(1));

    const casillas = page.getByRole("checkbox");
    const total = await casillas.count();
    for (let i = 0; i < total; i += 1) await casillas.nth(i).check();

    await page.getByRole("button", { name: "Firmar y generar PDF" }).click();
  });

  await test.step("10. el PDF queda generado con su huella", async () => {
    await expect(page.getByRole("heading", { name: "Documento generado" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("SHA-256 del archivo PDF")).toBeVisible();

    const { data } = await admin.from("documents").select("id, sha256, storage_path").eq("minutes_id", minutesId).single();
    documentId = data!.id as string;
    sha256 = data!.sha256 as string;
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);

    const archivo = await admin.storage.from("acta-documents").download(data!.storage_path as string);
    expect(archivo.error).toBeNull();
    const bytes = Buffer.from(await archivo.data!.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });

  await test.step("11. repetir la generación no crea un segundo documento", async () => {
    const respuesta = await page.request.post(`/api/documents/${minutesId}/pdf`);
    expect(respuesta.status()).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo.reused).toBe(true);
    expect(cuerpo.documentId).toBe(documentId);
    expect(cuerpo.sha256).toBe(sha256);

    const { count } = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("minutes_id", minutesId);
    expect(count).toBe(1);
  });

  await test.step("12. descargar el PDF y comprobar su huella", async () => {
    const respuesta = await page.request.get(`/api/documents/download/${documentId}`);
    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()["content-type"]).toBe("application/pdf");

    const bytes = Buffer.from(await respuesta.body());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });

  await test.step("13. el acta aparece en el repositorio", async () => {
    await page.goto("/repository");
    await expect(page.getByRole("heading", { name: /Repositorio/ })).toBeVisible();
    await expect(page.getByText(/ACTA-\d{4}-[0-9A-F]{8}/).first()).toBeVisible();
  });

  await test.step("14. los acuerdos pasan al seguimiento", async () => {
    await page.goto("/seguimiento");
    await expect(page.getByRole("heading", { name: /Seguimiento/ })).toBeVisible();

    const { count } = await admin
      .from("commitment_tracking")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", meetingId);
    expect(count).toBeGreaterThan(0);
  });

  await test.step("15. cerrar sesión", async () => {
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/\/login/);

    // Cerrar sesión tiene que cerrarla de verdad: una ruta privada ya no debe
    // responder con datos.
    const respuesta = await page.request.post(`/api/documents/${minutesId}/pdf`);
    expect([401, 403]).toContain(respuesta.status());
  });
});
