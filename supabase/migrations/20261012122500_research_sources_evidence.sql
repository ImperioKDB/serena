create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.research_tasks (id) on delete cascade,
  url text not null,
  final_url text not null,
  title text not null,
  retrieved_at timestamptz not null,
  result_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists research_sources_task_id_created_at_idx
  on public.research_sources (task_id, created_at);

create table if not exists public.research_evidence (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.research_tasks (id) on delete cascade,
  source_id uuid not null references public.research_sources (id) on delete cascade,
  excerpt text not null,
  locator text not null,
  extraction_method text not null,
  verification_status text not null check (verification_status in ('unverified', 'supported', 'disputed')),
  created_at timestamptz not null default now()
);

create index if not exists research_evidence_task_id_created_at_idx
  on public.research_evidence (task_id, created_at);
