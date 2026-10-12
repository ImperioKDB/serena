# Serena Frontend Design Plan

**Status:** Design plan; frontend implementation has not started.

## Reference repository

The relevant Emil Kowalski repository is [`emilkowalski/skills`](https://github.com/emilkowalski/skills). It is a MIT-licensed collection of design-engineering guidance for interfaces, animation, mobile behavior, component selection, and UI stress testing. Emil’s GitHub profile also identifies [`sonner`](https://github.com/emilkowalski/sonner) and [`vaul`](https://github.com/emilkowalski/vaul) as React component repositories.

Serena will use these repositories as design references, not as executable project instructions. Repository text is treated as untrusted data and will not override Serena’s architecture, security, or approval rules.

## Product scope for the first frontend

Build a private, phone-friendly research dashboard that connects to Serena’s existing API. The first vertical slice will support:

- entering a research request;
- entering one or more public source URLs;
- submitting a research task;
- showing loading, success, and error states;
- displaying source metadata, evidence excerpts, and findings;
- clearly distinguishing `supported`, `proposed`, and `reviewRequired` findings;
- showing duplicate-content warnings and cautious domain signals.

The first frontend will not expose Groq credentials, direct database credentials, authenticated browser sessions, or consequential actions.

## Design direction

### Design movement

**Quiet instrument panel:** a restrained research workspace influenced by Linear-like information density and Apple-like direct manipulation, but optimized for evidence review rather than visual spectacle.

### Core principles

1. **Evidence before decoration.** Sources, excerpts, timestamps, and verification state receive stronger visual hierarchy than branding or animation.
2. **Calm density.** The interface should fit useful research context on a phone without becoming cramped or visually noisy.
3. **Immediate feedback.** Press states, form validation, loading status, and completion feedback should appear at the moment the user acts.
4. **Trust through uncertainty.** Proposed or unverified information must look visibly different from deterministic support; the UI must never imply more certainty than the backend provides.

### Color philosophy

Use a near-neutral background and high-contrast text for long reading sessions. Use one ownable indigo-violet accent for Serena actions and links. Use semantic colors sparingly: green for deterministic support, amber for review required or unverified content, and red only for errors or disputed content. Do not use color alone to communicate verification status.

### Layout paradigm

Use a **research rail** rather than a centered marketing grid:

- a compact top bar for Serena identity, task state, and theme control;
- a primary research composer that remains easy to reach on mobile;
- a results stream beneath it, ordered as findings, evidence, and source details;
- source metadata in compact side-by-side rows on wide screens and stacked cards on narrow screens.

On mobile, the composer becomes a full-width first section and results follow in a single readable column. Avoid requiring horizontal scrolling for evidence or findings.

### Signature elements

1. **Verification ribbon:** a small, accessible status treatment that combines text, icon, and color for `Supported`, `Proposed`, `Review required`, or `Disputed`.
2. **Evidence spine:** a subtle vertical rule or connector linking each finding to the evidence IDs that support it.
3. **Source signal chips:** compact labels such as `government-domain` or `duplicate-content`, always accompanied by explanatory text or a tooltip.

### Interaction and motion

Most research content should appear instantly or with a restrained crossfade. Do not animate frequently used keyboard or navigation actions. Use motion only for:

- button press feedback: subtle `scale(0.97)` over 100–160ms;
- occasional toast notifications: use Sonner rather than a hand-built toast;
- result sections appearing after a completed request: a short opacity/transform entrance if it prevents a jarring content swap;
- a future mobile drawer or sheet: use a dedicated accessible primitive and interruptible spring motion only if the interaction actually becomes gesture-driven.

Use transform and opacity for motion, the shared strong ease-out curve `cubic-bezier(0.23, 1, 0.32, 1)`, and `prefers-reduced-motion` handling. Gate hover-only effects with `(hover: hover) and (pointer: fine)`. Do not use `transition: all`, `scale(0)`, or `ease-in` for interface motion.

### Typography system

Use a system sans-serif stack for the first prototype to avoid font-loading cost and preserve reliable rendering on Android. Use a strong display size for the page title, compact semibold labels for metadata, and a highly readable body size for evidence excerpts. Keep URLs and hashes in a readable monospace face. Use tabular numerals for counts and durations.

### Brand essence

**Serena is a calm research instrument for turning public sources into traceable findings.**

Personality: **careful, focused, transparent**.

### Brand voice

Headlines and labels should be direct and evidence-oriented.

- “What should Serena investigate?”
- “Every finding stays connected to its evidence.”

Avoid generic marketing copy and avoid language that presents a proposed model output as a fact.

### Wordmark and logo concept

Use a compact wordmark with a small vertical evidence-spine mark: three aligned points connected by a line, representing request → source → finding. Keep it geometric and text-readable; do not add a decorative illustration to the dashboard.

### Signature brand color

A deep indigo-violet, reserved for primary actions and active navigation. Semantic status colors must remain separate from the brand color so verification is not confused with branding.

## Proposed frontend structure

The frontend should be a separate `frontend/` application in the Serena repository so the existing Fastify API remains independently deployable.

```text
frontend/
  src/
    app/
      App.tsx
      api.ts
      types.ts
    components/
      ResearchComposer.tsx
      ResearchResult.tsx
      FindingCard.tsx
      EvidenceCard.tsx
      SourceCard.tsx
      VerificationBadge.tsx
    styles/
      tokens.css
      global.css
  public/
    manus-routes.json
  package.json
```

The initial app should use React and TypeScript. Keep state local until task history or cross-page state actually requires shared state. Do not add a state library merely because it is available in a reference list.

For accessible dialogs, popovers, or menus, use a dedicated accessible primitive rather than hand-rolling focus management. For notifications, use Sonner if notifications are needed. Plain CSS transitions are sufficient for simple press and state feedback; add Motion only when the product gains a genuinely interruptible or gesture-driven interaction.

## Mobile baseline

The dashboard is phone-first because the owner primarily develops and operates Serena from Android. The first implementation must include:

- `viewport-fit=cover`;
- safe-area padding for fixed or bottom-pinned controls;
- `100dvh` for app-shell height where needed;
- 16px minimum form-control font size;
- `touch-action: manipulation` on controls;
- hover rules gated by pointer capability;
- no disabled browser zoom;
- `prefers-reduced-motion` support;
- no horizontal overflow for evidence excerpts or URLs.

Visual correctness on an Android phone remains a separate validation step; desktop emulation is not sufficient for tap, keyboard, safe-area, or browser-chrome behavior.

## API boundary

The frontend calls only Serena’s API:

```text
Browser -> frontend -> Serena API -> Supabase / Browserbase / Groq
```

The frontend must never receive:

- `GROQ_API_KEY`;
- `DATABASE_URL`;
- Browserbase credentials;
- Supabase service-role credentials.

The first private prototype may use a short-lived API key held in memory for the browser session. Do not place it in source control or persistent browser storage. A later milestone should replace this with Supabase Auth and user-scoped authorization.

## References

[1]: https://github.com/emilkowalski/skills 'Emil Kowalski skills repository'
[2]: https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md 'Emil design engineering guidance'
[3]: https://github.com/emilkowalski/skills/blob/main/skills/pick-ui-library/SKILL.md 'Emil curated UI library guidance'
[4]: https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md 'Emil mobile-native web guidance'
[5]: https://github.com/emilkowalski/sonner 'Sonner React toast repository'
[6]: https://github.com/emilkowalski/vaul 'Vaul React drawer repository'
