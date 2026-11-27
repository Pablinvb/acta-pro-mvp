import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseRepository } from "@/lib/data/supabase-repository";
import { sha256Hex } from "@/lib/pdf/render";

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
 * El bucket de documentos, contra el almacenamiento local de verdad.
 *
 * Hasta ahora el comportamiento del almacenamiento solo estaba cubierto por
 * dobles de prueba, que confirman lo que uno cree que hace el servicio, no lo
 * que hace. Aquí se usa el bucket real del stack local.
 */
describe("almacenamiento privado de documentos", () => {
  const ids = fixtureIds();
  let fixture: Fixture;
  let admin: SupabaseClient;
  let user: SupabaseClient;
  let repository: SupabaseRepository;
  const paths: string[] = [];

  const tempPath = () => {
    const path = `${ids.institution}/${ids.student}/prueba-${randomUUID()}.pdf`;
    paths.push(path);
    return path;
  };

  beforeAll(async () => {
    admin = adminClient();
    const signedIn = await signedInClient(ids.email);
    user = signedIn.client;
    fixture = await createApprovedMeeting(admin, ids, signedIn.userId);
    repository = new SupabaseRepository(user, admin);
  }, 60_000);

  afterAll(async () => {
    if (paths.length > 0) await admin.storage.from(DOCUMENTS_BUCKET).remove(paths);
    cleanupFixture(ids);
  }, 60_000);

  it("el bucket existe y no es público", async () => {
    const { data, error } = await admin.storage.getBucket(DOCUMENTS_BUCKET);
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
  });

  it("guarda y recupera el archivo con el mismo hash", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    const path = tempPath();

    await repository.putDocumentFile(path, bytes);
    const recovered = await repository.getDocumentFile(path);

    expect(recovered).not.toBeNull();
    expect(sha256Hex(recovered!)).toBe(sha256Hex(bytes));
  });

  it("repetir la subida con los mismos bytes no es un error", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
    const path = tempPath();

    await repository.putDocumentFile(path, bytes);
    await expect(repository.putDocumentFile(path, bytes)).resolves.toBe(path);
  });

  it("subir otros bytes en la misma ruta se rechaza como conflicto", async () => {
    const path = tempPath();
    await repository.putDocumentFile(path, new Uint8Array([37, 80, 68, 70, 9]));

    await expect(
      repository.putDocumentFile(path, new Uint8Array([37, 80, 68, 70, 8])),
    ).rejects.toThrow(/integridad/i);
  });

  it("una sesión anónima no puede descargar del bucket", async () => {
    const path = tempPath();
    await repository.putDocumentFile(path, new Uint8Array([37, 80, 68, 70, 7]));

    const { data, error } = await anonClient().storage.from(DOCUMENTS_BUCKET).download(path);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("una sesión autenticada tampoco descarga directamente del bucket", async () => {
    // El acceso legítimo pasa por la ruta autenticada de la aplicación, que
    // comprueba institución y pertenencia. El bucket en sí no concede nada.
    const path = tempPath();
    await repository.putDocumentFile(path, new Uint8Array([37, 80, 68, 70, 6]));

    const { data, error } = await user.storage.from(DOCUMENTS_BUCKET).download(path);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("una sesión anónima no puede subir nada al bucket", async () => {
    const { error } = await anonClient()
      .storage.from(DOCUMENTS_BUCKET)
      .upload(`${ids.institution}/intruso-${randomUUID()}.pdf`, new Uint8Array([1, 2, 3]));
    expect(error).not.toBeNull();
  });

  it("el acta de la reunión de prueba quedó disponible para su docente", async () => {
    const record = await repository.getMinutes(fixture.minutes);
    expect(record?.status).toBe("approved");
  });
});
