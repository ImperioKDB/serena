create table public.serena_request_windows (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0)
);

create table public.serena_request_leases (
  request_id uuid primary key,
  key_hash text not null references public.serena_request_windows (key_hash) on delete cascade,
  expires_at timestamptz not null
);

create index serena_request_leases_key_expiry_idx
  on public.serena_request_leases (key_hash, expires_at);

alter table public.serena_request_windows enable row level security;
alter table public.serena_request_leases enable row level security;

revoke all on table public.serena_request_windows from public, anon, authenticated, service_role;
revoke all on table public.serena_request_leases from public, anon, authenticated, service_role;

create function public.serena_admit_request(
  p_key_hash text,
  p_request_id uuid,
  p_window_seconds integer,
  p_requests_per_window integer,
  p_concurrent_requests integer,
  p_lease_seconds integer
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
  v_active_count integer;
begin
  if p_key_hash !~ '^[0-9a-f]{64}$'
     or p_window_seconds < 1
     or p_requests_per_window < 1
     or p_concurrent_requests < 1
     or p_lease_seconds < 1 then
    raise exception 'Invalid request admission parameters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));

  insert into public.serena_request_windows (key_hash, window_started_at, request_count)
  values (p_key_hash, v_now, 0)
  on conflict (key_hash) do nothing;

  select window_started_at, request_count
    into v_window_started_at, v_request_count
    from public.serena_request_windows
    where key_hash = p_key_hash
    for update;

  if v_window_started_at <= v_now - make_interval(secs => p_window_seconds) then
    v_window_started_at := v_now;
    v_request_count := 0;
  end if;

  delete from public.serena_request_leases
    where expires_at <= v_now;

  select count(*)::integer
    into v_active_count
    from public.serena_request_leases
    where key_hash = p_key_hash and expires_at > v_now;

  if v_active_count >= p_concurrent_requests then
    return 'concurrency_limited';
  end if;
  if v_request_count >= p_requests_per_window then
    return 'rate_limited';
  end if;

  update public.serena_request_windows
    set window_started_at = v_window_started_at,
        request_count = v_request_count + 1
    where key_hash = p_key_hash;

  insert into public.serena_request_leases (request_id, key_hash, expires_at)
  values (p_request_id, p_key_hash, v_now + make_interval(secs => p_lease_seconds));

  return 'admitted';
end;
$$;

create function public.serena_release_request(p_request_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  delete from public.serena_request_leases where request_id = p_request_id;
$$;

revoke all on function public.serena_admit_request(text, uuid, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.serena_release_request(uuid) from public, anon, authenticated;
grant execute on function public.serena_admit_request(text, uuid, integer, integer, integer, integer) to postgres, service_role;
grant execute on function public.serena_release_request(uuid) to postgres, service_role;
