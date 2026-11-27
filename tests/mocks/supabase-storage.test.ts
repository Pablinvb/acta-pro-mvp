
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "@/lib/data/supabase-repository";

function setup() {
  const upload = vi.fn();
  const download = vi.fn();

  const admin = {
    storage: {
      from: vi.fn(() => ({ upload, download })),
    },
  } as unknown as SupabaseClient;

  const db = {} as SupabaseClient;
  const repository = new SupabaseRepository(db, admin);

  return { repository, upload, download };
}

describe("Supabase: almacenamiento seguro de PDF", () => {
  const path = "test/document.pdf";
  const bytes = new TextEncoder().encode("PDF original");

  it("guarda archivos nuevos sin permitir sobrescritura", async () => {
    const { repository, upload, download } = setup();

    upload.mockResolvedValue({ error: null });

    await expect(
      repository.putDocumentFile(path, bytes)
    ).resolves.toBe(path);

    expect(upload).toHaveBeenCalledWith(path, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });

    expect(download).not.toHaveBeenCalled();
  });

  it("reutiliza un archivo existente si es idéntico", async () => {
    const { repository, upload, download } = setup();

    upload.mockResolvedValue({
      error: { message: "Already exists" },
    });

    download.mockResolvedValue({
      data: new Blob([bytes]),
      error: null,
    });

    await expect(
      repository.putDocumentFile(path, bytes)
    ).resolves.toBe(path);
  });

  it("rechaza un archivo existente con contenido diferente", async () => {
    const { repository, upload, download } = setup();

    upload.mockResolvedValue({
      error: { message: "Already exists" },
    });

    download.mockResolvedValue({
      data: new Blob(["PDF alterado"]),
      error: null,
    });

    await expect(
      repository.putDocumentFile(path, bytes)
    ).rejects.toThrow("Conflicto de integridad");
  });

  it("rechaza una subida fallida sin archivo recuperable", async () => {
    const { repository, upload, download } = setup();

    upload.mockResolvedValue({
      error: { message: "Storage unavailable" },
    });

    download.mockResolvedValue({
      data: null,
      error: { message: "Not found" },
    });

    await expect(
      repository.putDocumentFile(path, bytes)
    ).rejects.toThrow("Storage unavailable");
  });
});
