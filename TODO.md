# Serena Implementation Outcomes

## Delivered dashboard and research capabilities

- The phone-first dashboard authenticates through Google using Supabase Auth and submits requests only to Serena’s Fastify API; no database, service-role, browser-provider, or model secret is shipped to browser code.
- The dashboard supports caller-provided public HTTPS sources and bounded automatic discovery, clearly communicates submitting/success/error states, and presents findings with linked evidence and source quality signals.
- Public page reads use destination and resource guards; challenge/interstitial content is excluded from evidence, and incomplete coverage is reported without claiming a false negative.
- The public frontend is hosted separately from the API, and its actual route manifest is kept in sync with deployed routes.

## In progress: user-owned research history

- A signed-in user can list only their own task summaries, newest first, using bounded pagination; list responses do not include full result payloads.
- A signed-in user can retrieve a full saved result only when the task’s `owner_id` matches the verified Supabase Auth user. Unknown task IDs and tasks belonging to another user return the same not-found response.
- A signed-in user can permanently delete only their own task after an explicit two-step confirmation in the dashboard; the task’s sources, evidence, and execution events are removed through the existing cascade relationships. Deletion of another user’s task is denied without revealing whether it exists.
- Research history requires a verified Supabase user identity; legacy server-to-server API-key callers cannot list, retrieve, or delete user history. Repository queries explicitly filter by verified `owner_id` and do not rely on RLS while using the privileged API database connection.
- Regression coverage uses two user identities to prove list, detail, and delete isolation, including that deleting one user’s task does not remove another user’s task or its records.

## Next outcomes

- Complete production deployment and verify the history experience on the phone-first dashboard; confirm the signed-in user can refresh and find prior tasks and cannot read another user’s task.
- Continue with the research reliability milestone only after history ownership/deletion has been verified; add durable background jobs only when measured runtime needs justify them.
- Later milestones: bounded AI plans and evaluations, encrypted/revocable persistent browser sessions, and deliberate personal memory with source attribution, correction, deletion, and retention controls.
