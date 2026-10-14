import type { SearchProvider, SearchProviderResponse } from './search-provider.js';

export class SearchProvidersUnavailableError extends Error {
  public constructor() {
    super('All configured search providers are unavailable.');
    this.name = 'SearchProvidersUnavailableError';
  }
}

export class FallbackSearchProvider implements SearchProvider {
  public readonly name = 'fallback';

  public constructor(private readonly providers: readonly SearchProvider[]) {
    if (providers.length === 0) throw new Error('At least one search provider is required.');
  }

  public async search(
    query: string,
    options: { maxResults?: number; signal?: AbortSignal } = {},
  ): Promise<SearchProviderResponse> {
    let emptyResult: SearchProviderResponse | undefined;

    for (const provider of this.providers) {
      try {
        const result = await provider.search(query, options);
        if (result.candidates.length > 0) return result;
        emptyResult = result;
      } catch {
        // Continue only through the explicitly configured, bounded provider list.
      }
    }

    if (emptyResult) return emptyResult;
    throw new SearchProvidersUnavailableError();
  }
}
