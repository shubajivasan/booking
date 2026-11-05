-- Teacher accounts: a "teacher" role that sees only their own classes and can
-- ask to rename a batch. Each teacher account lists the teacher name(s) it
-- covers, exactly as they appear in the schedule (e.g. "Kalyani Joglekar").
-- Also login IDs, so anyone can sign in without an email or Google.
-- Run ONCE in Supabase → SQL Editor → New query → paste the CONTENTS → Run.
-- Safe to re-run.

alter table public.staff_users add column if not exists teacher_names text[];

-- Login IDs: teachers (or anyone) can sign in with a login ID and password
-- instead of an email or Google. Unique, not case sensitive.
alter table public.staff_users add column if not exists login_id text;
create unique index if not exists staff_users_login_id_unique on public.staff_users (lower(login_id));
-- An account with a login ID doesn't need an email.
alter table public.staff_users alter column email drop not null;

-- Allow the new role (replaces whatever role rule the table had).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.staff_users'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.staff_users drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.staff_users
  add constraint staff_users_role_check check (role in ('super_admin', 'admin', 'staff', 'teacher'));

select 'Teacher accounts ready' as status;
