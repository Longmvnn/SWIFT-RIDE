create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select auth.role() = 'service_role'
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.drivers (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  is_active boolean not null default true,
  is_online boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.enforce_driver_status()
returns trigger
language plpgsql
as $$
begin
  if new.is_active = false then
    new.is_online = false;
  end if;

  if not public.is_admin() then
    if auth.uid() is distinct from old.id then
      raise exception 'You can only update your own driver record.';
    end if;

    if new.full_name is distinct from old.full_name
      or new.email is distinct from old.email
      or new.is_active is distinct from old.is_active then
      raise exception 'Only admins can change profile or activation fields.';
    end if;

    if new.is_online = true and old.is_active = false then
      raise exception 'Your admin must enable you before you can go online.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists drivers_set_updated_at on public.drivers;
create trigger drivers_set_updated_at
before update on public.drivers
for each row
execute function public.set_updated_at();

drop trigger if exists drivers_enforce_driver_status on public.drivers;
create trigger drivers_enforce_driver_status
before update on public.drivers
for each row
execute function public.enforce_driver_status();

alter table public.drivers enable row level security;

drop policy if exists "admins can read drivers" on public.drivers;
create policy "admins can read drivers"
on public.drivers
for select
to authenticated
using (public.is_admin());

drop policy if exists "admins can update drivers" on public.drivers;
create policy "admins can update drivers"
on public.drivers
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "drivers can read own record" on public.drivers;
create policy "drivers can read own record"
on public.drivers
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "drivers can update own status" on public.drivers;
create policy "drivers can update own status"
on public.drivers
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'drivers'
  ) then
    alter publication supabase_realtime add table public.drivers;
  end if;
end
$$;
