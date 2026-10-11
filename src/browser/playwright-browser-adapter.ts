import { chromium } from 'playwright';

import { validateTargetUrl } from '../core/policy.js';
import { BrowserReadError, type BrowserReadResult } from '../core/result.js';
import type { BrowserAdapter, BrowserReadOptions } from './browser-adapter.js';

const DEFAULT_TIMEOUT_MS = 10_000;

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  public async readPage(
    target: string,
    options: BrowserReadOptions = {},
  ): Promise<BrowserReadResult> {
    const validatedTarget = validateTargetUrl(target, options);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = performance.now();
    const retrievedAt = new Date().toISOString();
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(timeoutMs);

      try {
        await page.goto(validatedTarget.toString(), { waitUntil: 'domcontentloaded' });
        const title = await page.title();
        const text = await page.locator('body').innerText();

        return {
          url: validatedTarget.toString(),
          finalUrl: page.url(),
          title,
          text,
          retrievedAt,
          durationMs: Math.round(performance.now() - startedAt),
        };
      } catch (error) {
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
