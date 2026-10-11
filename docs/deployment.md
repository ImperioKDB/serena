# Deployment

## Vercel

The `serena` Vercel project is linked to `ImperioKDB/serena` and uses the Fastify framework with the recognized `src/server.ts` entrypoint.

Project-level SSO protection was disabled because the connected Vercel team protection is not available for this deployment workflow. No account-level or unrelated project security settings were changed.

Required encrypted environment variables before enabling durable production requests:

- `DATABASE_URL`: Supabase Postgres connection string for project `nmlhcofasxsngmvjjxti`.
- `SERENA_API_KEY`: bearer token required by the API when configured.

The API falls back to in-memory task storage when `DATABASE_URL` is absent. This is acceptable only for development or health checks; it must not be treated as durable production persistence.

The current browser adapter launches a local Playwright browser. Vercel can host the Fastify API shell, but production page reads require a compatible browser runtime or a managed browser endpoint. Until that is configured, verify `/health` separately and do not claim that remote page reads are production-ready.

Because the connected Vercel scope is a Hobby team, private-repository deployments require commits to be authored by the Hobby-team owner. The repository commit identity is configured to use the verified GitHub owner email for future deployment commits.
