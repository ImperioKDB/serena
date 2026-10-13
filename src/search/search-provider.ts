export interface SearchCandidate {
  url: string;
  title: string;
  rank: number;
}

export interface SearchProvider {
  search(
    query: string,
    options?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<SearchCandidate[]>;
}
