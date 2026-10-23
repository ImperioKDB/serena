import { FallbackSearchProvider } from './fallback-search-provider.js';
import { FirecrawlSearchProvider } from './firecrawl-search-provider.js';
import type { SearchProvider } from './search-provider.js';
import { TavilySearchProvider } from './tavily-search-provider.js';

export function createSearchProvider(config: {
  firecrawlApiKey?: string | undefined;
  tavilyApiKey?: string | undefined;
}): SearchProvider {
  const firecrawl = new FirecrawlSearchProvider(config.firecrawlApiKey);
  return new FallbackSearchProvider(
    config.tavilyApiKey ? [new TavilySearchProvider(config.tavilyApiKey), firecrawl] : [firecrawl],
  );
}
