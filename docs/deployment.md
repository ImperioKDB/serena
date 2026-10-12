# Deployment

## Vercel projects

- `serena` is linked to `ImperioKDB/serena` and hosts the Fastify API from the repository root using `src/server.ts`.
- The React/Vite dashboard should use a separate Vercel project named `serena-frontend`, linked to the same GitHub repository with **Root Directory** `frontend`, build command `pnpm run build`, and output directory `dist`. Keep the API project root unchanged.
- The connected Vercel scope is a Hobby team. Private-repository deployments require commits authored by the team owner; the repository commit identity uses the verified GitHub owner email.

Project-level SSO protection is disabled on the existing API project because the connected Vercel team protection is not available in this deployment workflow. No unrelated account or project security settings should be changed.

## API environment variables

Configure sensitive values only in Vercel's encrypted/sensitive environment-variable store:

- `SERENA_API_KEY`: required for all production server startup; the API fails closed if it is blank or missing.
- `DATABASE_URL`: Supabase Postgres connection string for project `nmlhcofasxsngmvjjxti`; without it, the in-memory repository is suitable only for development or health checks.
- `BROWSERBASE_API_KEY`: enables managed Playwright sessions.
- `BROWSERBASE_PROJECT_ID`: optional explicit Browserbase project ID; Browserbase may infer it from the API key.
- `SERENA_CORS_ORIGINS`: optional comma-separated exact HTTPS origins allowed by the API, for example `https://serena-frontend.example.vercel.app`. Do not use `*`, paths, or a broad Vercel wildcard. Add the actual deployed dashboard origin after the frontend project is created, then redeploy the API.

The frontend's `VITE_SERENA_API_URL` is a public API base URL, not a secret. The frontend must never receive `SERENA_API_KEY`, database credentials, or provider secrets. Users enter the bearer key in the dashboard for its request; the app does not persist it to local storage.

## Browser and research budgets

The browser rejects non-HTTPS targets by default (with a loopback-only HTTP exception for local fixtures), credentials in URLs, non-default HTTPS ports, private/special-purpose IP literals and DNS answers, and hosts outside an optional domain allowlist. The initial redirect chain is resolved manually with a five-hop cap and each target is checked before continuing. Browser requests use redirect-disabled fetches; unexpected redirects during page loading are rejected. Images, media and fonts are not fetched, each page is limited to 80 routed requests, extracted text is capped at 50,000 characters, and a research task has a 65-second orchestration budget with at most 15 seconds for claim extraction.

**Important residual risk:** DNS is checked before the HTTP request, but the browser/request runtime does not pin the connection to the checked IP. DNS rebinding or a resolver/network race is therefore not eliminated by application checks alone. Before treating arbitrary public URLs as a fully hardened production capability, put browser egress behind a network layer that enforces public-only destination IPs at connection time (including redirects), or use an equivalent provider-level egress policy. Continue to use least-privilege credentials and never submit credentials to untrusted sites.

Exact repeated sentences are labeled **Exact text match**, not **Supported**. Content identified as duplicate is excluded from independent exact-match corroboration. This does not establish the truth of a claim; AI-generated findings remain proposed and source evidence remains reviewable.
