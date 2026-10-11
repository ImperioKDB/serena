import Browserbase from '@browserbasehq/sdk';
import { chromium } from 'playwright-core';

import { validateTargetUrl } from '../core/policy.js';
import { BrowserReadError, type BrowserReadResult } from '../core/result.js';
import type { BrowserAdapter, BrowserReadOptions } from './browser-adapter.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_SESSION_TIMEOUT_SECONDS = 21_600;

export class BrowserbaseBrowserAdapter implements BrowserAdapter {
  private readonly client: Browserbase;
  private readonly projectId: string | undefined;

  public constructor(apiKey: string, projectId?: string) {
    this.client = new Browserbase({ apiKey });
    this.projectId = projectId;
  }

  public async readPage(
    target: string,
    options: BrowserReadOptions = {},
  ): Promise<BrowserReadResult> {
    const validatedTarget = validateTargetUrl(target, options);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = performance.now();
    const retrievedAt = new Date().toISOString();
    const sessionTimeoutSeconds = Math.min(
      MAX_SESSION_TIMEOUT_SECONDS,
      Math.max(60, Math.ceil(timeoutMs / 1000) + 30),
    );

    const session = await this.client.sessions.create({
      api_timeout: sessionTimeoutSeconds,
      keepAlive: false,
      ...(this.projectId === undefined ? {} : { projectId: this.projectId }),
    });
    const browser = await chromium.connectOverCDP(session.connectUrl);

    try {
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const page = context.pages()[0] ?? (await context.newPage());
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

      throw new BrowserReadError(
        'READ_FAILED',
        'The cloud browser could not complete the page read.',
      );
    } finally {
      await browser.close();
    }
  }
}
