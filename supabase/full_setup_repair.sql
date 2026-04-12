-- Omnilots Supabase full setup + repair script
-- Safe to run multiple times.

create extension if not exists pgcrypto;

-- Profiles
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null check (char_length(trim(display_name)) between 1 and 120),
    points integer not null default 0 check (points >= 0),
    created_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists premium_expires_at timestamptz;

create index if not exists profiles_points_idx on public.profiles (points desc, created_at asc);
create index if not exists profiles_premium_expires_at_idx on public.profiles (premium_expires_at);

alter table public.profiles enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'profiles'
          and policyname = 'public can read profiles'
    ) then
        create policy "public can read profiles"
        on public.profiles
        for select
        using (true);
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'profiles'
          and policyname = 'users can update own profile'
    ) then
        create policy "users can update own profile"
        on public.profiles
        for update
        using (auth.uid() = id)
        with check (auth.uid() = id);
    end if;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        coalesce(
            nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
            nullif(split_part(new.email, '@', 1), ''),
            'User'
        )
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

insert into public.profiles (id, display_name)
select
    au.id,
    coalesce(
        nullif(trim(au.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(au.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(au.email, '@', 1), ''),
        'User'
    )
from auth.users au
on conflict (id) do nothing;

-- Parking reports
create table if not exists public.parking_reports (
    id uuid primary key default gen_random_uuid(),
    lot_name text not null check (char_length(trim(lot_name)) between 2 and 120),
    availability text not null check (availability in ('open', 'limited', 'full')),
    note text not null default '',
    reporter_latitude double precision not null check (reporter_latitude between -90 and 90),
    reporter_longitude double precision not null check (reporter_longitude between -180 and 180),
    distance_to_campus_meters double precision not null check (distance_to_campus_meters >= 0),
    created_at timestamptz not null default now()
);

alter table public.parking_reports
add column if not exists user_id uuid,
add column if not exists action_type text not null default 'observing',
add column if not exists fullness_level smallint;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'parking_reports_user_id_fkey'
    ) then
        alter table public.parking_reports
        add constraint parking_reports_user_id_fkey
        foreign key (user_id)
        references public.profiles(id)
        on delete set null;
    end if;
end;
$$;

update public.parking_reports
set fullness_level = 3
where fullness_level is null;

alter table public.parking_reports
alter column fullness_level set not null;

create index if not exists parking_reports_created_at_idx on public.parking_reports (created_at desc);
create index if not exists parking_reports_action_type_idx on public.parking_reports (action_type, created_at desc);
create index if not exists parking_reports_user_id_idx on public.parking_reports (user_id, created_at desc);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'parking_reports_action_type_check'
    ) then
        alter table public.parking_reports
        add constraint parking_reports_action_type_check
        check (action_type in ('parked', 'leaving', 'observing'));
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'parking_reports_fullness_level_check'
    ) then
        alter table public.parking_reports
        add constraint parking_reports_fullness_level_check
        check (fullness_level between 1 and 5);
    end if;
end;
$$;

alter table public.parking_reports enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'parking_reports'
          and policyname = 'public can read parking reports'
    ) then
        create policy "public can read parking reports"
        on public.parking_reports
        for select
        using (true);
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'parking_reports'
          and policyname = 'users can insert own parking reports'
    ) then
        create policy "users can insert own parking reports"
        on public.parking_reports
        for insert
        with check (auth.uid() = user_id);
    end if;
end;
$$;

create or replace function public.validate_parking_report_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    latest_observing_at timestamptz;
    submission_time timestamptz := coalesce(new.created_at, now());
begin
    if new.user_id is null then
        return new;
    end if;

    if new.action_type = 'observing' then
        select pr.created_at
        into latest_observing_at
        from public.parking_reports pr
        where pr.user_id = new.user_id
          and pr.action_type = 'observing'
        order by pr.created_at desc
        limit 1;

        if latest_observing_at is not null and submission_time < latest_observing_at + interval '1 hour' then
            raise exception 'Observing reports are limited to once per hour.';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists parking_reports_validate_submission on public.parking_reports;

create trigger parking_reports_validate_submission
before insert on public.parking_reports
for each row
execute function public.validate_parking_report_submission();

create or replace function public.increment_profile_points_on_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    points_to_add integer;
begin
    if new.user_id is null then
        return new;
    end if;

    points_to_add := case new.action_type
        when 'parked' then 2
        when 'leaving' then 2
        else 1
    end;

    update public.profiles
    set points = points + points_to_add
    where id = new.user_id;

    return new;
end;
$$;

drop trigger if exists on_parking_report_created on public.parking_reports;

create trigger on_parking_report_created
after insert on public.parking_reports
for each row
execute function public.increment_profile_points_on_report();

-- Push subscriptions
create table if not exists public.push_subscriptions (
    endpoint text primary key,
    user_id uuid not null references public.profiles(id) on delete cascade,
    p256dh_key text not null,
    auth_key text not null,
    expiration_time bigint,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id, updated_at desc);
create index if not exists push_subscriptions_active_idx on public.push_subscriptions (is_active, updated_at desc);

alter table public.push_subscriptions enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'push_subscriptions'
          and policyname = 'users can insert own push subscriptions'
    ) then
        create policy "users can insert own push subscriptions"
        on public.push_subscriptions
        for insert
        with check (auth.uid() = user_id);
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'push_subscriptions'
          and policyname = 'users can update own push subscriptions'
    ) then
        create policy "users can update own push subscriptions"
        on public.push_subscriptions
        for update
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id);
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'push_subscriptions'
          and policyname = 'users can delete own push subscriptions'
    ) then
        create policy "users can delete own push subscriptions"
        on public.push_subscriptions
        for delete
        using (auth.uid() = user_id);
    end if;
end;
$$;

create or replace function public.touch_push_subscriptions_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row
execute function public.touch_push_subscriptions_updated_at();

-- Saved parked car state
create table if not exists public.user_parking_state (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    parked_car_latitude double precision not null check (parked_car_latitude between -90 and 90),
    parked_car_longitude double precision not null check (parked_car_longitude between -180 and 180),
    parked_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.user_parking_state enable row level security;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'user_parking_state'
          and policyname = 'users can view own parking state'
    ) then
        create policy "users can view own parking state"
        on public.user_parking_state
        for select
        using (auth.uid() = user_id);
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'user_parking_state'
          and policyname = 'users can insert own parking state'
    ) then
        create policy "users can insert own parking state"
        on public.user_parking_state
        for insert
        with check (auth.uid() = user_id);
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'user_parking_state'
          and policyname = 'users can update own parking state'
    ) then
        create policy "users can update own parking state"
        on public.user_parking_state
        for update
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id);
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'user_parking_state'
          and policyname = 'users can delete own parking state'
    ) then
        create policy "users can delete own parking state"
        on public.user_parking_state
        for delete
        using (auth.uid() = user_id);
    end if;
end;
$$;

create or replace function public.touch_user_parking_state_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists user_parking_state_set_updated_at on public.user_parking_state;

create trigger user_parking_state_set_updated_at
before update on public.user_parking_state
for each row
execute function public.touch_user_parking_state_updated_at();

-- Premium purchase RPC used by /api/premium
create or replace function public.purchase_premium_months(
    p_user_id uuid,
    p_months integer,
    p_month_cost_points integer
)
returns table (
    remaining_points integer,
    premium_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    total_cost integer;
begin
    if p_user_id is null then
        raise exception 'User is required.';
    end if;

    if p_months is null or p_months < 1 or p_months > 24 then
        raise exception 'Months must be between 1 and 24.';
    end if;

    if p_month_cost_points is null or p_month_cost_points < 1 then
        raise exception 'Month cost must be a positive integer.';
    end if;

    total_cost := p_months * p_month_cost_points;

    update public.profiles
    set
        points = points - total_cost,
        premium_expires_at = greatest(coalesce(premium_expires_at, now()), now()) + make_interval(months => p_months)
    where id = p_user_id
      and points >= total_cost
    returning points, profiles.premium_expires_at
    into remaining_points, premium_expires_at;

    if not found then
        raise exception 'INSUFFICIENT_POINTS';
    end if;

    return next;
end;
$$;

revoke all on function public.purchase_premium_months(uuid, integer, integer) from public;
grant execute on function public.purchase_premium_months(uuid, integer, integer) to service_role;
