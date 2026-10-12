import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { validatePublicDestination, validateTargetUrl } from '../src/core/policy.js';
import { BrowserReadError } from '../src/core/result.js';
import { installRequestGuard } from '../src/browser/request-guard.js';

describe('URL and destination policy', () => {
  it.each([
    'https://127.0.0.1/private',
    'https://10.0.0.1/private',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/private',
    'https://[fc00::1]/private',
    'https://[fe80::1]/private',
    'https://[::ffff:7f00:1]/private',
    'https://203.0.113.10/documentation-only',
  ])('rejects private/reserved literal target %s', (target) => {
    expect(() => validateTargetUrl(target)).toThrowError(BrowserReadError);
  });

  it('rejects non-default HTTPS ports', () => {
    expect(() => validateTargetUrl('https://example.com:8443/article')).toThrowError(
      'Only the default HTTPS port is allowed.',
    );
  });

  it('normalizes domain allowlists while preserving subdomain boundaries', () => {
    expect(() =>
      validateTargetUrl('https://WWW.Example.com./article', { allowedDomains: [' example.com. '] }),
    ).not.toThrow();
    expect(() =>
      validateTargetUrl('https://notexample.com/article', { allowedDomains: ['example.com'] }),
    ).toThrowError('Target is outside the allowed domain policy.');
  });

  it('allows the explicit local HTTP fixture exception only for loopback', () => {
    expect(() =>
      validateTargetUrl('http://127.0.0.1:3210/article', { allowLocalHttp: true }),
    ).not.toThrow();
    expect(() =>
      validateTargetUrl('http://10.0.0.1:3210/article', { allowLocalHttp: true }),
    ).toThrowError('Only HTTPS URLs are allowed.');
  });

  it('rejects public-looking hostnames that resolve to reserved addresses', async () => {
    const target = validateTargetUrl('https://public.example/article');
    await expect(
      validatePublicDestination(target, {}, async () => ['93.184.216.34', '169.254.169.254']),
    ).rejects.toThrowError('Target resolves to a private or reserved IP address.');
  });

  it('rejects private IPv6 DNS answers and permits public DNS answers', async () => {
    const target = validateTargetUrl('https://public.example/article');
    await expect(
      validatePublicDestination(target, {}, async () => ['fd00::1']),
    ).rejects.toThrowError('Target resolves to a private or reserved IP address.');
    await expect(
      validatePublicDestination(target, {}, async () => [
        '93.184.216.34',
        '2606:2800:220:1:248:1893:25c8:1946',
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects unresolved names and empty DNS results', async () => {
    const target = validateTargetUrl('https://public.example/article');
    await expect(validatePublicDestination(target, {}, async () => [])).rejects.toThrowError(
      'Target resolves to a private or reserved IP address.',
    );
    await expect(
      validatePublicDestination(target, {}, async () => {
        throw new Error('DNS failure');
      }),
    ).rejects.toThrowError('Target hostname could not be safely resolved.');
  });

  it('aborts a direct private request before opening a socket', async () => {
    let onRoute: ((route: never) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(async (_pattern: string, handler: (route: never) => Promise<void>) => {
        onRoute = handler;
      }),
    };
    const guard = await installRequestGuard(context as never, {});
    const abort = vi.fn(async () => undefined);
    const route = {
      request: () => ({
        url: () => 'https://127.0.0.1/private',
        resourceType: () => 'document',
        method: () => 'GET',
        isNavigationRequest: () => true,
      }),
      abort,
      fulfill: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    };

    await onRoute?.(route as never);

    expect(abort).toHaveBeenCalledWith('blockedbyclient');
    expect(guard.getPolicyError()?.code).toBe('INVALID_TARGET');
    expect(route.continue).not.toHaveBeenCalled();
  });
});
