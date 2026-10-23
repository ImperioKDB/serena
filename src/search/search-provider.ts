export interface SearchCandidate {
  url: string;
  title: string;
  rank: number;
}

export interface SearchProviderResponse {
  provider: string;
  candidates: SearchCandidate[];
}

export type SearchProviderFailureKind =
  'timeout' | 'network_error' | 'upstream_http_error' | 'invalid_response' | 'unknown';

export interface SearchProviderFailureDiagnostic {
  provider: string;
  kind: SearchProviderFailureKind;
  statusCode?: number;
}

export class SearchProviderError extends Error {
  public constructor(
    public readonly provider: string,
    public readonly kind: SearchProviderFailureKind,
    public readonly statusCode?: number,
  ) {
    super('Search provider request failed.');
    this.name = 'SearchProviderError';
  }
}

export interface SearchProvider {
  readonly name: string;
  search(
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<SearchProviderResponse>;
}
