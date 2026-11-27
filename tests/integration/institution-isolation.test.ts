import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DOCUMENTS_BUCKET,
  adminClient,
  anonClient,
  cleanupFixture,
  createApprovedMeeting,
  fixtureIds,
  signedInClient,
  type Fixture,
} from "./local-stack";

/**
 * Aislamiento entre dos instituciones, comprobado **por la API de datos**.
 *
 * Que la interfaz no enseñe algo no significa que no se pueda pedir. Aquí no se
 * pulsa nada: se habla con PostgREST con la sesión de una docente de la
 * institución A y se le pide, tabla por tabla, lo que pertenece a la B. Lo que
 * se quiere ver es que la base diga que no, no que el menú no tenga el enlace.
 *
 * Se mira con especial cuidado `representatives`, que **no tiene columna de
 * institución**: su aislamiento depende enteramente de un rodeo por
 * `student_representatives` y `students`. Una tabla cuyo aislamiento no está
 * escrito en sus propias columnas merece que se compruebe, no que se suponga.
 */
describe("aislamiento entre dos instituciones", () => {
  const a = fixtureIds();
  const b = fixtureIds();

  let admin: SupabaseClient;
  let docenteA: SupabaseClient;
  let fixtureA: Fixture;
  let fixtureB: Fixture;

  // Lo que pertenece a B y A no debería ver nunca.
  const representanteB = randomUUID();
  const documentoB = randomUUID();
  const compromisoB = randomUUID();
  const rutaDocumentoB = `${b.institution}/${randomUUID()}/ACTA-B-v1.pdf`;

  beforeAll(async () => {
    admin = adminClient();

    const sesionA = await signedInClient(a.email);
    docenteA = sesionA.client;
    fixtureA = await createApprovedMeeting(admin, a, sesionA.userId);

    const sesionB = await signedInClient(b.email);
    fixtureB = await createApprovedMeeting(admin, b, sesionB.userId);

    const debe = async (etiqueta: string, promesa: PromiseLike<{ error: unknown }>) => {
      const { error } = await promesa;
      if (error) throw new Error(`${etiqueta}: ${(error as { message?: string }).message}`);
    };

    // Un representante de B, enlazado a su estudiante.
    await debe(
      "representante B",
      admin.from("representatives").insert({
        id: representanteB,
        full_name: "Representante reservado de B",
        email: `rep-b-${representanteB}@test.invalid`,
        phone: "0999999999",
      }),
    );
    await debe(
      "vínculo B",
      admin
        .from("student_representatives")
        .insert({ student_id: b.student, representative_id: representanteB, relationship: "padre" }),
    );

    // Un documento y un compromiso de B.
    await debe(
      "documento B",
      admin.from("documents").insert({
        id: documentoB,
        minutes_id: fixtureB.minutes,
        meeting_id: fixtureB.meeting,
        storage_path: rutaDocumentoB,
        document_code: "ACTA-B-RESERVADA",
        sha256: "b".repeat(64),
        version: 1,
        generation_fingerprint: "f".repeat(64),
        kind: "final",
      }),
    );
    await debe(
      "compromiso B",
      admin.from("commitment_tracking").insert({
        id: compromisoB,
        institution_id: b.institution,
        meeting_id: fixtureB.meeting,
        minutes_id: fixtureB.minutes,
        kind: "commitment",
        item_index: 0,
        description: "Compromiso reservado de la institución B.",
        responsible: "Representante de B",
        status: "pending",
      }),
    );
    await debe(
      "auditoría B",
      admin.from("audit_logs").insert({
        institution_id: b.institution,
        meeting_id: fixtureB.meeting,
        actor_id: fixtureB.teacherId,
        action: "minutes.generated",
      }),
    );
  }, 180_000);

  afterAll(async () => {
    await admin.from("commitment_tracking").delete().eq("institution_id", b.institution);
    await admin.from("documents").delete().eq("id", documentoB);
    await admin.from("student_representatives").delete().eq("representative_id", representanteB);
    await admin.from("representatives").delete().eq("id", representanteB);
    cleanupFixture(a);
    cleanupFixture(b);
  }, 180_000);

  /** Lee una tabla con la sesión de A y devuelve cuántas filas de B aparecen. */
  const filasAjenas = async (tabla: string, columna: string, valor: string) => {
    const { data, error } = await docenteA.from(tabla).select("*").eq(columna, valor);
    // Un error también es una negativa válida; lo que no vale es devolver datos.
    if (error) return 0;
    return (data ?? []).length;
  };

  it("A no ve la institución de B", async () => {
    expect(await filasAjenas("institutions", "id", b.institution)).toBe(0);
  });

  it("A no ve a la docente de B", async () => {
    expect(await filasAjenas("profiles", "institution_id", b.institution)).toBe(0);
  });

  it("A no ve a los estudiantes de B", async () => {
    expect(await filasAjenas("students", "institution_id", b.institution)).toBe(0);
  });

  it("A no ve a los representantes de B", async () => {
    // La prueba que más importa: `representatives` no tiene columna de
    // institución y su aislamiento depende del rodeo por el estudiante.
    expect(await filasAjenas("representatives", "id", representanteB)).toBe(0);

    // Y tampoco por el camino largo: pedir la tabla entera no debe devolverlo.
    const { data } = await docenteA.from("representatives").select("id, full_name, email, phone");
    const identificadores = (data ?? []).map((fila) => fila.id as string);
    expect(identificadores).not.toContain(representanteB);
    expect(JSON.stringify(data ?? [])).not.toContain("Representante reservado de B");
  });

  it("A no ve los vínculos entre estudiantes y representantes de B", async () => {
    expect(await filasAjenas("student_representatives", "student_id", b.student)).toBe(0);
  });

  it("A no ve las reuniones de B", async () => {
    expect(await filasAjenas("meetings", "institution_id", b.institution)).toBe(0);
    expect(await filasAjenas("meetings", "id", fixtureB.meeting)).toBe(0);
  });

  it("A no ve las actas de B", async () => {
    expect(await filasAjenas("minutes", "meeting_id", fixtureB.meeting)).toBe(0);
    expect(await filasAjenas("minutes", "id", fixtureB.minutes)).toBe(0);
  });

  it("A no ve las firmas de B", async () => {
    expect(await filasAjenas("signatures", "minutes_id", fixtureB.minutes)).toBe(0);
  });

  it("A no ve los participantes ni la transcripción de B", async () => {
    expect(await filasAjenas("meeting_participants", "meeting_id", fixtureB.meeting)).toBe(0);
    expect(await filasAjenas("transcript_segments", "meeting_id", fixtureB.meeting)).toBe(0);
  });

  it("A no ve los documentos de B", async () => {
    expect(await filasAjenas("documents", "id", documentoB)).toBe(0);
    expect(await filasAjenas("documents", "meeting_id", fixtureB.meeting)).toBe(0);
  });

  it("A no ve los compromisos de B", async () => {
    expect(await filasAjenas("commitment_tracking", "institution_id", b.institution)).toBe(0);
    expect(await filasAjenas("commitment_tracking", "id", compromisoB)).toBe(0);
  });

  it("A no ve la auditoría de B", async () => {
    expect(await filasAjenas("audit_logs", "institution_id", b.institution)).toBe(0);
  });

  it("A no puede descargar el PDF de B", async () => {
    const { data, error } = await docenteA.storage.from(DOCUMENTS_BUCKET).download(rutaDocumentoB);
    expect(error !== null || data === null).toBe(true);
  });

  it("A no puede escribir en la institución de B", async () => {
    // Crear una reunión en la institución ajena.
    const reunion = await docenteA.from("meetings").insert({
      id: randomUUID(),
      institution_id: b.institution,
      teacher_id: fixtureA.teacherId,
      student_id: b.student,
      title: "Intento de intrusión",
      status: "scheduled",
    });
    expect(reunion.error).not.toBeNull();

    // Apropiarse de una reunión de B moviéndola a la institución propia.
    const robo = await docenteA
      .from("meetings")
      .update({ institution_id: a.institution })
      .eq("id", fixtureB.meeting);
    expect(robo.error !== null || (robo.count ?? 0) === 0).toBe(true);

    const { data } = await admin.from("meetings").select("institution_id").eq("id", fixtureB.meeting).single();
    expect(data!.institution_id).toBe(b.institution);
  });

  it("A no puede enlazar a un representante de B con un estudiante propio", async () => {
    // Si esto funcionara, A leería los datos del representante de B por el
    // rodeo legítimo, sin romper ninguna política de lectura.
    const { error } = await docenteA
      .from("student_representatives")
      .insert({ student_id: a.student, representative_id: representanteB, relationship: "madre" });
    expect(error).not.toBeNull();

    const { count } = await admin
      .from("student_representatives")
      .select("student_id", { count: "exact", head: true })
      .eq("representative_id", representanteB)
      .eq("student_id", a.student);
    expect(count).toBe(0);
  });

  it("la clave publicable sin sesión no ve nada de ninguna de las dos", async () => {
    const anonimo = anonClient();
    for (const tabla of ["institutions", "profiles", "students", "representatives", "meetings", "documents"]) {
      const { data, error } = await anonimo.from(tabla).select("*").limit(5);
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
  });
});
