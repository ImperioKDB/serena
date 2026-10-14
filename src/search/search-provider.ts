export interface SearchCandidate {
  url: string;
  title: string;
  rank: number;
}

export interface SearchProviderResponse {
  provider: string;
  candidates: SearchCandidate[];
}

export interface SearchProvider {
  readonly name: string;
  search(
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<SearchProviderResponse>;
}
