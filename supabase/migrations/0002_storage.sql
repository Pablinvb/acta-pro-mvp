-- Bucket privado para las actas en PDF.
-- No se crea ninguna política de acceso público: la descarga pasa siempre por
-- la ruta autenticada /api/documents/download/[documentId], que comprueba la
-- sesión y la institución antes de leer el archivo con la service role key.

insert into storage.buckets (id, name, public)
values ('acta-documents', 'acta-documents', false)
on conflict (id) do update set public = false;
