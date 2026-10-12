# Serena frontend

This is Serena’s private, phone-first research dashboard. It calls the existing Fastify API and does not connect directly to Groq, Supabase, Browserbase, or PostgreSQL.

## Development

From the repository root:

```bash
pnpm install
pnpm --filter @serena/frontend dev --host 0.0.0.0 --port 3000 --strictPort
```

The dashboard defaults to the deployed Serena API. To point it at another public API origin, provide `VITE_SERENA_API_URL` before starting Vite.

The Serena API key is entered into the form and held only in React memory for the current page session. It is deliberately not written to localStorage, cookies, URL parameters, or source files.

## Build checks

```bash
pnpm --filter @serena/frontend typecheck
pnpm --filter @serena/frontend build
```
