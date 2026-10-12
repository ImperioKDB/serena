import Fastify from 'fastify';

import { createApp } from './api/app.js';
import { BrowserbaseBrowserAdapter } from './browser/browserbase-browser-adapter.js';
import { PlaywrightBrowserAdapter } from './browser/playwright-browser-adapter.js';
import { InMemoryTaskRepository } from './persistence/in-memory-task-repository.js';
import { PostgresTaskRepository } from './persistence/postgres-task-repository.js';
import { OpenAiCompatibleClaimExtractor } from './research/claim-extractor.js';
import { assertProductionApiKey, assertProductionDatabaseUrl } from './core/runtime-config.js';

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.SERENA_API_KEY;
assertProductionApiKey(apiKey);
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
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(corsOrigins.length === 0 ? {} : { corsOrigins }),
    requestAdmission: taskRepository,
    taskRepository,
    ...(claimExtractor === undefined ? {} : { claimExtractor }),
  },
  Fastify({ logger: true, bodyLimit: 64 * 1024, requestTimeout: 15_000 }),
);

void app.listen({ host: '0.0.0.0', port }).catch((error: unknown) => {
  app.log.error(error);
  process.exitCode = 1;
});
