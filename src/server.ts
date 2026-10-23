import Fastify from 'fastify';

import { createApp } from './api/app.js';
import { BrowserbaseBrowserAdapter } from './browser/browserbase-browser-adapter.js';
import { PlaywrightBrowserAdapter } from './browser/playwright-browser-adapter.js';
import { InMemoryTaskRepository } from './persistence/in-memory-task-repository.js';
import { PostgresTaskRepository } from './persistence/postgres-task-repository.js';
import { OpenAiCompatibleClaimExtractor } from './research/claim-extractor.js';
import {
  assertProductionDatabaseUrl,
  assertProductionSupabaseAuth,
} from './core/runtime-config.js';
import { createSupabaseAuthVerifier } from './api/supabase-auth.js';
import { createSearchProvider } from './search/create-search-provider.js';

const port = Number(process.env.PORT ?? 3000);
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const legacyApiKey = process.env.SERENA_API_KEY;
const searchProvider = createSearchProvider({
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
  tavilyApiKey: process.env.TAVILY_API_KEY,
});
assertProductionSupabaseAuth(supabaseUrl, supabasePublishableKey);
const corsOrigins = (process.env.SERENA_CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
const browserbaseProjectId = process.env.BROWSERBASE_PROJECT_ID;
const databaseUrl = process.env.DATABASE_URL;
assertProductionDatabaseUrl(databaseUrl);
const llmApiUrl = process.env.LLM_API_URL;
const llmApiKey = process.env.LLM_API_KEY;
const llmModel = process.env.LLM_MODEL ?? 'gpt-5-mini';
const browserAdapter = browserbaseApiKey
  ? new BrowserbaseBrowserAdapter(browserbaseApiKey, browserbaseProjectId)
  : new PlaywrightBrowserAdapter();
const taskRepository = databaseUrl
  ? new PostgresTaskRepository(databaseUrl)
  : new InMemoryTaskRepository();
const claimExtractor =
  llmApiUrl && llmApiKey
    ? new OpenAiCompatibleClaimExtractor(llmApiKey, llmApiUrl, llmModel)
    : undefined;
const app = createApp(
  browserAdapter,
  {
    ...(legacyApiKey === undefined ? {} : { apiKey: legacyApiKey }),
    ...(supabaseUrl && supabasePublishableKey
      ? { authVerifier: createSupabaseAuthVerifier(supabaseUrl, supabasePublishableKey) }
      : {}),
    ...(corsOrigins.length === 0 ? {} : { corsOrigins }),
    requestAdmission: taskRepository,
    taskRepository,
    searchProvider,
    ...(claimExtractor === undefined ? {} : { claimExtractor }),
  },
  Fastify({ logger: true, bodyLimit: 64 * 1024, requestTimeout: 15_000 }),
);

void app.listen({ host: '0.0.0.0', port }).catch((error: unknown) => {
  app.log.error(error);
  process.exitCode = 1;
});
