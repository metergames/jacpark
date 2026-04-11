alter table public.parking_reports
add column if not exists action_type text not null default 'observing',
add column if not exists fullness_level smallint;

update public.parking_reports
set fullness_level = 3
where fullness_level is null;

alter table public.parking_reports
alter column fullness_level set not null;

create index if not exists parking_reports_action_type_idx on public.parking_reports (action_type, created_at desc);

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
