create schema acta_legacy_20261124; revoke all on schema acta_legacy_20261124 from public, anon, authenticated, service_role;
alter table public.teachers set schema acta_legacy_20261124;
alter table public.students set schema acta_legacy_20261124;
alter table public.representatives set schema acta_legacy_20261124;
alter table public.student_representatives set schema acta_legacy_20261124;
alter table public.meetings set schema acta_legacy_20261124;
alter table public.participants set schema acta_legacy_20261124;
alter table public.transcript_segments set schema acta_legacy_20261124;
alter table public.meeting_analyses set schema acta_legacy_20261124;
alter table public.language_findings set schema acta_legacy_20261124;
alter table public.minutes set schema acta_legacy_20261124;
alter table public.signatures set schema acta_legacy_20261124;
alter table public.documents set schema acta_legacy_20261124;
alter table public.follow_ups set schema acta_legacy_20261124;
alter table public.audit_logs set schema acta_legacy_20261124;
-- ACTA PRO — esquema inicial
-- Convenciones:
-- * Toda tabla con datos institucionales tiene Row Level Security.
-- * El acceso se resuelve por institución del perfil autenticado.
-- * La transcripción original es inmutable: las correcciones viven como
--   versiones del acta, no como ediciones del texto transcrito.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- catálogos

create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null default 'teacher' check (role in ('teacher', 'admin')),
  institution_id uuid not null references public.institutions (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists profiles_institution_idx on public.profiles (institution_id);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  external_id text,
  full_name text not null,
  grade text,
  section text,
  active boolean not null default true,
  unique (institution_id, external_id)
);

create index if not exists students_institution_idx on public.students (institution_id);

create table if not exists public.representatives (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text
);

create table if not exists public.student_representatives (
  student_id uuid not null references public.students (id) on delete cascade,
  representative_id uuid not null references public.representatives (id) on delete cascade,
  relationship text,
  primary key (student_id, representative_id)
);

-- ---------------------------------------------------------------- reuniones

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  title text not null,
  reason text,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'ready', 'recording', 'processing', 'draft', 'approved', 'signed', 'sent')),
  source text not null default 'manual' check (source in ('manual', 'mock_runachay', 'google_calendar')),
  google_event_id text,
  created_at timestamptz not null default now(),
  unique (institution_id, google_event_id)
);

create index if not exists meetings_teacher_idx on public.meetings (teacher_id, scheduled_at desc);
create index if not exists meetings_student_idx on public.meetings (student_id);

create table if not exists public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  participant_type text not null check (participant_type in ('teacher', 'representative', 'student', 'other')),
  participant_ref_id uuid,
  display_name text not null,
  speaker_label text,
  consent_status text not null default 'pending' check (consent_status in ('pending', 'granted', 'declined')),
  consent_at timestamptz,
  consent_text_version text
);

create index if not exists participants_meeting_idx on public.meeting_participants (meeting_id);

-- Identificador de texto estable (<meeting_id>-seg-NN) para poder citarlo
-- desde el acta sin depender del orden de inserción.
create table if not exists public.transcript_segments (
  id text primary key,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  speaker_label text not null,
  start_seconds double precision not null check (start_seconds >= 0),
  end_seconds double precision not null,
  text text not null,
  confidence double precision,
  is_final boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_seconds >= start_seconds)
);

create index if not exists segments_meeting_idx on public.transcript_segments (meeting_id, start_seconds);

-- ---------------------------------------------------------------- actas

create table if not exists public.minutes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  summary text not null default '',
  meeting_reason text,
  topics_json jsonb not null default '[]'::jsonb,
  facts_json jsonb not null default '[]'::jsonb,
  agreements_json jsonb not null default '[]'::jsonb,
  commitments_json jsonb not null default '[]'::jsonb,
  follow_up_json jsonb not null default '[]'::jsonb,
  pending_items_json jsonb not null default '[]'::jsonb,
  contradictions_json jsonb not null default '[]'::jsonb,
  language_flags_json jsonb not null default '[]'::jsonb,
  review_warnings_json jsonb not null default '[]'::jsonb,
  -- Capa de edición humana: el borrador de la IA se conserva intacto arriba.
  edited_content_json jsonb,
  accepted_language_flags integer[] not null default '{}',
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  generator text not null default 'anthropic' check (generator in ('anthropic', 'demo')),
  model text,
  unique (meeting_id, version)
);

create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  minutes_id uuid not null references public.minutes (id) on delete cascade,
  signer_name text not null,
  signer_role text not null check (signer_role in ('teacher', 'representative', 'student', 'other')),
  signature_path text not null,
  signed_at timestamptz not null default now(),
  acceptance_text_version text not null
);

create index if not exists signatures_minutes_idx on public.signatures (minutes_id);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  minutes_id uuid not null references public.minutes (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  storage_path text not null,
  sha256 text not null,
  document_code text not null,
  version integer not null,
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists documents_meeting_idx on public.documents (meeting_id, created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  meeting_id uuid references public.meetings (id) on delete cascade,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_meeting_idx on public.audit_logs (meeting_id, created_at);

-- Credenciales de Google cifradas con AES-256-GCM en la aplicación.
-- Sin políticas de lectura: solo la service role key puede tocarlas.
create table if not exists public.google_credentials (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expiry_date bigint,
  scope text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS

-- SECURITY DEFINER evita la recursión de políticas al leer `profiles`.
create or replace function public.current_institution_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select institution_id from public.profiles where id = auth.uid();
$$;

create or replace function public.can_access_meeting(target_meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.meetings m
    join public.profiles p on p.id = auth.uid()
    where m.id = target_meeting
      and m.institution_id = p.institution_id
      and (m.teacher_id = p.id or p.role = 'admin')
  );
$$;

alter table public.institutions enable row level security;
alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.representatives enable row level security;
alter table public.student_representatives enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.minutes enable row level security;
alter table public.signatures enable row level security;
alter table public.documents enable row level security;
alter table public.audit_logs enable row level security;
alter table public.google_credentials enable row level security;

create policy institutions_read on public.institutions
  for select to authenticated
  using (id = public.current_institution_id());

create policy profiles_read on public.profiles
  for select to authenticated
  using (institution_id = public.current_institution_id());

create policy students_read on public.students
  for select to authenticated
  using (institution_id = public.current_institution_id());

create policy representatives_read on public.representatives
  for select to authenticated
  using (
    exists (
      select 1
      from public.student_representatives sr
      join public.students s on s.id = sr.student_id
      where sr.representative_id = representatives.id
        and s.institution_id = public.current_institution_id()
    )
  );

create policy student_representatives_read on public.student_representatives
  for select to authenticated
  using (
    exists (
      select 1 from public.students s
      where s.id = student_representatives.student_id
        and s.institution_id = public.current_institution_id()
    )
  );

create policy meetings_read on public.meetings
  for select to authenticated
  using (institution_id = public.current_institution_id());

create policy meetings_insert on public.meetings
  for insert to authenticated
  with check (institution_id = public.current_institution_id() and teacher_id = auth.uid());

create policy meetings_update on public.meetings
  for update to authenticated
  using (public.can_access_meeting(id))
  with check (public.can_access_meeting(id));

create policy participants_all on public.meeting_participants
  for all to authenticated
  using (public.can_access_meeting(meeting_id))
  with check (public.can_access_meeting(meeting_id));

create policy segments_read on public.transcript_segments
  for select to authenticated
  using (public.can_access_meeting(meeting_id));

create policy segments_insert on public.transcript_segments
  for insert to authenticated
  with check (public.can_access_meeting(meeting_id));

-- No existe política de UPDATE: la transcripción original es inmutable.
-- Solo puede reemplazarse por completo (delete + insert) al recuperarla.
create policy segments_delete on public.transcript_segments
  for delete to authenticated
  using (public.can_access_meeting(meeting_id));

create policy minutes_all on public.minutes
  for all to authenticated
  using (public.can_access_meeting(meeting_id))
  with check (public.can_access_meeting(meeting_id));

create policy signatures_all on public.signatures
  for all to authenticated
  using (
    exists (select 1 from public.minutes m where m.id = signatures.minutes_id and public.can_access_meeting(m.meeting_id))
  )
  with check (
    exists (select 1 from public.minutes m where m.id = signatures.minutes_id and public.can_access_meeting(m.meeting_id))
  );

create policy documents_read on public.documents
  for select to authenticated
  using (public.can_access_meeting(meeting_id));

create policy documents_insert on public.documents
  for insert to authenticated
  with check (public.can_access_meeting(meeting_id));

create policy documents_update on public.documents
  for update to authenticated
  using (public.can_access_meeting(meeting_id))
  with check (public.can_access_meeting(meeting_id));

create policy audit_read on public.audit_logs
  for select to authenticated
  using (institution_id = public.current_institution_id());

create policy audit_insert on public.audit_logs
  for insert to authenticated
  with check (institution_id = public.current_institution_id());

-- `google_credentials` no recibe ninguna política: queda accesible solo con la
-- service role key, desde el servidor.
;
