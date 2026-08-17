import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { requireSession } from "@/lib/session";
import { formatDateTime, shortHash } from "@/lib/utils";

export const metadata: Metadata = { title: "Repositorio" };

export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: Promise<{ estudiante?: string }>;
}) {
  const { estudiante } = await searchParams;
  const { repository, institution } = await requireSession();

  const [students, documents] = await Promise.all([
    repository.listStudents(institution.id),
    repository.listDocuments(institution.id, estudiante ? { studentId: estudiante } : undefined),
  ]);

  // Agrupación por estudiante y, dentro de cada uno, por fecha descendente.
  const grouped = new Map<string, typeof documents>();
  for (const item of documents) {
    const key = item.student.id;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Repositorio de actas</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Actas generadas, organizadas por estudiante y fecha. Cada documento conserva su código, su versión y la
          huella SHA-256 del archivo.
        </p>
      </header>

      <nav aria-label="Filtro por estudiante" className="flex flex-wrap gap-2">
        <Link
          href="/repository"
          className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
            estudiante ? "border-line-strong text-ink-muted hover:bg-canvas" : "border-navy-100 bg-navy-50 text-navy-600"
          }`}
        >
          Todos
        </Link>
        {students.map((student) => (
          <Link
            key={student.id}
            href={`/repository?estudiante=${student.id}`}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              estudiante === student.id
                ? "border-navy-100 bg-navy-50 text-navy-600"
                : "border-line-strong text-ink-muted hover:bg-canvas"
            }`}
          >
            {student.full_name}
          </Link>
        ))}
      </nav>

      {documents.length === 0 ? (
        <EmptyState
          title="Sin actas archivadas"
          description="Cuando firme un acta y genere su PDF, el documento quedará archivado aquí junto con su huella y su registro de auditoría."
          action={<ButtonLink href="/meetings">Ir a reuniones</ButtonLink>}
        />
      ) : (
        <div className="space-y-8">
          {[...grouped.entries()].map(([studentId, items]) => (
            <section key={studentId} aria-labelledby={`student-${studentId}`} className="space-y-3">
              <h2 id={`student-${studentId}`} className="text-lg font-semibold text-ink">
                {items[0].student.full_name}
                <span className="ml-2 text-sm font-normal text-ink-muted">
                  {items[0].student.grade ?? ""} {items[0].student.section ?? ""}
                </span>
              </h2>
              <ul className="grid gap-3">
                {items.map(({ document, meeting }) => (
                  <li key={document.id}>
                    <Link
                      href={`/repository/${document.id}`}
                      className="block rounded-card border border-line bg-surface px-5 py-4 transition-colors hover:border-navy-100 hover:bg-navy-50/40"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{meeting.title}</p>
                          <p className="mt-1 text-sm text-ink-muted">{formatDateTime(document.created_at)}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="info">{document.document_code}</Badge>
                          {document.sent_at ? <Badge tone="verified">Enviada</Badge> : null}
                        </div>
                      </div>
                      <p className="mt-3 font-mono text-xs text-ink-subtle">
                        SHA-256 {shortHash(document.sha256)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
