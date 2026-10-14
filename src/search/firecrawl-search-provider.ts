import type { SearchCandidate, SearchProvider, SearchProviderResponse } from './search-provider.js';

const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v2/search';
const MAX_RESULTS = 10;

export class FirecrawlSearchProvider implements SearchProvider {
  public readonly name = 'firecrawl';

  public constructor(private readonly apiKey?: string) {}

  public async search(
    query: string,
    options: { maxResults?: number; signal?: AbortSignal } = {},
  ): Promise<SearchProviderResponse> {
    const limit = Math.max(1, Math.min(options.maxResults ?? MAX_RESULTS, MAX_RESULTS));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const response = await fetch(FIRECRAWL_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ query, limit, sources: [{ type: 'web' }] }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Firecrawl search returned HTTP ${response.status}.`);
      }

      const payload: unknown = await response.json();
      if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.web)) {
        throw new Error('Firecrawl search returned an invalid response.');
      }

      const candidates: SearchCandidate[] = [];
      const seen = new Set<string>();
      for (const [index, raw] of payload.data.web.entries()) {
        if (!isRecord(raw) || typeof raw.url !== 'string') continue;
        try {
          const url = new URL(raw.url);
          if (url.protocol !== 'https:' || url.username || url.password) continue;
          url.hash = '';
          const normalized = url.toString();
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          candidates.push({
            url: normalized,
            title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : '',
            rank: index + 1,
          });
          if (candidates.length >= limit) break;
        } catch {
          // The browser adapter remains the final destination and SSRF guard.
        }
      }

      return { provider: this.name, candidates };
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
