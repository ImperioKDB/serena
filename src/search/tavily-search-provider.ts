import type { SearchCandidate, SearchProvider } from './search-provider.js';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const MAX_RESULTS = 10;

export class TavilySearchProvider implements SearchProvider {
  public constructor(private readonly apiKey: string) {
    if (!apiKey.trim()) throw new Error('Tavily API key must not be empty.');
  }

  public async search(
    query: string,
    options: { maxResults?: number; signal?: AbortSignal } = {},
  ): Promise<SearchCandidate[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const response = await fetch(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: Math.max(1, Math.min(options.maxResults ?? MAX_RESULTS, MAX_RESULTS)),
          include_answer: false,
          include_raw_content: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Search provider returned HTTP ${response.status}.`);
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || !('results' in payload)) {
        throw new Error('Search provider returned an invalid response.');
      }
      const results = (payload as { results?: unknown }).results;
      if (!Array.isArray(results))
        throw new Error('Search provider returned an invalid result list.');

      const candidates: SearchCandidate[] = [];
      const seen = new Set<string>();
      for (const [index, raw] of results.entries()) {
        if (!raw || typeof raw !== 'object' || !('url' in raw)) continue;
        const rawUrl = (raw as { url?: unknown }).url;
        if (typeof rawUrl !== 'string') continue;
        try {
          const url = new URL(rawUrl);
          if (url.protocol !== 'https:' || url.username || url.password) continue;
          url.hash = '';
          const normalized = url.toString();
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          const title = (raw as { title?: unknown }).title;
          candidates.push({
            url: normalized,
            title: typeof title === 'string' ? title.slice(0, 300) : '',
            rank: index + 1,
          });
          if (
            candidates.length >=
            Math.max(1, Math.min(options.maxResults ?? MAX_RESULTS, MAX_RESULTS))
          ) {
            break;
          }
        } catch {
          // Malformed URLs are discarded; the browser adapter remains the final SSRF guard.
        }
      }
      return candidates;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
