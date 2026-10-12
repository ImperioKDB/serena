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
- `findings`: exact sentences of at least 20 characters that appear in at least two source excerpts are returned as `supported` with `verificationMethod: "exact-text-match"` and both evidence IDs;
- `taskId`: the durable research task identifier.

Each source and evidence item is also stored in Supabase tables `research_sources` and `research_evidence`. Lifecycle events include `task_started`, `source_completed`, and `task_completed`.

Row Level Security is enabled on all four research tables. Serena accesses them through its server-side database connection; no direct anon-client policies are configured.

## Optional AI claim extraction

The API can use an OpenAI-compatible chat-completions provider when all of these server-side variables are configured:

```text
LLM_API_URL=https://provider.example/v1
LLM_API_KEY=<server-side secret>
LLM_MODEL=gpt-5-mini
```

The selected model must return strict JSON containing claims, uncertainty, and evidence IDs. Serena rejects malformed claims and removes any finding that cites an evidence ID not present in the current task. Webpage excerpts are placed in explicit untrusted-data delimiters, and the prompt tells the model never to follow instructions contained in those excerpts.

If the model is unavailable, malformed, or returns invalid output, Serena records a fallback event and uses the deterministic exact-text matcher instead. The research request still completes without exposing model errors to the caller.

The current implementation does not automatically configure a paid model provider. Do not put a personal provider key in GitHub, source code, or a Colab notebook. Add it only as an encrypted Vercel environment variable after choosing a provider and understanding its pricing.

## Deliberate limitations

- URLs must be supplied by the caller; discovery/search is not included yet.
- Maximum five sources per request.
- Research runs synchronously within the API request; a queue is not included yet.
- Evidence is a bounded visible-text prefix, not a claim or citation-quality passage selection.
- Exact text agreement is not semantic truth; it is only a reproducible cross-source match.
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
