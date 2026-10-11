# First milestone: deterministic public-page reader

The first Serena implementation is intentionally deterministic. It reads one explicitly supplied page with Playwright and returns the title, visible text, final URL, retrieval timestamp, and duration.

## Local commands

```bash
pnpm install
pnpm exec playwright install chromium
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

The tests use a local fixture server. Production navigation is HTTPS-only by default. Local HTTP is enabled only explicitly by the test code.

## Security boundaries

- No credentials or persistent browser state are used.
- Private and metadata hosts are rejected by default.
- Each read uses a fresh browser context.
- Navigation has a timeout and typed failure codes.
- Browser and context cleanup runs on both success and failure.
