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
