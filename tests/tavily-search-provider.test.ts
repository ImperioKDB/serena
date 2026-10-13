import { afterEach, describe, expect, it, vi } from 'vitest';

import { TavilySearchProvider } from '../src/search/tavily-search-provider.js';

afterEach(() => vi.unstubAllGlobals());

describe('TavilySearchProvider', () => {
  it('requests bounded basic search and returns unique HTTPS candidate URLs only', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        query: 'scholarships for Nigerian undergraduates',
        search_depth: 'basic',
        max_results: 10,
        include_answer: false,
        include_raw_content: false,
      });
      return new Response(
        JSON.stringify({
          results: [
            { url: 'https://example.org/award', title: 'Award' },
            { url: 'https://example.org/award#details', title: 'Duplicate' },
            { url: 'http://insecure.example/award', title: 'Insecure' },
            { url: 'https://user:pass@example.net/award', title: 'Credentials' },
            { url: 'not a URL', title: 'Malformed' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new TavilySearchProvider('server-secret');
    const results = await provider.search('scholarships for Nigerian undergraduates');

    expect(results).toEqual([{ url: 'https://example.org/award', title: 'Award', rank: 1 }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer server-secret');
  });

  it('clamps requested result count to ten', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { max_results: number };
      expect(body.max_results).toBe(10);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await new TavilySearchProvider('key').search('query', { maxResults: 100 });
  });
});
