import Fastify from 'fastify';

import { createApp } from './api/app.js';
import { BrowserbaseBrowserAdapter } from './browser/browserbase-browser-adapter.js';
import { PlaywrightBrowserAdapter } from './browser/playwright-browser-adapter.js';
import { InMemoryTaskRepository } from './persistence/in-memory-task-repository.js';
import { PostgresTaskRepository } from './persistence/postgres-task-repository.js';

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.SERENA_API_KEY;
const browserbaseApiKey = process.env.BROWSERBASE_API_KEY;
const browserbaseProjectId = process.env.BROWSERBASE_PROJECT_ID;
const databaseUrl = process.env.DATABASE_URL;
const browserAdapter = browserbaseApiKey
  ? new BrowserbaseBrowserAdapter(browserbaseApiKey, browserbaseProjectId)
  : new PlaywrightBrowserAdapter();
const taskRepository = databaseUrl
  ? new PostgresTaskRepository(databaseUrl)
  : new InMemoryTaskRepository();
const app = createApp(
  browserAdapter,
  {
    ...(apiKey === undefined ? {} : { apiKey }),
    taskRepository,
  },
  Fastify({ logger: true }),
);

void app.listen({ host: '0.0.0.0', port }).catch((error: unknown) => {
  app.log.error(error);
  process.exitCode = 1;
});
