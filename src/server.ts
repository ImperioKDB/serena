import Fastify from 'fastify';

import { createApp } from './api/app.js';
import { BrowserbaseBrowserAdapter } from './browser/browserbase-browser-adapter.js';
import { PlaywrightBrowserAdapter } from './browser/playwright-browser-adapter.js';
import { InMemoryTaskRepository } from './persistence/in-memory-task-repository.js';
import { PostgresTaskRepository } from './persistence/postgres-task-repository.js';
import { createModelProvider } from './research/create-model-provider.js';
import { readResearchServiceLimits } from './research/research-limits.js';
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
const claimExtractor = createModelProvider({
  environment: process.env,
  onFailure: (diagnostic) => {
    console.warn(
      JSON.stringify({
        event: 'serena_model_provider_failure',
        provider: diagnostic.provider,
        operation: diagnostic.operation,
        kind: diagnostic.kind,
        ...(diagnostic.statusCode === undefined ? {} : { statusCode: diagnostic.statusCode }),
        ...(diagnostic.errorCode === undefined ? {} : { errorCode: diagnostic.errorCode }),
        ...(diagnostic.attemptCount === undefined ? {} : { attemptCount: diagnostic.attemptCount }),
        ...(diagnostic.retryCount === undefined ? {} : { retryCount: diagnostic.retryCount }),
        ...(diagnostic.durationMs === undefined ? {} : { durationMs: diagnostic.durationMs }),
      }),
    );
  },
});
const researchLimits = readResearchServiceLimits(process.env);
const browserAdapter = browserbaseApiKey
  ? new BrowserbaseBrowserAdapter(browserbaseApiKey, browserbaseProjectId)
  : new PlaywrightBrowserAdapter();
const taskRepository = databaseUrl
  ? new PostgresTaskRepository(databaseUrl)
  : new InMemoryTaskRepository();
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
    researchLimits,
    ...(claimExtractor === undefined ? {} : { claimExtractor }),
  },
  Fastify({ logger: true, bodyLimit: 64 * 1024, requestTimeout: 15_000 }),
);

void app.listen({ host: '0.0.0.0', port }).catch((error: unknown) => {
  app.log.error(error);
  process.exitCode = 1;
});
