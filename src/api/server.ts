import { createApp } from './app.js';
import { PlaywrightBrowserAdapter } from '../browser/playwright-browser-adapter.js';
import { InMemoryTaskRepository } from '../persistence/in-memory-task-repository.js';
import { PostgresTaskRepository } from '../persistence/postgres-task-repository.js';
import {
  assertProductionDatabaseUrl,
  assertProductionSupabaseAuth,
} from '../core/runtime-config.js';
import { createSupabaseAuthVerifier } from './supabase-auth.js';
import { FirecrawlSearchProvider } from '../search/firecrawl-search-provider.js';
import { FallbackSearchProvider } from '../search/fallback-search-provider.js';
import { TavilySearchProvider } from '../search/tavily-search-provider.js';

const port = Number(process.env.PORT ?? 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const legacyApiKey = process.env.SERENA_API_KEY;
const tavilyApiKey = process.env.TAVILY_API_KEY;
const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
const searchProvider = new FallbackSearchProvider(
  tavilyApiKey
    ? [new TavilySearchProvider(tavilyApiKey), new FirecrawlSearchProvider(firecrawlApiKey)]
    : [new FirecrawlSearchProvider(firecrawlApiKey)],
);
assertProductionSupabaseAuth(supabaseUrl, supabasePublishableKey);
const corsOrigins = (process.env.SERENA_CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const databaseUrl = process.env.DATABASE_URL;
assertProductionDatabaseUrl(databaseUrl);
const taskRepository = databaseUrl
  ? new PostgresTaskRepository(databaseUrl)
  : new InMemoryTaskRepository();
const app = createApp(new PlaywrightBrowserAdapter(), {
  ...(legacyApiKey === undefined ? {} : { apiKey: legacyApiKey }),
  ...(supabaseUrl && supabasePublishableKey
    ? { authVerifier: createSupabaseAuthVerifier(supabaseUrl, supabasePublishableKey) }
    : {}),
  ...(corsOrigins.length === 0 ? {} : { corsOrigins }),
  requestAdmission: taskRepository,
  taskRepository,
  searchProvider,
});

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
