-- ACTA PRO — datos semilla de demostración.
-- Todas las personas aquí son ficticias. No use datos reales de menores.
--
-- El perfil docente requiere que exista antes el usuario en auth.users.
-- Cree la cuenta desde el panel de Supabase (Authentication → Add user) con
-- correo ana.perez@demo.actapro.ec y luego ejecute este archivo sustituyendo
-- el identificador si fuera necesario.
--
-- Los identificadores coinciden con src/lib/demo/seed-data.ts para que el modo
-- demostración y el modo con Supabase muestren el mismo escenario.

insert into public.institutions (id, name, address, created_at)
values (
  '11111111-1111-4111-8111-111111111111',
  'Unidad Educativa Demostración ACTA PRO',
  'Av. Amazonas y Naciones Unidas, Quito, Ecuador',
  '2026-01-08T13:00:00Z'
)
on conflict (id) do nothing;

-- Requiere que auth.users contenga este identificador.
insert into public.profiles (id, full_name, email, role, institution_id, created_at)
values (
  '22222222-2222-4222-8222-222222222222',
  'Ana Pérez',
  'ana.perez@demo.actapro.ec',
  'teacher',
  '11111111-1111-4111-8111-111111111111',
  '2026-01-08T13:00:00Z'
)
on conflict (id) do nothing;

insert into public.students (id, institution_id, external_id, full_name, grade, section, active)
values
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'DEMO-0001',
    'Juan Pérez López',
    '5.º EGB',
    'A',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333334',
    '11111111-1111-4111-8111-111111111111',
    'DEMO-0002',
    'Sofía Andrade Vera',
    '6.º EGB',
    'B',
    true
  )
on conflict (id) do nothing;

insert into public.representatives (id, full_name, email, phone)
values
  ('44444444-4444-4444-8444-444444444444', 'María López', 'maria.lopez@demo.actapro.ec', '+593 99 000 0001'),
  ('44444444-4444-4444-8444-444444444445', 'Carlos Andrade', 'carlos.andrade@demo.actapro.ec', '+593 99 000 0002')
on conflict (id) do nothing;

insert into public.student_representatives (student_id, representative_id, relationship)
values
  ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 'Madre'),
  ('33333333-3333-4333-8333-333333333334', '44444444-4444-4444-8444-444444444445', 'Padre')
on conflict do nothing;

insert into public.meetings (
  id, institution_id, teacher_id, student_id, title, reason, scheduled_at, status, source, created_at
)
values
  (
    '55555555-5555-4555-8555-555555555555',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    'Seguimiento académico — Juan Pérez',
    'Revisar el rendimiento en Matemáticas del segundo quimestre y acordar apoyos.',
    '2026-08-18T15:00:00Z',
    'scheduled',
    'manual',
    '2026-08-10T14:00:00Z'
  ),
  (
    '55555555-5555-4555-8555-555555555556',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333334',
    'Acompañamiento de convivencia — Sofía Andrade',
    'Conversar sobre la integración al grupo tras el cambio de sección.',
    '2026-08-20T14:30:00Z',
    'scheduled',
    'mock_runachay',
    '2026-08-11T16:20:00Z'
  ),
  (
    '55555555-5555-4555-8555-555555555557',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    'Entrega de resultados del primer quimestre — Juan Pérez',
    'Entrega de calificaciones y observaciones del primer quimestre.',
    '2026-06-24T15:00:00Z',
    'scheduled',
    'manual',
    '2026-06-18T13:00:00Z'
  )
on conflict (id) do nothing;
