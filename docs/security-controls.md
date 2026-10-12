# Serena security controls: outbound reads and request admission

**Status:** deployed and verified (2026-10-12). Production commit `903ad32` is live and the Supabase migration is applied.

## Research and design decision

Serena currently runs its API on Vercel and uses Playwright/Browserbase to read public pages. A dedicated egress proxy would provide an additional network boundary, but available provider options either impose recurring cost or do not fit the existing runtime. The current increment therefore enforces outbound checks in Serena’s Node request path and reuses the existing Supabase Postgres database for shared admission state; it introduces no new paid service.

- Browserbase documents external HTTP/HTTPS proxy routing, but this requires operating or buying a proxy that is reachable from Browserbase. Its **Allowed Domains** feature is experimental and only checks top-frame navigations; it does not cover subframes or page resources such as scripts, images, and XHR. It is therefore not the primary SSRF control.
- Vercel Static IPs provide fixed outbound source IPs for destination-side allowlisting, not a destination filter or SSRF barrier. Vercel’s current docs list the feature for Pro and Enterprise at **$100/month per project plus private data transfer**, so Serena is not enabling it.
- Cloudflare’s documented `globalOutbound` filtering applies to **Dynamic Workers** that execute untrusted code, not to this Vercel-hosted Fastify API. It is not a drop-in egress proxy for Serena.
- Node’s HTTP client exposes connection options that allow a request to target a vetted IP while retaining the requested hostname for the HTTP Host header and TLS Server Name Indication. The implementation resolves a hostname once, rejects the entire answer set if any address is private/reserved, then dials the selected public address directly with certificate verification enabled. Redirects are returned one hop at a time to Chromium so each next URL passes through the guard before a connection is opened.
- Fastify supports a configurable incoming `bodyLimit`; Serena uses 64 KiB rather than the documented 1 MiB default.
- Playwright’s `route.fulfill` accepts a single-value header map. Because this loses duplicate `Set-Cookie` fields, Serena extracts and validates each cookie separately and adds acceptable cookies to the isolated browser context.

## Intended limits

| Control                                        |          Current target |
| ---------------------------------------------- | ----------------------: |
| JSON request body                              |                  64 KiB |
| Allowed browser request methods                |       GET and HEAD only |
| Browser network requests per page              |                      80 |
| Maximum decoded response per resource          |                   2 MiB |
| Maximum combined page responses                |                   8 MiB |
| API requests per bearer-token hash             | 20 per 60-second window |
| Concurrent API requests per bearer-token hash  |                       2 |
| Admission lease expiry after a killed function |             120 seconds |

The API guard is fail-closed when its Postgres admission store is unavailable. It releases leases on completed responses; expiry recovers capacity after process termination. Rate state is keyed by an HMAC-derived API-key identifier, not by storing the bearer secret.

### Live Supabase function checks

Direct tests against the Serena project used unique temporary key hashes and request IDs. Results: 20 admissions followed by one `rate_limited` result; two concurrent leases admitted followed by a `concurrency_limited` result; after releasing both leases, a new request was admitted. All temporary test leases and request-window records were removed.

## Verified source links

- [Browserbase: IP allowlisting and custom proxies](https://docs.browserbase.com/platform/browser/security/ip-allowlisting)
- [Browserbase: Allowed Domains and its limitations](https://docs.browserbase.com/platform/browser/security/allowed-domains)
- [Vercel: Static IPs, plan availability, and pricing](https://vercel.com/docs/networking/static-ips)
- [Cloudflare: Dynamic Workers egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/)
- [Node.js HTTP API](https://nodejs.org/api/http.html)
- [Fastify server reference (`bodyLimit`)](https://fastify.dev/docs/latest/Reference/Server/)
- [Playwright route API (`fulfill`)](https://playwright.dev/docs/api/class-route)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)

## Important limitations and follow-up

1. This is an **application-layer HTTP(S) destination guard**, not a general browser egress filter or provider-level firewall. Only HTTP(S) requests routed through Serena's pinned helper are checked. WebSocket (`ws:`/`wss:`), WebRTC/ICE/STUN and other UDP, QUIC/WebTransport, direct browser DNS, and other non-HTTP network paths are **not validated or blocked** by these controls. Any future outbound HTTP client added outside the guarded browser adapter must use an equivalent pinned-destination helper. Safely handling arbitrary untrusted pages requires a network/provider egress policy that covers every protocol, or disabling unsupported protocols at that layer.
2. The byte budgets cap data buffered and handed to Chromium; accepted `Content-Encoding` formats are decompressed under a second byte cap. An unsupported encoding is rejected.
3. Only GET/HEAD requests are relayed. That blocks ordinary mutation methods, but HTTP GET endpoints can still have side effects; Serena must never treat arbitrary page actions as approval to perform consequential actions.
4. Chromium service-worker interception is explicitly bypassed through CDP before navigation because service-worker-fulfilled HTTP requests are not visible to Playwright route handlers.
5. The rate and concurrency limits are global per configured API bearer token. A future multi-user API will need distinct authenticated principals and per-principal budgets.
6. The migration is additive. Confirm its presence in the Serena Supabase project before deploying the API code that calls its functions.
