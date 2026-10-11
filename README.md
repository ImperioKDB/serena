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

## Development workflow

1. Work from the managed development environment.
2. Make a small change on a branch.
3. Run type checks, linting, formatting checks, and tests.
4. Push the branch to GitHub.
5. Review the CI result before merging or deploying.

See [`docs/architecture-roadmap.md`](docs/architecture-roadmap.md) for the architecture, security boundaries, cost assumptions, roadmap, and first milestone acceptance criteria.

Implementation details and local verification commands are in [`docs/first-milestone.md`](docs/first-milestone.md).
