-- Existing prototype tasks have no reliable owner. Leave those rows unowned rather
-- than assigning them arbitrarily; all new production tasks receive the verified
-- Supabase Auth user ID from the API.
alter table public.research_tasks
  add column if not exists owner_id uuid references auth.users (id) on delete cascade;

create index if not exists research_tasks_owner_created_at_idx
  on public.research_tasks (owner_id, created_at desc)
  where owner_id is not null;
