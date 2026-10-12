# Serena

Serena is a modular personal AI intelligence platform for evidence-backed research, authorized browser automation, persistent knowledge, and integration with other applications such as Scholars.

## Current status

This repository currently contains the architecture baseline and phased engineering roadmap. The application has not been generated as a large batch. Development will proceed through small, tested milestones.

## First milestone

Build a deterministic public-page reader using TypeScript and Playwright. It will:

- enforce URL and domain policy;
- navigate to an explicitly supplied public URL;
- extract the final URL, title, visible text, retrieval time, and duration;
- handle timeouts and browser failures safely; and
- run against deterministic local fixtures in CI.

Authentication, AI planning, crawling, queues, memory search, and production scheduling are later phases.

## Current API

- `GET /health` checks that the service is running.
- `POST /v1/page-reads` reads one explicitly supplied public page and returns structured page data.
- `POST /v1/research-tasks` reads 1–5 supplied public URLs sequentially, returns source-linked evidence, reports cautious domain/content-quality metadata, and marks AI findings for review unless they pass deterministic exact-match verification.

Research source quality is intentionally conservative. A source can expose signals such as `government-domain`, `education-domain`, `organization-domain`, or `commercial-domain`, but these are not proof that the content is accurate. Each source also includes a normalized SHA-256 content hash so exact duplicate pages can be detected. AI-generated findings that do not match the deterministic cross-source verifier are returned as `proposed` with `reviewRequired: true`.

Set `SERENA_API_KEY` in a deployment environment to require `Authorization: Bearer <key>` for the page-read endpoint. See [`docs/second-milestone.md`](docs/second-milestone.md) for the request contract and limitations.

Persistence configuration and schema details are in [`docs/third-milestone.md`](docs/third-milestone.md).

The controlled research contract and its limitations are in [`docs/fourth-milestone.md`](docs/fourth-milestone.md).

AI-assisted claims are optional and evidence-grounded. Without an explicitly configured server-side model provider, Serena uses the deterministic matcher and does not call an AI model.

## Development workflow

1. Work from the managed development environment.
2. Make a small change on a branch.
3. Run type checks, linting, formatting checks, and tests.
4. Push the branch to GitHub.
5. Review the CI result before merging or deploying.

See [`docs/architecture-roadmap.md`](docs/architecture-roadmap.md) for the architecture, security boundaries, cost assumptions, roadmap, and first milestone acceptance criteria.

Implementation details and local verification commands are in [`docs/first-milestone.md`](docs/first-milestone.md).
