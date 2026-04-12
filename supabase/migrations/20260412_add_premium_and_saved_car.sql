alter table public.profiles
add column if not exists premium_expires_at timestamptz;

create index if not exists profiles_premium_expires_at_idx
on public.profiles (premium_expires_at);

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
