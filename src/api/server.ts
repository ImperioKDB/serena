import { createApp } from './app.js';
import { PlaywrightBrowserAdapter } from '../browser/playwright-browser-adapter.js';
import { InMemoryTaskRepository } from '../persistence/in-memory-task-repository.js';
import { PostgresTaskRepository } from '../persistence/postgres-task-repository.js';
import { assertProductionApiKey, assertProductionDatabaseUrl } from '../core/runtime-config.js';

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.SERENA_API_KEY;
assertProductionApiKey(apiKey);
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
  ...(apiKey === undefined ? {} : { apiKey }),
  ...(corsOrigins.length === 0 ? {} : { corsOrigins }),
  requestAdmission: taskRepository,
  taskRepository,
});

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
