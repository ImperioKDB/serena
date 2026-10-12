import { validatePublicDestination, validateTargetUrl } from '../core/policy.js';
import { BrowserReadError } from '../core/result.js';
import type { BrowserReadOptions } from './browser-adapter.js';

const MAX_REDIRECT_HOPS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;

export async function resolveSafeRedirects(
  initialTarget: URL,
  options: BrowserReadOptions = {},
): Promise<URL> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let currentTarget = initialTarget;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    await validatePublicDestination(currentTarget, options);
    let response: Response;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      response = await fetch(currentTarget, {
        method: 'GET',
        redirect: 'manual',
        signal,
      });
    } catch {
      if (signal.aborted) {
        throw new BrowserReadError(
          'NAVIGATION_TIMEOUT',
          `Navigation timed out after ${timeoutMs} ms.`,
          currentTarget.toString(),
        );
      }
      throw new BrowserReadError('NAVIGATION_FAILED', 'Could not safely resolve the target page.');
    }

    const location = response.headers.get('location');
    const isRedirect = response.status >= 300 && response.status < 400;
    await response.body?.cancel().catch(() => undefined);
    if (!isRedirect || !location) return currentTarget;
    if (hop === MAX_REDIRECT_HOPS) {
      throw new BrowserReadError('NAVIGATION_FAILED', 'Page exceeded its redirect budget.');
    }

    let nextTarget: URL;
    try {
      nextTarget = validateTargetUrl(new URL(location, currentTarget).toString(), options);
    } catch (error) {
      if (error instanceof BrowserReadError) throw error;
      throw new BrowserReadError('INVALID_TARGET', 'Redirect target is invalid.');
    }
    await validatePublicDestination(nextTarget, options);
    currentTarget = nextTarget;
  }

  throw new BrowserReadError('NAVIGATION_FAILED', 'Page exceeded its redirect budget.');
}
