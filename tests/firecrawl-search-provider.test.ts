import { afterEach, describe, expect, it, vi } from 'vitest';

import { FirecrawlSearchProvider } from '../src/search/firecrawl-search-provider.js';

afterEach(() => vi.unstubAllGlobals());

describe('FirecrawlSearchProvider', () => {
  it('calls the documented keyless REST endpoint and returns only unique HTTPS candidates', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.firecrawl.dev/v2/search');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      expect(JSON.parse(String(init?.body))).toEqual({
        query: 'find scholarships in Nigeria',
        limit: 10,
        sources: [{ type: 'web' }],
      });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            web: [
              { url: 'https://example.org/award', title: 'Award' },
              { url: 'https://example.org/award#detail', title: 'Duplicate' },
              { url: 'http://insecure.example/award', title: 'Insecure' },
              { url: 'https://user:pass@example.net/award', title: 'Credentials' },
              { url: 'not a URL', title: 'Malformed' },
              { url: 'https://example.com/second', title: 'Second' },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await new FirecrawlSearchProvider().search('find scholarships in Nigeria');

    expect(results).toEqual({
      provider: 'firecrawl',
      candidates: [
        { url: 'https://example.org/award', title: 'Award', rank: 1 },
        { url: 'https://example.com/second', title: 'Second', rank: 6 },
      ],
    });
  });

  it('clamps requested results to ten', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ limit: 10 });
      return new Response(JSON.stringify({ success: true, data: { web: [] } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await new FirecrawlSearchProvider().search('general query', { maxResults: 50 });
  });

  it('uses a configured API key only as a bearer header', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer free-tier-key');
      return new Response(JSON.stringify({ success: true, data: { web: [] } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await new FirecrawlSearchProvider('free-tier-key').search('query');
  });

  it('surfaces a 429 as a provider failure so the chain can use its next provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('limited', { status: 429 })),
    );

    await expect(new FirecrawlSearchProvider().search('query')).rejects.toThrow('HTTP 429');
  });
});
