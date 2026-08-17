import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Camino feliz completo en modo demostración:
 * login → participantes → consentimiento → transcripción → hablantes → acta →
 * firmas → PDF → repositorio.
 *
 * No usa micrófono real: emplea el plan B de la demostración, que carga la
 * transcripción ficticia y la rotula como simulación.
 */

const TEACHER_EMAIL = "ana.perez@demo.actapro.ec";
const TEACHER_PASSWORD = "demo1234";

// El repositorio de demostración vive en memoria del servidor: se reinicia
// antes de cada prueba para partir siempre del mismo escenario semilla.
test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/demo/reset");
  expect(response.ok()).toBe(true);
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo institucional").fill(TEACHER_EMAIL);
  await page.getByLabel("Contraseña").fill(TEACHER_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Sus reuniones y actas" })).toBeVisible();
}

/** Dibuja un trazo continuo dentro de un área de firma. */
async function drawSignature(page: Page, canvas: Locator) {
  // `page.mouse` no desplaza la página: si el área queda fuera de la ventana,
  // los eventos caen en otro elemento y el trazo nunca llega al canvas.
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("No se pudo ubicar el área de firma.");

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 8 });
  await page.mouse.up();
}

test("flujo completo: de la reunión al acta firmada y archivada", async ({ page }) => {
  await login(page);

  await test.step("abrir la reunión de demostración", async () => {
    await page.getByRole("link", { name: /Seguimiento académico — Juan Pérez/ }).first().click();
    await expect(page.getByRole("heading", { name: /Seguimiento académico/ })).toBeVisible();
  });

  await test.step("confirmar participantes", async () => {
    await page.getByRole("link", { name: /Continuar en «Participantes»/ }).click();
    await expect(page.getByRole("heading", { name: "Confirme quiénes están presentes" })).toBeVisible();

    await page.getByRole("checkbox", { name: /María López/ }).check();
    await page.getByRole("checkbox", { name: /Juan Pérez López/ }).check();
    await page.getByRole("button", { name: "Confirmar y continuar" }).click();

    await expect(page.getByRole("heading", { name: "Aviso de tratamiento de datos" })).toBeVisible();
  });

  await test.step("no se puede grabar sin consentimiento", async () => {
    await expect(page.getByRole("button", { name: "Iniciar grabación" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Registrar consentimiento" })).toBeDisabled();
  });

  await test.step("registrar consentimiento de todas las personas", async () => {
    for (const name of ["Ana Pérez", "María López", "Juan Pérez López"]) {
      await page.getByRole("checkbox", { name: new RegExp(name) }).check();
    }
    await page.getByRole("checkbox", { name: /leí el aviso en voz alta/ }).check();

    const button = page.getByRole("button", { name: "Registrar consentimiento" });
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.getByText("Consentimiento registrado")).toBeVisible();
    await expect(page.getByRole("button", { name: "Iniciar grabación" })).toBeVisible();
  });

  await test.step("cargar la transcripción de demostración", async () => {
    await page.getByRole("button", { name: "Cargar transcripción de demostración" }).click();
    await expect(page.getByText(/La identificación de voz no es biométrica/)).toBeVisible();
  });

  await test.step("asignar hablantes a personas reales", async () => {
    await page.getByLabel("Corresponde a").nth(0).selectOption({ label: "Ana Pérez" });
    await page.getByLabel("Corresponde a").nth(1).selectOption({ label: "María López" });
    await page.getByLabel("Corresponde a").nth(2).selectOption({ label: "Juan Pérez López" });

    await page.getByRole("button", { name: "Guardar asignación" }).click();
    await expect(page.getByText("Asignación guardada.")).toBeVisible();
  });

  await test.step("generar el borrador del acta", async () => {
    await page.getByRole("button", { name: "Generar borrador con IA" }).click();
    await expect(page.getByText("BORRADOR", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Acuerdos" })).toBeVisible();
  });

  await test.step("el borrador no inventa datos ausentes", async () => {
    await expect(page.getByText(/no consta/i).first()).toBeVisible();
  });

  await test.step("aceptar la sugerencia de lenguaje objetivo", async () => {
    const accept = page.getByRole("button", { name: "Aceptar sugerencia" }).first();
    await expect(accept).toBeVisible();
    await accept.click();
    await expect(page.getByRole("button", { name: "Quitar del acta" }).first()).toBeVisible();
  });

  await test.step("aprobar el acta", async () => {
    await page.getByRole("button", { name: /Aprobar acta y continuar a firmas/ }).click();
    await expect(page.getByRole("heading", { name: "Firmas manuscritas digitalizadas" })).toBeVisible();
  });

  await test.step("firmar en el mismo dispositivo", async () => {
    const canvases = page.getByRole("img", { name: /Área de firma/ });
    await expect(canvases).toHaveCount(2);

    await drawSignature(page, canvases.nth(0));
    await drawSignature(page, canvases.nth(1));

    const acceptances = page.getByRole("checkbox");
    const total = await acceptances.count();
    for (let index = 0; index < total; index += 1) {
      await acceptances.nth(index).check();
    }

    await page.getByRole("button", { name: "Firmar y generar PDF" }).click();
  });

  await test.step("el PDF queda generado con su huella", async () => {
    await expect(page.getByRole("heading", { name: "Documento generado" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("SHA-256 del archivo PDF")).toBeVisible();
    await expect(page.getByText(/^[0-9a-f]{64}$/).first()).toBeVisible();
  });

  await test.step("el acta aparece en el repositorio", async () => {
    await page.getByRole("link", { name: "Ver en el repositorio" }).click();
    await expect(page.getByText(/ACTA-\d{4}-[0-9A-F]{8}-v1/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Descargar PDF" })).toBeVisible();

    await page.getByRole("link", { name: "Repositorio", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Repositorio de actas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Juan Pérez López" })).toBeVisible();
  });

  await test.step("la auditoría conserva el recorrido completo", async () => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /Seguimiento académico — Juan Pérez/ }).first().click();

    const audit = page.getByRole("list", { name: "Historial de auditoría" });
    for (const action of [
      "Participantes confirmados",
      "Consentimiento registrado",
      "Transcripción recuperada del audio",
      "Hablantes asignados",
      "Borrador de acta generado",
      "Acta aprobada",
      "Acta firmada",
      "PDF generado",
    ]) {
      await expect(audit.getByText(action, { exact: true })).toBeVisible();
    }
  });
});
