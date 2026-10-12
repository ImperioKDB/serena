# Fourth milestone: controlled multi-source research

## Objective

Provide a deterministic research primitive that reads a user-supplied set of public URLs sequentially, stores each source and evidence excerpt, and returns a structured result. This milestone intentionally does not perform web search, autonomous planning, or AI-generated claims.

## Endpoint

```http
POST /v1/research-tasks
Authorization: Bearer <SERENA_API_KEY>
Content-Type: application/json
```

Example body:

```json
{
  "request": "Compare the stated information across these sources.",
  "sources": ["https://example.com/one", "https://example.com/two"],
  "timeoutMs": 15000,
  "allowedDomains": ["example.com"]
}
```

The endpoint accepts 1–5 HTTPS URLs. Serena reads them sequentially through the configured browser adapter, which is Browserbase in production when `BROWSERBASE_API_KEY` is present.

## Result semantics

The response contains:

- `sources`: source identifiers, final URLs, titles, and retrieval timestamps;
- `evidence`: a bounded visible-text excerpt linked to its source;
- `verificationStatus: "unverified"`: the excerpt has been retrieved but has not been independently verified;
- `findings: []`: no claims are generated until a later extraction and verification milestone;
- `taskId`: the durable research task identifier.

Each source and evidence item is also stored in Supabase tables `research_sources` and `research_evidence`. Lifecycle events include `task_started`, `source_completed`, and `task_completed`.

## Deliberate limitations

- URLs must be supplied by the caller; discovery/search is not included yet.
- Maximum five sources per request.
- Research runs synchronously within the API request; a queue is not included yet.
- Evidence is a bounded visible-text prefix, not a claim or citation-quality passage selection.
- No AI model is allowed to invent findings in this milestone.

## Verification

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

The deterministic suite covers successful multi-source execution, evidence creation, lifecycle persistence, and source-budget validation.
