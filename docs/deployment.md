# Deployment

## Vercel projects

- `serena` is linked to `ImperioKDB/serena` and hosts the Fastify API from the repository root using `src/server.ts`.
- The React/Vite dashboard should use a separate Vercel project named `serena-frontend`, linked to the same GitHub repository with **Root Directory** `frontend`, build command `pnpm run build`, and output directory `dist`. Keep the API project root unchanged.
- The connected Vercel scope is a Hobby team. Private-repository deployments require commits authored by the team owner; the repository commit identity uses the verified GitHub owner email.

Project-level SSO protection is disabled on the existing API project because the connected Vercel team protection is not available in this deployment workflow. No unrelated account or project security settings should be changed.

## API environment variables

Configure sensitive values only in Vercel's encrypted/sensitive environment-variable store:

- `SERENA_API_KEY`: required for all production server startup; the API fails closed if it is blank or missing.
- `DATABASE_URL`: Supabase Postgres connection string for project `nmlhcofasxsngmvjjxti`; it is required in production for shared request admission and research persistence. The API fails closed if it is missing.
- `BROWSERBASE_API_KEY`: enables managed Playwright sessions.
- `BROWSERBASE_PROJECT_ID`: optional explicit Browserbase project ID; Browserbase may infer it from the API key.
- `SERENA_CORS_ORIGINS`: optional comma-separated exact HTTPS origins allowed by the API, for example `https://serena-frontend.example.vercel.app`. Do not use `*`, paths, or a broad Vercel wildcard. Add the actual deployed dashboard origin after the frontend project is created, then redeploy the API.

The frontend's `VITE_SERENA_API_URL` is a public API base URL, not a secret. The frontend must never receive `SERENA_API_KEY`, database credentials, or provider secrets. Users enter the bearer key in the dashboard for its request; the app does not persist it to local storage.

## Browser and request budgets

The browser rejects non-HTTPS targets by default (with a loopback-only HTTP exception for local fixtures), credentials in URLs, non-default HTTPS ports, private/special-purpose IP literals and DNS answers, and hosts outside an optional domain allowlist. For each HTTP request, Serena resolves DNS once, rejects the target if any answer is private/reserved, then opens a direct socket to a vetted answer while preserving the requested Host header and TLS server name. Redirect hops use this same guarded client and are limited to five. In-page requests also pass through the same pinned client; no automatic redirect is followed. Chromium service-worker network interception is bypassed so worker-fulfilled requests remain visible to Playwright routes.

Inbound JSON is limited to 64 KiB. The browser only relays GET/HEAD, blocks images/media/fonts, limits a page to 80 requests, allows up to 2 MiB decoded per resource and 8 MiB total, and caps extracted text at 50,000 characters. A research task has a 65-second orchestration budget with at most 15 seconds for claim extraction. Production API calls are limited per API-key hash to 20 successful admissions per 60-second fixed window and two concurrent leases; leases expire after 120 seconds if a function is terminated.

Before deploying the API code, apply migration `20261012204800_request_admission_limits.sql` to the Serena Supabase project. The deploy must include `DATABASE_URL`; the API fails closed if the admission functions cannot be reached. See [security controls](./security-controls.md) for design rationale and provider research.

**Important residual risk:** this application-layer guard protects only HTTP(S) requests routed through Serena’s guarded browser adapters. It does **not** inspect or block WebSocket (`ws:`/`wss:`), WebRTC/ICE/STUN or other UDP, QUIC/WebTransport, direct browser DNS, or other non-HTTP network paths; this is not a general browser egress firewall. Any future HTTP client must use the same pinned helper. Handling arbitrary untrusted pages safely requires a provider/network egress policy covering all protocols, or disabling unsupported protocols at that layer. Continue to use least-privilege credentials, isolate sessions, and require explicit human approval before consequential actions.

Exact repeated sentences are labeled **Exact text match**, not **Supported**. Content identified as duplicate is excluded from independent exact-match corroboration. This does not establish the truth of a claim; AI-generated findings remain proposed and source evidence remains reviewable.
