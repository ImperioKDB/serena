import {
  SearchProviderError,
  type SearchProvider,
  type SearchProviderFailureDiagnostic,
  type SearchProviderResponse,
} from './search-provider.js';

export class SearchProvidersUnavailableError extends Error {
  public constructor(public readonly failures: readonly SearchProviderFailureDiagnostic[] = []) {
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
    const failures: SearchProviderFailureDiagnostic[] = [];

    for (const provider of this.providers) {
      try {
        const result = await provider.search(query, options);
        if (result.candidates.length > 0) return result;
        emptyResult = result;
      } catch (error) {
        // Continue only through the explicitly configured, bounded provider list.
        const safeName = /^[a-z0-9_-]{1,40}$/iu.test(provider.name) ? provider.name : 'unknown';
        if (error instanceof SearchProviderError) {
          failures.push({
            provider: safeName,
            kind: error.kind,
            ...(error.statusCode !== undefined && Number.isInteger(error.statusCode)
              ? { statusCode: error.statusCode }
              : {}),
          });
        } else {
          failures.push({ provider: safeName, kind: 'unknown' });
        }
      }
    }

    if (emptyResult) return emptyResult;
    throw new SearchProvidersUnavailableError(failures);
  }
}
