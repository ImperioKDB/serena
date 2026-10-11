# Third milestone: Supabase-backed task persistence

Serena now has its first persistent data model and repository boundary.

## Database

The migration in `supabase/migrations/20261011195000_initial_research_tasks.sql` creates:

- `research_tasks`: request text, lifecycle status, input, result, error code, and timestamps.
- `execution_events`: ordered task events with JSON payloads and a foreign key back to the task.

The migration was applied to the new Supabase project `serena` in `eu-west-1`.

## Runtime configuration

The API uses `DATABASE_URL` when present. The connection is configured with a small pool, SSL required, and prepared statements disabled for compatibility with Supabase transaction pooling. If `DATABASE_URL` is absent, the local server falls back to an in-memory repository; this fallback is for development only and is not durable.

The Vercel deployment uses the recognized `src/server.ts` Fastify entrypoint. Vercel can host the API shell and health endpoint, but the browser execution path still requires a compatible browser runtime or managed browser endpoint before production page-reading requests are enabled.

```text
DATABASE_URL=postgresql://...
SERENA_API_KEY=...
PORT=3000
```

Do not commit `DATABASE_URL`, database passwords, service-role keys, or browser state. Store them in the deployment provider's encrypted environment settings.

## Current API behavior

A successful `POST /v1/page-reads` now:

1. Creates a queued research task.
2. Records `task_started` and marks the task running.
3. Executes the page read.
4. Stores the result and records `task_completed`.

Browser failures mark the task failed and record the safe error code.

## Security follow-up

The Supabase project currently reports Row Level Security disabled on both new tables. The API is designed for a trusted backend database connection, but the tables must not be exposed through client-side Supabase APIs until RLS and appropriate user-scoped policies are designed. RLS should be enabled before any browser or frontend client receives access to these tables.
