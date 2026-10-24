-- MoveFlow SQL schema for Supabase
-- Run this in the Supabase SQL editor with a database owner or service-role session.
-- This file intentionally does not bundle the secret key; the secret remains outside the browser.

create extension if not exists pgcrypto;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  role text not null check (role in ('admin','student','driver')) default 'student',
  full_name text not null,
  phone text,
  id_number text,
  n_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Provision the supplied Supabase Auth user as the initial MoveFlow admin.
-- The Auth user must already exist; this block never creates or changes a password.
do $$
declare
  v_auth_user auth.users%rowtype;
  v_company_id uuid;
begin
  select * into v_auth_user
  from auth.users
  where id = '1567f98b-481a-4810-b624-f5ca47e882d7'::uuid;

  if not found then
    raise exception 'Create the Supabase Auth user 1567f98b-481a-4810-b624-f5ca47e882d7 before running this setup';
  end if;

  insert into companies (name, code)
  values ('MoveFlow', 'moveflow')
  on conflict (code) do update set name = excluded.name
  returning id into v_company_id;

  insert into profiles (id, company_id, role, full_name, phone)
  values (
    v_auth_user.id,
    v_company_id,
    'admin',
    coalesce(nullif(v_auth_user.raw_user_meta_data ->> 'full_name', ''), 'MoveFlow Admin'),
    v_auth_user.phone
  )
  on conflict (id) do update
  set company_id = excluded.company_id,
      role = 'admin',
      full_name = case
        when profiles.full_name = '' then excluded.full_name
        else profiles.full_name
      end,
      phone = coalesce(profiles.phone, excluded.phone);
end;
$$;

create table if not exists universities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  city text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists regions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  city text,
  created_at timestamptz not null default now()
);

create table if not exists buses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  plate_number text not null,
  model text,
  capacity integer not null check (capacity > 0),
  seats_available integer not null default 0,
  status text not null default 'available' check (status in ('available','maintenance','offline')),
  created_at timestamptz not null default now()
);

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  phone text,
  license_number text,
  status text not null default 'active' check (status in ('active','inactive','on_leave')),
  created_at timestamptz not null default now()
);

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  route_name text not null,
  direction text not null check (direction in ('ذهاب','عودة')),
  trip_date date not null default current_date,
  departure_time text not null,
  capacity integer not null check (capacity > 0),
  booked integer not null default 0,
  available_seats integer not null default 0,
  is_booking_open boolean not null default true,
  status text not null default 'scheduled' check (status in ('scheduled','pending','closed','completed')),
  university_id uuid references universities(id),
  region_id uuid references regions(id),
  bus_id uuid references buses(id),
  driver_id uuid references drivers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  seats integer not null default 1 check (seats > 0),
  status text not null default 'confirmed' check (status in ('confirmed','cancelled','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, student_id)
);

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on profiles;
drop trigger if exists universities_updated_at on universities;
drop trigger if exists regions_updated_at on regions;
drop trigger if exists buses_updated_at on buses;
drop trigger if exists drivers_updated_at on drivers;
drop trigger if exists trips_updated_at on trips;
drop trigger if exists bookings_updated_at on bookings;

create trigger profiles_updated_at before update on profiles for each row execute procedure public.handle_updated_at();
create trigger universities_updated_at before update on universities for each row execute procedure public.handle_updated_at();
create trigger regions_updated_at before update on regions for each row execute procedure public.handle_updated_at();
create trigger buses_updated_at before update on buses for each row execute procedure public.handle_updated_at();
create trigger drivers_updated_at before update on drivers for each row execute procedure public.handle_updated_at();
create trigger trips_updated_at before update on trips for each row execute procedure public.handle_updated_at();
create trigger bookings_updated_at before update on bookings for each row execute procedure public.handle_updated_at();

create or replace function public.initialize_trip_seats()
returns trigger
language plpgsql
as $$
begin
  if new.booked = 0 and new.available_seats = 0 then
    new.available_seats := new.capacity;
  end if;
  return new;
end;
$$;

drop trigger if exists trips_initialize_seats on trips;
create trigger trips_initialize_seats
before insert on trips
for each row execute procedure public.initialize_trip_seats();

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.company_id from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.is_company_admin(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.company_id = target_company_id
      and p.role = 'admin'
  )
$$;

alter table companies enable row level security;
alter table profiles enable row level security;
alter table universities enable row level security;
alter table regions enable row level security;
alter table buses enable row level security;
alter table drivers enable row level security;
alter table trips enable row level security;
alter table bookings enable row level security;

drop policy if exists "companies_select_all_for_company_member" on companies;
create policy "companies_select_all_for_company_member" on companies
for select using (
  public.current_company_id() = companies.id
);

drop policy if exists "profiles_own_or_company_admin" on profiles;
create policy "profiles_own_or_company_admin" on profiles
for select using (
  id = auth.uid() or
  public.is_company_admin(company_id)
);

drop policy if exists "profiles_manage_own_or_admin" on profiles;
drop policy if exists "profiles_admin_insert" on profiles;

create policy "profiles_admin_insert" on profiles for insert with check (
  public.is_company_admin(company_id)
);

create policy "profiles_admin_update" on profiles for update
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

drop policy if exists "company_data_admin_or_member" on universities;
create policy "universities_company_member_view" on universities
for select using (public.current_company_id() = company_id);
create policy "universities_admin_manage" on universities
for all using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

drop policy if exists "regions_admin_or_company_member" on regions;
create policy "regions_company_member_view" on regions
for select using (public.current_company_id() = company_id);
create policy "regions_admin_manage" on regions
for all using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

drop policy if exists "buses_admin_or_company_member" on buses;
create policy "buses_company_member_view" on buses
for select using (public.current_company_id() = company_id);
create policy "buses_admin_manage" on buses
for all using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

drop policy if exists "drivers_admin_or_company_member" on drivers;
create policy "drivers_company_member_view" on drivers
for select using (public.current_company_id() = company_id);
create policy "drivers_admin_manage" on drivers
for all using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

drop policy if exists "trips_company_member_view" on trips;
create policy "trips_company_member_view" on trips
for select using (public.current_company_id() = company_id);

drop policy if exists "trips_admin_manage" on trips;
create policy "trips_admin_manage" on trips
for all using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

drop policy if exists "bookings_student_own_or_admin" on bookings;
create policy "bookings_student_own_or_admin" on bookings
for select using (
  student_id = auth.uid() or public.is_company_admin(company_id)
);

drop policy if exists "bookings_student_insert" on bookings;
drop policy if exists "bookings_student_delete_or_admin" on bookings;
create policy "bookings_no_direct_insert" on bookings for insert
with check (false);
create policy "bookings_no_direct_delete" on bookings for delete
using (false);

create or replace function public.create_booking(p_trip_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip public.trips%rowtype;
  v_booking public.bookings%rowtype;
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select p.company_id into v_company_id
  from public.profiles p
  where p.id = auth.uid() and p.role = 'student';
  if v_company_id is null then
    raise exception 'Student account required';
  end if;

  select * into v_trip
  from public.trips
  where id = p_trip_id and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Trip not found';
  end if;
  if not v_trip.is_booking_open or v_trip.status <> 'scheduled' then
    raise exception 'Booking is closed for this trip';
  end if;
  if v_trip.available_seats < 1 then
    raise exception 'No seats available';
  end if;

  insert into public.bookings(company_id, trip_id, student_id, seats, status)
  values (v_company_id, p_trip_id, auth.uid(), 1, 'confirmed')
  returning * into v_booking;

  update public.trips
  set booked = booked + 1,
      available_seats = available_seats - 1,
      status = case when available_seats = 1 then 'completed' else status end,
      is_booking_open = case when available_seats = 1 then false else is_booking_open end
  where id = p_trip_id;

  return v_booking;
end;
$$;

create or replace function public.cancel_booking(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.trips
  where id = p_trip_id and company_id = public.current_company_id()
  for update;
  if not found then
    raise exception 'Trip not found';
  end if;

  delete from public.bookings
  where trip_id = p_trip_id and student_id = auth.uid()
  returning * into v_booking;
  if not found then
    raise exception 'Active booking not found';
  end if;

  update public.trips
  set booked = greatest(booked - v_booking.seats, 0),
      available_seats = least(available_seats + v_booking.seats, capacity),
      status = case when status = 'completed' then 'scheduled' else status end,
      is_booking_open = case when status = 'completed' then true else is_booking_open end
  where id = p_trip_id;
end;
$$;

revoke all on function public.create_booking(uuid) from public;
revoke all on function public.cancel_booking(uuid) from public;
grant execute on function public.create_booking(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;

drop policy if exists "companies_admin_insert" on companies;
create policy "companies_admin_insert" on companies for insert
with check (false);

drop policy if exists "bookings_admin_manage" on bookings;
create policy "bookings_admin_manage" on bookings
for update using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

/*
The app creates bookings only through create_booking/cancel_booking so the trip
row lock, per-trip capacity check, and unique(trip_id, student_id) are enforced.
*/

create index if not exists idx_profiles_company_role on profiles(company_id, role);
create index if not exists idx_trips_company_date on trips(company_id, trip_date);
create index if not exists idx_bookings_trip_student on bookings(trip_id, student_id);
