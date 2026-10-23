import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSearchProvider } from '../src/search/create-search-provider.js';

afterEach(() => vi.unstubAllGlobals());

describe('createSearchProvider', () => {
  it('uses Firecrawl by default and passes its configured key only as a bearer header', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.firecrawl.dev/v2/search');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer firecrawl-test-key');
      return new Response(
        JSON.stringify({ data: { web: [{ url: 'https://example.org/award', title: 'Award' }] } }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createSearchProvider({ firecrawlApiKey: 'firecrawl-test-key' }).search(
      'find an award',
    );

    expect(result.provider).toBe('firecrawl');
    expect(result.candidates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('tries configured Tavily first, then safely falls back to Firecrawl', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://api.tavily.com/search') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tavily-test-key');
        return new Response('provider unavailable', { status: 429 });
      }
      expect(String(url)).toBe('https://api.firecrawl.dev/v2/search');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer firecrawl-test-key');
      return new Response(
        JSON.stringify({ data: { web: [{ url: 'https://example.org/award', title: 'Award' }] } }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createSearchProvider({
      firecrawlApiKey: 'firecrawl-test-key',
      tavilyApiKey: 'tavily-test-key',
    }).search('find an award');

    expect(result.provider).toBe('firecrawl');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
