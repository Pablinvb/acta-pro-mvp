import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseRepository } from "@/lib/data/supabase-repository";

import {
  adminClient,
  cleanupFixture,
  createApprovedMeeting,
  fixtureIds,
  signedInClient,
  type Fixture,
} from "./local-stack";

/**
 * Las consultas del repositorio que **incrustan** tablas relacionadas,
 * ejecutadas contra Supabase local.
 *
 * Existen por un fallo concreto que llegó a producción. La migración
 * `20261125212938` añadió claves foráneas compuestas por institución, con lo que
 * pasaron a haber **dos** caminos de `meetings` a `students`. PostgREST no elige
 * entre dos: responde `300` con «Could not embed because more than one
 * relationship was found», y el panel se cayó con un error de servidor.
 *
 * Nada lo detectó porque **ninguna prueba llamaba a estos métodos contra una
 * base de datos**. Las de integración cubrían almacenamiento, rutas de
 * documentos y permisos de la API; estas consultas, no. Un esquema que cambia
 * puede romper una consulta sin tocar una línea de código, de modo que la
 * consulta tiene que ejecutarse de verdad en algún sitio.
 */
describe("consultas con tablas incrustadas contra Supabase local", () => {
  const ids = fixtureIds();
  let fixture: Fixture;
  let admin: SupabaseClient;
  let repository: SupabaseRepository;

  beforeAll(async () => {
    admin = adminClient();
    const signedIn = await signedInClient(ids.email);
    fixture = await createApprovedMeeting(admin, ids, signedIn.userId);
    repository = new SupabaseRepository(signedIn.client, admin);

    // Un documento y un compromiso, para que las consultas tengan algo que
    // devolver: una consulta que acierta sobre cero filas no demuestra que la
    // incrustación funcione.
    const { error: errorDocumento } = await admin.from("documents").insert({
      id: randomUUID(),
      minutes_id: fixture.minutes,
      meeting_id: fixture.meeting,
      storage_path: `${ids.institution}/${fixture.meeting}/ACTA-PRUEBA-v1.pdf`,
      document_code: "ACTA-PRUEBA",
      sha256: "c".repeat(64),
      version: 1,
      generation_fingerprint: "e".repeat(64),
      kind: "final",
    });
    if (errorDocumento) throw new Error(`documento: ${errorDocumento.message}`);

    const { error: errorCompromiso } = await admin.from("commitment_tracking").insert({
      id: randomUUID(),
      institution_id: ids.institution,
      meeting_id: fixture.meeting,
      minutes_id: fixture.minutes,
      kind: "commitment",
      item_index: 0,
      description: "Reforzar lectura en casa durante dos semanas.",
      responsible: "Representante",
      status: "pending",
    });
    if (errorCompromiso) throw new Error(`compromiso: ${errorCompromiso.message}`);
  }, 120_000);

  afterAll(async () => {
    cleanupFixture(ids);
  }, 120_000);

  it("listDocuments incrusta la reunión y su estudiante", async () => {
    const filas = await repository.listDocuments(ids.institution);

    expect(filas.length).toBeGreaterThan(0);
    const fila = filas[0];
    expect(fila.document.document_code).toBe("ACTA-PRUEBA");
    expect(fila.meeting.id).toBe(fixture.meeting);
    // Lo que se rompió: el estudiante incrustado.
    expect(fila.student).not.toBeNull();
    expect(fila.student.id).toBe(ids.student);
    expect(fila.student.full_name).toContain("integración");
  });

  it("listDocuments filtra por estudiante sin perder la incrustación", async () => {
    const propias = await repository.listDocuments(ids.institution, { studentId: ids.student });
    expect(propias.length).toBeGreaterThan(0);
    expect(propias[0].student.id).toBe(ids.student);

    const ajenas = await repository.listDocuments(ids.institution, { studentId: randomUUID() });
    expect(ajenas).toEqual([]);
  });

  it("listCommitments incrusta la reunión y su estudiante", async () => {
    const filas = await repository.listCommitments(ids.institution);

    expect(filas.length).toBeGreaterThan(0);
    const fila = filas[0];
    expect(fila.commitment.meeting_id).toBe(fixture.meeting);
    expect(fila.meeting.id).toBe(fixture.meeting);
    expect(fila.student).not.toBeNull();
    expect(fila.student.id).toBe(ids.student);
  });

  it("listCommitments filtra por estudiante", async () => {
    const propias = await repository.listCommitments(ids.institution, { studentId: ids.student });
    expect(propias.length).toBeGreaterThan(0);

    const ajenas = await repository.listCommitments(ids.institution, { studentId: randomUUID() });
    expect(ajenas).toEqual([]);
  });

  it("getRepresentativesForStudent incrusta los representantes", async () => {
    const representante = randomUUID();
    // Se comprueba el error de cada inserción: un montaje que falla en silencio
    // deja la prueba midiendo cero filas y aprobando por el motivo equivocado.
    const creado = await admin.from("representatives").insert({
      id: representante,
      full_name: "Representante de integración",
      email: `rep-${representante}@test.invalid`,
    });
    expect(creado.error).toBeNull();

    const enlazado = await admin.from("student_representatives").insert({
      student_id: ids.student,
      representative_id: representante,
      relationship: "madre",
    });
    expect(enlazado.error).toBeNull();

    const filas = await repository.getRepresentativesForStudent(ids.student);

    expect(filas.length).toBeGreaterThan(0);
    expect(filas.some((fila) => fila.id === representante)).toBe(true);
  });

  it("una docente puede crear una reunión y recibirla de vuelta", async () => {
    // Esto se rompió en producción y ninguna prueba lo vio. La política de
    // lectura de `meetings` llama a `can_access_meeting(id)`, que es `STABLE` y
    // vuelve a consultar la tabla: dentro de un `INSERT ... RETURNING` no ve la
    // fila que se está insertando, de modo que la inserción entera se rechazaba
    // con «new row violates row-level security policy».
    const creada = await repository.createMeeting({
      institution_id: ids.institution,
      teacher_id: fixture.teacherId,
      student_id: ids.student,
      title: "Reunión creada por la docente",
      reason: null,
      scheduled_at: new Date("2026-12-01T14:30:00.000Z").toISOString(),
      source: "manual",
    });

    expect(creada.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(creada.title).toBe("Reunión creada por la docente");
    expect(creada.status).toBe("scheduled");
    expect(creada.institution_id).toBe(ids.institution);

    // Y existe de verdad, no solo en el valor devuelto.
    const { data } = await admin.from("meetings").select("id").eq("id", creada.id).maybeSingle();
    expect(data).not.toBeNull();
  });

  it("ninguna consulta del repositorio queda con una relación ambigua", async () => {
    // La red de seguridad general: si una migración futura añade otro camino
    // entre dos tablas que alguna consulta incrusta, esto falla aquí y no en
    // producción. Se ejecutan las tres consultas con incrustación que existen.
    await expect(repository.listDocuments(ids.institution)).resolves.toBeDefined();
    await expect(repository.listCommitments(ids.institution)).resolves.toBeDefined();
    await expect(repository.getRepresentativesForStudent(ids.student)).resolves.toBeDefined();
  });
});
