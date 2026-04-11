create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null check (char_length(trim(display_name)) between 1 and 120),
    points integer not null default 0 check (points >= 0),
    created_at timestamptz not null default now()
);

create index if not exists profiles_points_idx on public.profiles (points desc, created_at asc);

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

alter table public.parking_reports
add column if not exists user_id uuid references public.profiles(id) on delete set null;

create index if not exists parking_reports_user_id_idx on public.parking_reports (user_id, created_at desc);

create or replace function public.increment_profile_points_on_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.user_id is not null then
        update public.profiles
        set points = points + 1
        where id = new.user_id;
    end if;

    return new;
end;
$$;

drop trigger if exists on_parking_report_created on public.parking_reports;

create trigger on_parking_report_created
after insert on public.parking_reports
for each row
execute function public.increment_profile_points_on_report();
