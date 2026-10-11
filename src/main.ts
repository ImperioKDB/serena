import { PlaywrightBrowserAdapter } from './browser/playwright-browser-adapter.js';

const target = process.argv[2];

if (!target) {
  console.error('Usage: pnpm tsx src/main.ts <https-url>');
  process.exitCode = 1;
} else {
  const adapter = new PlaywrightBrowserAdapter();
  const result = await adapter.readPage(target);
  console.log(JSON.stringify(result, null, 2));
}
