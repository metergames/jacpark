create extension if not exists pgcrypto;

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

create index if not exists parking_reports_created_at_idx on public.parking_reports (created_at desc);

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
