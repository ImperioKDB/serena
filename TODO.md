# Serena Frontend Implementation Checklist

- Build a phone-first research composer where the user can enter a research request and one or more public source URLs, with actionable validation for empty requests, invalid URLs, and missing sources.
- Connect the composer only to Serena’s existing Fastify API and keep Groq, Supabase service-role, database, and Browserbase credentials out of browser code and browser storage.
- Show clear idle, submitting, success, and error states for the research request lifecycle, including useful API failure feedback and a retry path.
- Display findings beside their supporting evidence, with accessible text labels that distinguish supported, proposed, disputed, and review-required findings without relying on color alone.
- Display source metadata including URL, title, retrieved time, cautious domain signals, content hashes when available, and duplicate-content warnings when a source repeats another source.
- Use the approved quiet research-instrument direction: evidence-first hierarchy, calm information density, indigo-violet primary action, restrained purposeful motion, reduced-motion support, responsive phone-first layout, and no decorative dashboard imagery.
- Serve a valid `/manus-routes.json` document that declares the implemented page routes.
- Run the frontend on the configured Webdev runtime port and verify the Preview renders the dashboard without console or TypeScript errors.
- Keep the frontend source in a separate application directory and document the API base URL and private API-key behavior without committing secrets.
