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
