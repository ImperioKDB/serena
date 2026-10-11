import { createApp } from './app.js';
import { PlaywrightBrowserAdapter } from '../browser/playwright-browser-adapter.js';

const port = Number(process.env.PORT ?? 3000);
const apiKey = process.env.SERENA_API_KEY;
const app = createApp(new PlaywrightBrowserAdapter(), apiKey === undefined ? {} : { apiKey });

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
