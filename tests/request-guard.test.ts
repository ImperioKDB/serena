import type { BrowserContext, Route } from 'playwright';
import { describe, expect, it, vi } from 'vitest';

import { installRequestGuard } from '../src/browser/request-guard.js';
import { fetchPublicResponse, type SafeHttpResponse } from '../src/browser/safe-http.js';

vi.mock('../src/browser/safe-http.js', () => ({
  fetchPublicResponse: vi.fn(),
}));

const fetchPublicResponseMock = vi.mocked(fetchPublicResponse);

function routeFor(index: number): Route {
  const request = {
    url: () => `https://example.com/assets/${index}.js`,
    resourceType: () => 'script',
    method: () => 'GET',
    allHeaders: async () => ({}),
  };
  return {
    request: () => request,
    abort: vi.fn(async () => undefined),
    fulfill: vi.fn(async () => undefined),
  } as unknown as Route;
}

describe('installRequestGuard response-size diagnostics', () => {
  it('classifies an exhausted combined page budget separately from a resource limit', async () => {
    let routeHandler: ((route: Route) => void | Promise<void>) | undefined;
    const context = {
      route: async (
        _url: string,
        handler: (route: Route) => void | Promise<void>,
      ): Promise<void> => {
        routeHandler = handler;
      },
    } as unknown as BrowserContext;
    const fullResource: SafeHttpResponse = {
      statusCode: 200,
      headers: {},
      setCookies: [],
      body: Buffer.alloc(2 * 1024 * 1024),
    };
    fetchPublicResponseMock.mockResolvedValue(fullResource);

    const guard = await installRequestGuard(context, {});
    if (!routeHandler) throw new Error('Request guard route handler was not installed.');

    for (let index = 1; index <= 4; index += 1) {
      await routeHandler(routeFor(index));
    }
    const fifthRoute = routeFor(5);
    await routeHandler(fifthRoute);

    expect(fetchPublicResponseMock).toHaveBeenCalledTimes(4);
    expect(fifthRoute.abort).toHaveBeenCalledOnce();
    expect(guard.getPolicyError()).toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
      responseSizeLimitScope: 'page',
    });
  });
});
