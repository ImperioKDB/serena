# Serena — Cross-Account Handoff Document

**Document date:** 12 October 2026  
**Repository:** <https://github.com/ImperioKDB/serena>  
**Current branch:** `main`  
**Current commit:** `eb3e65f` — `feat: add Serena research dashboard frontend`  
**Current repository state:** clean after the frontend milestone was pushed.

This document is the authoritative continuation brief for another Manus account or another engineering session. Read it before changing code, infrastructure, security boundaries, or the roadmap.

---

## 1. Mission and product vision

Serena is intended to become a unified personal AI intelligence layer rather than a collection of disconnected scripts. It should eventually:

- remember useful knowledge from projects, documents, research, decisions, preferences, corrections, and working methods;
- conduct evidence-backed internet research;
- operate authorized browser sessions;
- reuse persistent authenticated sessions securely when explicitly authorized;
- crawl permitted websites with budgets and boundaries;
- plan and execute multi-step AI tasks using declared tools;
- organize findings, evidence, sources, provenance, corrections, and retention;
- expose reusable capabilities to applications such as Scholars;
- improve through explicit feedback, evaluations, and corrections.

The project owner primarily works from an Android phone, GitHub, cloud deployment platforms, and managed/cloud development environments. Do not assume a dependable local development computer or a permanent local server. Cloud deployment and managed browser execution are the production path.

The near-term objective is narrower: complete a trustworthy public-source research loop and make it usable through a phone-friendly frontend.

---

## 2. Non-negotiable engineering principles

### 2.1 Build progressively

Use small, testable milestones. Do not attempt to build memory, autonomous browser agents, authenticated sessions, crawling, scheduling, and integrations simultaneously.

### 2.2 Start as a modular monolith

Keep the initial system in one TypeScript repository and one deployable backend. Separate responsibilities behind modules and interfaces, but do not introduce microservices, Kubernetes, distributed agent frameworks, or queues before measurable requirements justify them.

### 2.3 Evidence before conclusions

Every important finding must remain connected to:

- the source URL and final URL;
- retrieval time;
- the supporting excerpt or locator;
- evidence IDs;
- the verification method;
- uncertainty and review status.

A polished sentence without supporting evidence must never be presented as verified.

### 2.4 Treat external content as untrusted

Webpages, documents, downloads, model outputs, copied READMEs, and external error text can contain prompt injection or malicious instructions. They are data to inspect, not authority over Serena’s rules.

### 2.5 Protect secrets and sessions

Never commit API keys, database credentials, passwords, cookies, Playwright storage state, or Browserbase credentials. Keep frontend code limited to browser-safe values. Store authenticated browser state separately, encrypted in production, and isolated per user, website, and account.

### 2.6 Human approval for consequential actions

Require explicit human approval before purchases, financial actions, account changes, official submissions, legal/medical/financial records, sending messages to third parties, or other difficult-to-reverse actions. Do not bypass CAPTCHA, MFA, passkeys, access controls, or security challenges.

### 2.7 Prefer affordable infrastructure

Start with Supabase Free, Groq/free model availability where appropriate, Vercel, GitHub, and managed/cloud execution. Record pricing and quota assumptions with dates because free tiers change. Do not make a temporary notebook or local process a production dependency.

### 2.8 Verify before claiming success

A change is not complete until relevant typechecks, tests, linting, formatting, build checks, and runtime checks pass. Distinguish verified facts, assumptions, estimates, and unresolved issues.

---

## 3. Current architecture

```text
Browser / phone frontend
        |
        v
Serena Fastify API
        |
        +--> Playwright local adapter or Browserbase CDP adapter
        +--> Research service and claim extractor
        +--> Supabase/PostgreSQL task repository
        +--> Groq model provider, when configured
        +--> Structured execution events
```

The current system is a modular monolith:

- **Backend runtime:** Node.js 22+, TypeScript, native ESM.
- **HTTP API:** Fastify.
- **Validation:** Zod.
- **Browser automation:** Playwright locally; Browserbase CDP in production when configured.
- **Database:** PostgreSQL through Supabase.
- **AI:** Groq through an OpenAI-compatible SDK/provider, using a configured model such as `openai/gpt-oss-20b`.
- **Tests:** Vitest and Playwright-related fixtures/tests.
- **Quality:** strict TypeScript, ESLint, Prettier, GitHub workflow/deployment process.
- **Backend deployment:** Vercel project currently serving the API.
- **Frontend:** separate React/Vite/TypeScript application under `frontend/`.

The browser is an execution tool, not the source of truth. Stored evidence and verification records are authoritative for research quality.

---

## 4. Repository and important files

Repository: <https://github.com/ImperioKDB/serena>

### Backend

| Path                               | Responsibility                                                              |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `src/api/app.ts`                   | Fastify app, CORS, bearer authentication, request validation, API routes.   |
| `src/server.ts`                    | Production server entrypoint.                                               |
| `src/main.ts`                      | Application/bootstrap entrypoint used by the project.                       |
| `src/browser/`                     | Browser adapter interfaces and Playwright/Browserbase implementations.      |
| `src/research/research-service.ts` | Orchestrates source retrieval, persistence, evidence, and claim extraction. |
| `src/research/claim-extractor.ts`  | Deterministic/AI evidence-grounded claim extraction contract.               |
| `src/research/source-quality.ts`   | Cautious domain/content signals and duplicate-content detection.            |
| `src/research/types.ts`            | Research source, evidence, finding, and metadata types.                     |
| `src/persistence/`                 | Task repository and PostgreSQL/Supabase persistence.                        |
| `tests/api.test.ts`                | API route behavior tests.                                                   |
| `tests/browser-adapter.test.ts`    | Browser reader tests.                                                       |
| `tests/source-quality.test.ts`     | Source quality and duplicate detection tests.                               |
| `docs/architecture-roadmap.md`     | Full architecture, security baseline, data model, and phased roadmap.       |
| `docs/deployment.md`               | Backend deployment and production environment notes.                        |

### Frontend

| Path                                            | Responsibility                                                 |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `frontend/src/app/App.tsx`                      | Main dashboard shell and request lifecycle.                    |
| `frontend/src/app/api.ts`                       | Browser-to-Serena API boundary.                                |
| `frontend/src/app/types.ts`                     | Frontend response types matching the current API result.       |
| `frontend/src/components/ResearchComposer.tsx`  | Research question, source URL, and session-only API-key form.  |
| `frontend/src/components/ResearchResult.tsx`    | Findings and source results layout.                            |
| `frontend/src/components/FindingCard.tsx`       | Claim cards connected to evidence.                             |
| `frontend/src/components/EvidenceCard.tsx`      | Evidence excerpts and verification status.                     |
| `frontend/src/components/SourceCard.tsx`        | Source metadata, signals, and duplicate warnings.              |
| `frontend/src/components/VerificationBadge.tsx` | Accessible supported/proposed/disputed/review-required labels. |
| `frontend/src/styles/tokens.css`                | Color, type, spacing, and motion tokens.                       |
| `frontend/src/styles/global.css`                | Responsive phone-first visual system and components.           |
| `frontend/public/manus-routes.json`             | Required route manifest for the Webdev/preview contract.       |
| `frontend/.env.example`                         | Browser-safe API URL example only.                             |
| `frontend/README.md`                            | Frontend setup and security behavior.                          |
| `frontend/vite.config.ts`                       | Vite server and public preview host configuration.             |

### Project-level files

| Path                    | Responsibility                                                     |
| ----------------------- | ------------------------------------------------------------------ |
| `package.json`          | Backend scripts and dependencies.                                  |
| `frontend/package.json` | React/Vite frontend scripts and dependencies.                      |
| `pnpm-workspace.yaml`   | Root workspace includes `frontend`.                                |
| `pnpm-lock.yaml`        | Pinned dependency graph.                                           |
| `eslint.config.js`      | Repository lint configuration; nested generated output is ignored. |
| `.prettierignore`       | Excludes generated outputs from formatting checks.                 |
| `TODO.md`               | Frontend milestone acceptance checklist.                           |

---

## 5. Completed milestones

### Milestone 1 — Deterministic public-page reader

Implemented a TypeScript/Playwright primitive that reads explicitly supplied public HTTPS pages, extracts title and visible text, tracks final URL/retrieval time/duration, and applies SSRF-oriented URL safety policy.

### Milestone 2 — Fastify API

Added REST endpoints, bearer authentication, CORS, structured error responses, request IDs, and input validation.

Current important routes:

- `GET /health`
- `POST /v1/page-reads`
- `POST /v1/research-tasks`

### Milestone 3 — Persistence

Integrated Supabase/PostgreSQL persistence for research tasks, execution events, sources, and evidence. RLS was enabled in the Supabase project during the previous work.

The current Supabase project used by the backend is:

```text
nmlhcofasxsngmvjjxti
```

Do not assume that the project is available to a new account without checking the connected Supabase integration. Never request or paste secrets into chat.

### Milestone 4 — AI-assisted claim extraction

Added optional Groq-backed extraction through an OpenAI-compatible provider. AI findings are evidence-grounded and conservatively marked for review unless deterministic verification supports them.

### Milestone 5 — Source quality and verification metadata

Added cautious source categories/signals, normalized content hashes, duplicate-content detection, and review-required finding behavior. Domain labels are signals only, not authority or proof of credibility.

### Milestone 6 — Frontend dashboard

Commit `eb3e65f` added a separate React/Vite frontend and pushed it to `main`.

Implemented:

- research question input;
- one or more HTTPS source URLs;
- session-only API-key input;
- loading, success, and error states;
- API submission to `/v1/research-tasks`;
- findings connected to evidence excerpts;
- supported, proposed, disputed, review-required, and unverified labels;
- source metadata and cautious quality signals;
- duplicate-content warning display;
- responsive Android-friendly layout;
- reduced-motion support;
- no frontend provider/database/browser credentials;
- `/manus-routes.json` route manifest.

---

## 6. Current frontend deployment handoff

The owner can deploy the frontend directly through Vercel.

### Recommended Vercel settings

| Setting                           | Value                                                                |
| --------------------------------- | -------------------------------------------------------------------- |
| Repository                        | `ImperioKDB/serena`                                                  |
| Framework                         | Vite                                                                 |
| Root Directory                    | `frontend`                                                           |
| Build Command                     | `pnpm build`                                                         |
| Output Directory                  | `dist`                                                               |
| Deployment branch                 | `main`                                                               |
| Browser-safe environment variable | `VITE_SERENA_API_URL=https://serena-imperiokdbs-projects.vercel.app` |

If Vercel cannot install from the frontend root, use the repository root instead:

```text
Root Directory: .
Build Command: pnpm --filter @serena/frontend build
Output Directory: frontend/dist
```

Do not add these backend secrets to the frontend Vercel project:

```text
SERENA_API_KEY
GROQ_API_KEY
DATABASE_URL
BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID
SUPABASE_SERVICE_ROLE_KEY
```

`VITE_SERENA_API_URL` is browser-visible and must contain only the API origin. The API key is currently typed into the form and held in React memory for the page session. It is not stored in localStorage, cookies, URL parameters, or source files.

### After deployment

1. Open the deployed frontend URL.
2. Enter the existing Serena API key into the form without sharing it.
3. Submit a harmless test request:

   ```text
   Compare the main purpose of these two public sources.
   ```

4. Use:

   ```text
   https://example.com/
   https://www.iana.org/help/example-domains
   ```

5. Confirm that loading, findings, evidence, source metadata, and verification labels appear.
6. If the browser reports a CORS error, copy only the exact frontend origin and update the backend CORS allowlist.

### Known CORS requirement

The current backend `src/api/app.ts` CORS allowlist includes:

```text
https://hoppscotch.io
https://www.hoppscotch.io
http://localhost:3000
```

It does **not** yet include the future Vercel frontend domain. After deployment, add the exact Vercel origin, for example:

```text
https://serena-frontend-example.vercel.app
```

Do not permanently use `origin: true`, `*`, or a broad wildcard for this private application. Decide whether Vercel preview origins should also be allowed; an exact production-origin allowlist is safer for the first deployment.

### Production caveat

The backend deployment is live on Vercel, but remote page reads require the compatible browser runtime or Browserbase configuration. The backend automatically selects Browserbase when its server-side credentials are configured; otherwise local Playwright is the development fallback. A healthy `/health` response alone does not prove that production page reads are ready.

---

## 7. Local/cloud development commands

From the repository root:

```bash
pnpm install
pnpm typecheck
pnpm test -- --run
pnpm lint
pnpm format:check
pnpm build
```

Frontend-specific checks:

```bash
pnpm --filter @serena/frontend typecheck
pnpm --filter @serena/frontend build
```

Frontend development server:

```bash
pnpm --filter @serena/frontend dev --host 0.0.0.0 --port 3000 --strictPort
```

The frontend defaults to:

```text
https://serena-imperiokdbs-projects.vercel.app
```

To use another browser-safe API origin, set `VITE_SERENA_API_URL` before starting Vite.

Never put `SERENA_API_KEY` or any provider/database credential in `.env.example`, source code, the Vercel frontend environment, localStorage, cookies, or URLs.

---

## 8. Current API contract used by the frontend

### Request

```http
POST /v1/research-tasks
Authorization: Bearer <SERENA_API_KEY>
Content-Type: application/json
```

```json
{
  "request": "Compare the main purpose of these two public sources.",
  "sources": ["https://example.com/", "https://www.iana.org/help/example-domains"],
  "requiresApproval": false
}
```

Current backend validation:

- `request`: trimmed string, 1–2,000 characters;
- `sources`: 1–5 URLs;
- optional `timeoutMs`: integer from 100 to 30,000;
- optional `allowedDomains`: up to 20 non-empty domain strings;
- optional `requiresApproval`: only literal `false` is accepted.

### Response shape

```json
{
  "data": {
    "request": "...",
    "sources": [],
    "evidence": [],
    "findings": []
  },
  "requestId": "req-...",
  "taskId": "..."
}
```

Each source currently includes an ID, requested URL, final URL, title, retrieval timestamp, and cautious quality metadata. Evidence includes source ID, excerpt, locator, and verification status. Findings include claim, status, verification method, uncertainty where available, evidence IDs, and possibly `reviewRequired: true`.

The frontend currently assumes the API response has the fields represented in `frontend/src/app/types.ts`. If the backend response changes, update that type boundary first and add a contract test before changing the visual components.

---

## 9. Security boundaries and threat model

### Browser/frontend boundary

The frontend is untrusted client code. It may know the API origin. It must not know:

- Groq credentials;
- Supabase service-role credentials;
- database connection strings;
- Browserbase credentials;
- raw passwords;
- browser storage state or cookies.

The current manually entered bearer key is a temporary prototype compromise. It should be replaced with user authentication and user-scoped authorization before making Serena broadly accessible.

### Backend/browser boundary

Every URL and redirect must remain subject to SSRF policy. Continue blocking localhost, private IP ranges, cloud metadata endpoints, unsupported schemes, credentials in URLs, unusual ports, and redirects into blocked networks.

### AI/content boundary

Model outputs are not automatically true. Page content can contain prompt injection. The model may not expand domain scope, override security policy, invent tools, or authorize consequential actions.

### Browser-session boundary

When authenticated browser sessions are eventually added:

- one isolated context per account/site session;
- encrypted storage state outside Git;
- no raw passwords in logs, prompts, tables, screenshots, or errors;
- human assistance for MFA, CAPTCHA, passkeys, or suspicious login challenges;
- explicit approval for account changes or consequential actions;
- audited session use and revocation/deletion controls.

### Resource-abuse boundary

Add budgets for pages, bytes, redirects, browser minutes, downloads, model calls, concurrency, and total task duration. Do not add open-ended crawling.

---

## 10. Remaining known limitations

1. **Frontend authentication is not production-grade.** The user manually enters a bearer key into the browser. Replace this with Supabase Auth or another properly scoped authentication model.
2. **Frontend has no research history view.** It only displays the latest result in memory.
3. **No task progress endpoint is implemented yet.** The current research route performs the controlled research flow and returns the result; the roadmap’s queued/running/progress endpoints remain future work.
4. **CORS does not yet include the future Vercel frontend origin.** Update the backend after the owner provides the deployed frontend URL.
5. **The frontend type contract is manually maintained.** Add generated or tested API contracts later.
6. **No relational `findings` and `finding_evidence` persistence migration has been completed as a separate milestone.** The current result and evidence persistence should be inspected before adding the relational model.
7. **Production browser execution depends on Browserbase or a compatible Playwright runtime.** Vercel health does not prove browser execution readiness.
8. **Source quality is deliberately cautious.** Domain categories are signals, not authority, and should never be displayed as credibility guarantees.
9. **No authenticated persistent sessions, crawling, scheduling, memory retrieval, or Scholars machine-to-machine integration is complete.** These are future phases.
10. **The frontend plan document’s status line says implementation has not started.** This is stale after commit `eb3e65f`; update it if maintaining documentation consistency.

---

## 11. Recommended next milestones

### Immediate milestone A — Owner deploys frontend

The owner deploys `frontend/` to Vercel, tests the harmless example research request, and reports only the frontend URL and error messages—not the API key.

**Completion criteria:** dashboard loads from Vercel, the API origin is configured, and the request either completes or produces a specific CORS/auth/backend error.

### Immediate milestone B — Fix exact CORS and verify end-to-end

Add the deployed Vercel origin to the backend CORS allowlist, push the change, redeploy the API, and repeat the harmless test.

**Completion criteria:** the browser can submit a request from the deployed frontend and display evidence-linked findings.

### Milestone C — Secure authentication and user ownership

Replace the manual bearer key with real authentication. Associate research tasks, sources, evidence, findings, and execution events with a user identity. Enforce user-scoped authorization and RLS.

**Completion criteria:** one user cannot read or mutate another user’s research records; no application-wide API key is exposed to the browser.

### Milestone D — Research task history and progress

Add task list/history, task detail, progress events, status, timestamps, error states, cancellation where safe, and retry behavior. Introduce `GET /v1/research-tasks/:id`, result retrieval, and events only after designing authorization and persistence semantics.

**Completion criteria:** a user can submit, refresh, inspect, and delete their own tasks without losing provenance.

### Milestone E — Relational findings model

Implement planned `findings` and `finding_evidence` tables, migrations, repositories, and tests. Preserve verification method, uncertainty, source/evidence relationships, and deletion/retention behavior.

**Completion criteria:** findings can be queried independently, linked to evidence through relations, and deleted according to policy.

### Milestone F — Controlled discovery/crawling

Add search/discovery only with explicit scope, domain allowlists, deduplication, rate limits, request budgets, queue state, and termination rules. Consider Crawlee only when the deterministic URL-input workflow is insufficient.

**Completion criteria:** a crawl cannot leave its allowed scope or exceed its resource budget, and duplicate suppression is recorded.

### Milestone G — AI planning behind declared tools

Introduce a model-generated plan that can call only typed Serena tools. Use bounded execution: plan, execute one step, validate, continue or stop. Add prompt-injection evaluation fixtures.

**Completion criteria:** invalid plans are rejected, web content cannot rewrite Serena’s policy, and all tool calls are auditable.

### Milestone H — Workers and scheduling

Move long-running research out of the HTTP request. Start with one worker and database-backed task state. Add a queue only when measured concurrency requires it. Add idempotency keys and bounded per-user concurrency.

### Milestone I — Browser sessions

Add account records, encrypted storage-state references, isolated contexts, human-assisted login, expiry detection, revocation, and audit logs. Do not automate consequential account actions without approval.

### Milestone J — Memory and continuous improvement

Define memory types: durable knowledge, project context, preferences, temporary notes, and unverified assumptions. Store provenance, corrections, deletion status, retention, and scope. Begin with PostgreSQL metadata/full-text retrieval; add embeddings only after evaluation demonstrates a need.

---

## 12. Recommended first instructions for the next Manus account

Paste or summarize this sequence to the next account:

1. Open <https://github.com/ImperioKDB/serena> and inspect commit `eb3e65f`.
2. Read `docs/SERENA_HANDOFF.md`, `docs/architecture-roadmap.md`, `docs/deployment.md`, `frontend/README.md`, and `src/api/app.ts`.
3. Do not redesign the architecture or add microservices without a specific requirement.
4. Ask the owner for the deployed Vercel frontend URL only if it is not already available.
5. Update the backend CORS allowlist with the exact frontend origin; do not ask for or handle the API key.
6. Run the existing validation commands before and after the change.
7. Verify the frontend’s harmless example request and distinguish CORS, authentication, persistence, browser-runtime, and AI-provider failures.
8. After the deployed flow works, plan the authentication/user-ownership milestone before adding history or more autonomous behavior.
9. Push changes directly to `main` only after validation, preserving the existing GitHub remote and avoiding force-pushes.

---

## 13. Completion checklist for handoff

A receiving account should be able to confirm:

- [ ] It is working from `ImperioKDB/serena`.
- [ ] It has read this document and the architecture roadmap.
- [ ] It understands that the frontend is already implemented under `frontend/`.
- [ ] It understands that the frontend must not receive provider/database/browser credentials.
- [ ] It knows that the future frontend Vercel origin must be added to backend CORS.
- [ ] It can run backend and frontend typechecks/build/tests.
- [ ] It can deploy or inspect the frontend without requesting the owner’s API key.
- [ ] It can identify the difference between the current prototype and production-grade authentication.
- [ ] It will preserve evidence provenance and verification uncertainty.
- [ ] It will require human approval for consequential actions.
- [ ] It will continue from the immediate deployment/CORS milestone rather than rebuilding completed work.

---

## 14. Canonical references

- Repository: <https://github.com/ImperioKDB/serena>
- Latest frontend commit: <https://github.com/ImperioKDB/serena/commit/eb3e65f>
- Architecture roadmap: [`docs/architecture-roadmap.md`](architecture-roadmap.md)
- Backend deployment notes: [`docs/deployment.md`](deployment.md)
- Frontend design plan: [`docs/frontend-design-plan.md`](frontend-design-plan.md)
- Frontend setup: [`frontend/README.md`](../frontend/README.md)
- Emil Kowalski design references: <https://github.com/emilkowalski/skills>
- Playwright documentation: <https://playwright.dev/docs/intro>
- Fastify TypeScript documentation: <https://fastify.dev/docs/latest/Reference/TypeScript/>
- Supabase documentation: <https://supabase.com/docs>

**Do not include secrets in this document.**
