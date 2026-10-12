import type { BrowserContext, Page } from 'playwright';

/**
 * Playwright routes do not observe requests fulfilled by service workers.
 * Disable service-worker interception at the Chromium network layer so every
 * HTTP request continues to pass through Serena's context route guard.
 */
export async function bypassServiceWorkerNetwork(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  const session = await context.newCDPSession(page);
  await session.send('Network.setBypassServiceWorker', { bypass: true });
}
