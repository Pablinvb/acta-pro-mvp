-- Seguimiento de acuerdos y compromisos.
--
-- Las filas se derivan de la versión aprobada del acta al aprobarla. El estado
-- lo cambia únicamente la persona docente: el sistema no marca nada como
-- cumplido por su cuenta.

create table if not exists public.commitment_tracking (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  minutes_id uuid not null references public.minutes (id) on delete cascade,
  kind text not null check (kind in ('agreement', 'commitment')),
  item_index integer not null check (item_index >= 0),
  description text not null,
  responsible text,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Una sola fila por entrada del acta: resincronizar no duplica.
  unique (minutes_id, kind, item_index)
);

create index if not exists commitment_institution_idx
  on public.commitment_tracking (institution_id, due_date);
create index if not exists commitment_meeting_idx on public.commitment_tracking (meeting_id);

alter table public.commitment_tracking enable row level security;

create policy commitment_all on public.commitment_tracking
  for all to authenticated
  using (public.can_access_meeting(meeting_id))
  with check (public.can_access_meeting(meeting_id));
