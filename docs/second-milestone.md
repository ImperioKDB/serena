# Second milestone: minimal Fastify API

The second milestone exposes the deterministic browser reader through a small HTTP API.

## Endpoints

- `GET /health` returns `{ "status": "ok" }`.
- `POST /v1/page-reads` accepts `{ "target": "https://example.com" }` and optional `timeoutMs` and `allowedDomains` fields.

When `SERENA_API_KEY` is configured, all routes except `/health` require:

```text
Authorization: Bearer <SERENA_API_KEY>
```

The API returns a request ID with successful and failed page-read responses. Internal browser errors are mapped to safe public messages rather than exposing stack traces or implementation details.

## Local verification

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

The route tests use a fake browser adapter. The real Playwright adapter remains covered by the first milestone's browser tests.

## Deliberate limitation

This API is not yet a public production deployment. Authentication is a single development API key, not user accounts or OAuth. Supabase persistence, rate limiting, queues, and deployment configuration are later milestones.
