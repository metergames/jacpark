update public.parking_reports
set fullness_level = 3
where fullness_level is null;

alter table public.parking_reports
alter column fullness_level set not null;

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

create or replace function public.validate_parking_report_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    latest_state text;
    latest_observing_at timestamptz;
    submission_time timestamptz := coalesce(new.created_at, now());
begin
    if new.user_id is null then
        return new;
    end if;

    if new.action_type = 'parked' or new.action_type = 'leaving' then
        select pr.action_type
        into latest_state
        from public.parking_reports pr
        where pr.user_id = new.user_id
          and pr.action_type in ('parked', 'leaving')
        order by pr.created_at desc
        limit 1;

        if new.action_type = 'parked' and latest_state = 'parked' then
            raise exception 'User is already marked as parked.';
        end if;

        if new.action_type = 'leaving' and coalesce(latest_state, 'leaving') <> 'parked' then
            raise exception 'Leaving requires a prior parked update.';
        end if;
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
