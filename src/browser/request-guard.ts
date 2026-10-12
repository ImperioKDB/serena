import type { BrowserContext, Route } from 'playwright';

import { validatePublicDestination, validateTargetUrl } from '../core/policy.js';
import { BrowserReadError } from '../core/result.js';
import type { BrowserReadOptions } from './browser-adapter.js';

const MAX_PAGE_REQUESTS = 80;
const DEFAULT_TIMEOUT_MS = 10_000;
const BLOCKED_RESOURCE_TYPES = new Set(['font', 'image', 'media']);

export interface RequestGuard {
  getPolicyError(): BrowserReadError | undefined;
}

export async function installRequestGuard(
  context: BrowserContext,
  options: BrowserReadOptions,
): Promise<RequestGuard> {
  let requestCount = 0;
  let policyError: BrowserReadError | undefined;

  await context.route('**/*', async (route: Route) => {
    const request = route.request();
    requestCount += 1;
    try {
      if (requestCount > MAX_PAGE_REQUESTS) {
        throw new BrowserReadError('INVALID_TARGET', 'Page exceeded its request budget.');
      }
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
        await route.abort('blockedbyclient');
        return;
      }
      const target = validateTargetUrl(request.url(), options);
      await validatePublicDestination(target, options);
      const response = await route.fetch({
        maxRedirects: 0,
        maxRetries: 0,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const location = response.headers()['location'];
      if (response.status() >= 300 && response.status() < 400 && location) {
        const redirectTarget = validateTargetUrl(new URL(location, target).toString(), options);
        await validatePublicDestination(redirectTarget, options);
        throw new BrowserReadError(
          'NAVIGATION_FAILED',
          'A page redirected during loading; retry with the final URL directly.',
        );
      }
      await route.fulfill({ response });
    } catch (error) {
      if (error instanceof BrowserReadError && policyError === undefined) {
        policyError = error;
      }
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  });

  return { getPolicyError: () => policyError };
}
