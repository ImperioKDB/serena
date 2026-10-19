# Serena

Serena is a modular personal AI intelligence platform for evidence-backed research, authorized browser automation, persistent knowledge, and integration with other applications such as Scholars.

## Current status

Serena is an incrementally built research platform. Its deployed stack includes a Fastify API, a phone-first React dashboard, Supabase Google Auth, PostgreSQL task/source/evidence persistence, guarded page reading, and bounded automatic web discovery. Research history is scoped to the signed-in user's verified Supabase identity.

## First milestone

Build a deterministic public-page reader using TypeScript and Playwright. It will:

- enforce URL and domain policy;
- navigate to an explicitly supplied public URL;
- extract the final URL, title, visible text, retrieval time, and duration;
- handle timeouts and browser failures safely; and
- run against deterministic local fixtures in CI.

Google authentication and bounded research discovery are implemented. This milestone adds a user-owned research library; durable jobs, broader crawling/planning, and personal memory remain future phases.

## Current API

- `GET /health` checks that the service is running.
- `POST /v1/page-reads` reads one explicitly supplied public page and returns structured page data.
- `POST /v1/research-tasks` reads 1–5 supplied public URLs or uses bounded automatic discovery, returns source-linked evidence, reports cautious domain/content-quality metadata, and marks AI findings for review unless they pass deterministic exact-match verification.
- `GET /v1/research-tasks` lists only the signed-in user's saved task summaries; `GET /v1/research-tasks/:taskId` returns that user's full saved result; `DELETE /v1/research-tasks/:taskId` deletes that user's task and cascading source/evidence/event records. These history routes require a Supabase-authenticated user, not the legacy server-to-server API key. See [`docs/deployment.md`](docs/deployment.md#user-owned-research-history) for pagination and security details.

Research source quality is intentionally conservative. A source can expose signals such as `government-domain`, `education-domain`, `organization-domain`, or `commercial-domain`, but these are not proof that the content is accurate. Each source also includes a normalized SHA-256 content hash so exact duplicate pages can be detected. AI-generated findings that do not match the deterministic cross-source verifier are returned as `proposed` with `reviewRequired: true`.

The browser dashboard authenticates users with Google through Supabase Auth. The API independently verifies Supabase access tokens; user-owned history queries always filter by the verified user ID. See [`docs/google-auth-setup.md`](docs/google-auth-setup.md) and [`docs/deployment.md`](docs/deployment.md) for setup details.

Persistence configuration and schema details are in [`docs/third-milestone.md`](docs/third-milestone.md).

The controlled research contract and its limitations are in [`docs/fourth-milestone.md`](docs/fourth-milestone.md).

AI-assisted claims are optional and evidence-grounded. Without an explicitly configured server-side model provider, Serena uses the deterministic matcher and does not call an AI model.

## Frontend dashboard

The phone-first research dashboard lives in [`frontend/`](frontend/). It submits research requests only to the existing API, presents findings alongside their evidence, and shows cautious source-quality signals without treating domain names as proof of accuracy. Users sign in with Google through Supabase Auth, and the dashboard sends the verified Supabase access token to the API. The browser never receives Groq, Supabase service-role, database, or Browserbase credentials. The optional legacy `SERENA_API_KEY` is server-to-server only and must never be entered into the dashboard.

From the repository root, run `pnpm install`, then `pnpm --filter @serena/frontend dev --host 0.0.0.0 --port 3000 --strictPort`. Frontend checks are `pnpm --filter @serena/frontend typecheck` and `pnpm --filter @serena/frontend build`.

## Development workflow

1. Work from the managed development environment.
2. Make a small change on a branch.
3. Run type checks, linting, formatting checks, and tests.
4. Push the branch to GitHub.
5. Review the CI result before merging or deploying.

See [`docs/architecture-roadmap.md`](docs/architecture-roadmap.md) for the architecture, security boundaries, cost assumptions, roadmap, and first milestone acceptance criteria.

Implementation details and local verification commands are in [`docs/first-milestone.md`](docs/first-milestone.md).
