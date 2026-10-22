-- ระบบรายงานโครงการ ประจำปีการศึกษา 2569
-- Run ONCE in Supabase > SQL Editor as the project owner (postgres).
-- IMPORTANT: Create the Auth user first, then allowlist with the separate SQL in README.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'เจ้าหน้าที่',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.school_projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null check (length(trim(project_name)) between 1 and 250),
  coordinator text not null default '',
  description text not null default '',
  budget_plan numeric(14,2) not null default 0 check (budget_plan >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.school_projects(id) on delete cascade,
  activity_name text not null check (length(trim(activity_name)) between 1 and 250),
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.project_expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.school_projects(id) on delete cascade,
  activity_id uuid null references public.project_activities(id) on delete set null,
  funding_type text not null check (funding_type in (
    'เงินรายได้สถานศึกษา', 'เงินบริจาค', 'เงินค่าจัดการเรียนการสอน',
    'เงินค่าหนังสือเรียน', 'เงินค่าอุปกรณ์การเรียน',
    'เงินค่าเครื่องแบบนักเรียน', 'เงินค่ากิจกรรมพัฒนาผู้เรียน',
    'เงินโครงการอาหารกลางวัน','ไม่ใช้งบประมาณ'
  )),
  expense_date date not null default current_date,
  detail text not null default '',
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.school_projects(id) on delete cascade,
  activity_id uuid null references public.project_activities(id) on delete set null,
  original_name text not null,
  storage_path text not null unique,
  file_size bigint not null check (file_size between 1 and 15728640),
  created_at timestamptz not null default now()
);

create index if not exists idx_act_project on public.project_activities(project_id);
create index if not exists idx_exp_project_date on public.project_expenses(project_id, expense_date desc);
create index if not exists idx_exp_fund on public.project_expenses(funding_type);
create index if not exists idx_files_project on public.project_files(project_id);

-- Ensure no cross-project activity ID may be associated with a different project.
create or replace function private.check_activity_project()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.activity_id is not null and not exists (
    select 1 from public.project_activities a
    where a.id = new.activity_id and a.project_id = new.project_id
  ) then
    raise exception 'Activity does not belong to selected project';
  end if;
  return new;
end; $$;

drop trigger if exists trg_expense_activity on public.project_expenses;
create trigger trg_expense_activity before insert or update of activity_id, project_id
on public.project_expenses for each row execute function private.check_activity_project();

drop trigger if exists trg_file_activity on public.project_files;
create trigger trg_file_activity before insert or update of activity_id, project_id
on public.project_files for each row execute function private.check_activity_project();

create or replace function private.touch_project_updated()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_touch_project on public.school_projects;
create trigger trg_touch_project before update on public.school_projects
for each row execute function private.touch_project_updated();

-- Private, caller-sensitive authorizer. Not exposed as a public Data API RPC.
create or replace function private.is_school_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_members s
    where s.user_id = (select auth.uid()) and s.is_active
  );
$$;
revoke all on function private.is_school_staff() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_school_staff() to authenticated;

-- All data is private, accessible only to explicitly approved school staff.
alter table public.staff_members enable row level security;
alter table public.school_projects enable row level security;
alter table public.project_activities enable row level security;
alter table public.project_expenses enable row level security;
alter table public.project_files enable row level security;

revoke all on public.staff_members, public.school_projects, public.project_activities,
  public.project_expenses, public.project_files from anon;

-- Staff can see their own allowlist record; no user can modify the allowlist from the app.
drop policy if exists staff_read_self on public.staff_members;
create policy staff_read_self on public.staff_members for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.staff_members to authenticated;
revoke insert, update, delete on public.staff_members from authenticated;

-- Explicit CRUD policies for authorized staff only.
do $$
declare t text;
begin
  foreach t in array array['school_projects','project_activities','project_expenses','project_files'] loop
    execute format('drop policy if exists school_staff_select on public.%I', t);
    execute format('drop policy if exists school_staff_insert on public.%I', t);
    execute format('drop policy if exists school_staff_update on public.%I', t);
    execute format('drop policy if exists school_staff_delete on public.%I', t);
    execute format('create policy school_staff_select on public.%I for select to authenticated using ((select private.is_school_staff()))', t);
    execute format('create policy school_staff_insert on public.%I for insert to authenticated with check ((select private.is_school_staff()))', t);
    execute format('create policy school_staff_update on public.%I for update to authenticated using ((select private.is_school_staff())) with check ((select private.is_school_staff()))', t);
    execute format('create policy school_staff_delete on public.%I for delete to authenticated using ((select private.is_school_staff()))', t);
  end loop;
end $$;

grant select, insert, update, delete on public.school_projects,
  public.project_activities, public.project_expenses, public.project_files to authenticated;

-- Private PDF bucket (max 15 MB/file; PDF only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-pdfs-2569', 'project-pdfs-2569', false, 15728640, array['application/pdf'])
on conflict (id) do update set public = false,
  file_size_limit = 15728640, allowed_mime_types = array['application/pdf'];

drop policy if exists pdf_school_read on storage.objects;
drop policy if exists pdf_school_upload on storage.objects;
drop policy if exists pdf_school_delete on storage.objects;
create policy pdf_school_read on storage.objects for select to authenticated
using (bucket_id = 'project-pdfs-2569' and (select private.is_school_staff()));
create policy pdf_school_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-pdfs-2569'
  and (select private.is_school_staff())
  and (storage.extension(name) = 'pdf')
  and exists (
    select 1 from public.school_projects p
    where p.id::text = (storage.foldername(name))[1]
  )
);
create policy pdf_school_delete on storage.objects for delete to authenticated
using (bucket_id = 'project-pdfs-2569' and (select private.is_school_staff()));

-- The frontend never uses the service_role / secret key.
