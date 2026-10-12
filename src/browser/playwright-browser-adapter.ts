import { chromium } from 'playwright';

import { validateTargetUrl } from '../core/policy.js';
import { BrowserReadError, type BrowserReadResult } from '../core/result.js';
import type { BrowserAdapter, BrowserReadOptions } from './browser-adapter.js';
import { installRequestGuard } from './request-guard.js';
import { resolveSafeRedirects } from './redirect-resolver.js';
import { bypassServiceWorkerNetwork } from './service-worker-guard.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_EXTRACTED_TEXT_CHARS = 50_000;

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  public async readPage(
    target: string,
    options: BrowserReadOptions = {},
  ): Promise<BrowserReadResult> {
    const validatedTarget = validateTargetUrl(target, options);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const resolvedTarget = await resolveSafeRedirects(validatedTarget, { ...options, timeoutMs });
    const startedAt = performance.now();
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      const requestGuard = await installRequestGuard(context, options);
      const page = await context.newPage();
      await bypassServiceWorkerNetwork(context, page);
      page.setDefaultNavigationTimeout(timeoutMs);
      page.setDefaultTimeout(timeoutMs);

      try {
        await page.goto(resolvedTarget.toString(), { waitUntil: 'domcontentloaded' });
        const title = await page.title();
        const text = await page
          .locator('body')
          .evaluate(
            (body, maxChars) => (body as HTMLElement).innerText.slice(0, maxChars),
            MAX_EXTRACTED_TEXT_CHARS,
          );

        return {
          url: validatedTarget.toString(),
          finalUrl: page.url(),
          title,
          text,
          retrievedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - startedAt),
        };
      } catch (error) {
        const policyError = requestGuard.getPolicyError();
        if (policyError) throw policyError;
        if (error instanceof Error && error.message.toLowerCase().includes('timeout')) {
          throw new BrowserReadError(
            'NAVIGATION_TIMEOUT',
            `Navigation timed out after ${timeoutMs} ms.`,
            validatedTarget.toString(),
          );
        }

        throw new BrowserReadError(
          'NAVIGATION_FAILED',
          'Navigation or page reading failed.',
          validatedTarget.toString(),
        );
      } finally {
        await context.close();
      }
    } catch (error) {
      if (error instanceof BrowserReadError) {
        throw error;
      }

      throw new BrowserReadError('READ_FAILED', 'The browser could not complete the page read.');
    } finally {
      await browser.close();
    }
  }
}
