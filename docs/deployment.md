# Deployment

## Vercel projects

- `serena` is linked to `ImperioKDB/serena` and hosts the Fastify API from the repository root using `src/server.ts`.
- The React/Vite dashboard should use a separate Vercel project named `serena-frontend`, linked to the same GitHub repository with **Root Directory** `frontend`, build command `pnpm run build`, and output directory `dist`. Keep the API project root unchanged.
- The connected Vercel scope is a Hobby team. Private-repository deployments require commits authored by the team owner; the repository commit identity uses the verified GitHub owner email.

Project-level SSO protection is disabled on the existing API project because the connected Vercel team protection is not available in this deployment workflow. No unrelated account or project security settings should be changed.

## Supabase Auth environment variables

The production API validates each Supabase Auth access token against the project Auth service. Configure these values on both Vercel projects:

- API project `serena`: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- Frontend project `serena-frontend`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- The Supabase publishable key is designed for client exposure; never use a service-role/secret key in either app. Keep `DATABASE_URL`, provider credentials, and model secrets in the API project's sensitive variables only.
- `SERENA_API_KEY`: optional legacy server-to-server bearer credential. It is not used by the dashboard and must never be put in frontend configuration. New user-facing clients should use Supabase Auth.
- `DATABASE_URL`: Supabase Postgres connection string for project `nmlhcofasxsngmvjjxti`; it is required in production for shared request admission and research persistence. The API fails closed if it is missing.
- `BROWSERBASE_API_KEY`: enables managed Playwright sessions.
- `BROWSERBASE_PROJECT_ID`: optional explicit Browserbase project ID; Browserbase may infer it from the API key.
- `TAVILY_API_KEY`: optional server-only key for bounded automatic web search. Keep it only in the `serena` API Vercel project, never in `serena-frontend` or a `VITE_` variable. Without it, caller-provided source URLs continue to work, while discovery mode returns a clear unavailable response.

Automatic discovery uses search results only to select candidate URLs. Serena reads candidates through its existing guarded browser adapter; search snippets are not evidence. It tries at most five candidate pages. Security-verification pages are excluded, and typed navigation failures/timeouts are recorded as unreadable so Serena can try later results within the same cap. Serena does not solve CAPTCHAs, impersonate ordinary users, or bypass bot controls. Incomplete coverage is shown to the user and cannot support a negative conclusion.

- `SERENA_CORS_ORIGINS`: optional comma-separated exact HTTPS origins allowed by the API, for example `https://serena-frontend.example.vercel.app`. Do not use `*`, paths, or a broad Vercel wildcard. Add the actual deployed dashboard origin after the frontend project is created, then redeploy the API.

The frontend's `VITE_SERENA_API_URL` is a public API base URL, not a secret. The frontend obtains a Google-authenticated Supabase session and sends its access token as a bearer token; the API verifies it with Supabase before processing the request. The SDK uses PKCE and `sessionStorage` (rather than long-lived `localStorage`) for this browser prototype. Google client secrets belong only in Supabase Auth provider settings, never in Serena or Vercel frontend variables. Existing server-to-server callers using `SERENA_API_KEY` remain supported, but tasks created through that legacy path have no verified user owner. Follow [Google sign-in setup](./google-auth-setup.md) to finish provider configuration.

## Browser and request budgets

The browser rejects non-HTTPS targets by default (with a loopback-only HTTP exception for local fixtures), credentials in URLs, non-default HTTPS ports, private/special-purpose IP literals and DNS answers, and hosts outside an optional domain allowlist. For each HTTP request, Serena resolves DNS once, rejects the target if any answer is private/reserved, then opens a direct socket to a vetted answer while preserving the requested Host header and TLS server name. Redirect hops use this same guarded client and are limited to five. In-page requests also pass through the same pinned client; no automatic redirect is followed. Chromium service-worker network interception is bypassed so worker-fulfilled requests remain visible to Playwright routes.

Inbound JSON is limited to 64 KiB. The browser only relays GET/HEAD, blocks images/media/fonts, limits a page to 80 requests, allows up to 2 MiB decoded per resource and 8 MiB total, and caps extracted text at 50,000 characters. A research task has a 65-second orchestration budget with at most 15 seconds for claim extraction. Production API calls are limited per authenticated-user hash to 20 successful admissions per 60-second fixed window and two concurrent leases; leases expire after 120 seconds if a function is terminated.

Before deploying API code, apply migrations `20261012204800_request_admission_limits.sql` and `20261012222000_research_task_owner.sql` to the Serena Supabase project. The latter attaches new tasks to the verified Auth user; legacy tasks remain unowned. The deploy must include `DATABASE_URL` and Supabase Auth configuration; the API fails closed if required auth or admission services cannot be reached. See [security controls](./security-controls.md) for design rationale and provider research.

**Important residual risk:** this application-layer guard protects only HTTP(S) requests routed through Serena’s guarded browser adapters. It does **not** inspect or block WebSocket (`ws:`/`wss:`), WebRTC/ICE/STUN or other UDP, QUIC/WebTransport, direct browser DNS, or other non-HTTP network paths; this is not a general browser egress firewall. Any future HTTP client must use the same pinned helper. Handling arbitrary untrusted pages safely requires a provider/network egress policy covering all protocols, or disabling unsupported protocols at that layer. Continue to use least-privilege credentials, isolate sessions, and require explicit human approval before consequential actions.

Exact repeated sentences are labeled **Exact text match**, not **Supported**. Content identified as duplicate is excluded from independent exact-match corroboration. This does not establish the truth of a claim; AI-generated findings remain proposed and source evidence remains reviewable.
