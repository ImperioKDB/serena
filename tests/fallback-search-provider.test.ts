import { describe, expect, it, vi } from 'vitest';

import {
  FallbackSearchProvider,
  SearchProvidersUnavailableError,
} from '../src/search/fallback-search-provider.js';
import {
  SearchProviderError,
  type SearchProvider,
  type SearchProviderResponse,
} from '../src/search/search-provider.js';

function provider(name: string, search: SearchProvider['search']): SearchProvider {
  return { name, search };
}

const result = (providerName: string, count: number): SearchProviderResponse => ({
  provider: providerName,
  candidates: Array.from({ length: count }, (_, index) => ({
    url: `https://${providerName}.example/page-${index + 1}`,
    title: `${providerName} result ${index + 1}`,
    rank: index + 1,
  })),
});

describe('FallbackSearchProvider', () => {
  it('uses the next configured provider after rate-limit failure and records its identity', async () => {
    const firecrawl = provider('firecrawl', vi.fn().mockRejectedValue(new Error('HTTP 429')));
    const tavily = provider('tavily', vi.fn().mockResolvedValue(result('tavily', 2)));
    const chain = new FallbackSearchProvider([firecrawl, tavily]);

    await expect(chain.search('general research', { maxResults: 5 })).resolves.toEqual(
      result('tavily', 2),
    );
    expect(firecrawl.search).toHaveBeenCalledOnce();
    expect(tavily.search).toHaveBeenCalledOnce();
  });

  it('tries a later provider when an earlier one returns no candidates', async () => {
    const first = provider('firecrawl', vi.fn().mockResolvedValue(result('firecrawl', 0)));
    const second = provider('fallback', vi.fn().mockResolvedValue(result('fallback', 1)));
    await expect(new FallbackSearchProvider([first, second]).search('query')).resolves.toEqual(
      result('fallback', 1),
    );
  });

  it('throws a sanitized unavailable error only when every provider fails', async () => {
    const first = provider(
      'firecrawl',
      vi.fn().mockRejectedValue(new SearchProviderError('firecrawl', 'upstream_http_error', 429)),
    );
    const second = provider('tavily', vi.fn().mockRejectedValue(new Error('secret detail')));

    await expect(
      new FallbackSearchProvider([first, second]).search('private query'),
    ).rejects.toMatchObject({
      name: 'SearchProvidersUnavailableError',
      failures: [
        { provider: 'firecrawl', kind: 'upstream_http_error', statusCode: 429 },
        { provider: 'tavily', kind: 'unknown' },
      ],
    });
    await expect(
      new FallbackSearchProvider([first, second]).search('private query'),
    ).rejects.not.toThrow('secret detail');
    await expect(
      new FallbackSearchProvider([first, second]).search('private query'),
    ).rejects.not.toThrow('private query');
    await expect(
      new FallbackSearchProvider([first, second]).search('private query'),
    ).rejects.toBeInstanceOf(SearchProvidersUnavailableError);
  });
});
