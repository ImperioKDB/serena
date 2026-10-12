import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PlaywrightBrowserAdapter } from '../src/browser/playwright-browser-adapter.js';

const fixturePath = fileURLToPath(new URL('./fixtures/article.html', import.meta.url));
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const fixture = await readFile(fixturePath, 'utf8');
  server = createServer((request, response) => {
    if (request.url === '/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end(fixture);
      }, 250);
      return;
    }

    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/article' });
      response.end();
      return;
    }

    if (request.url === '/private-redirect') {
      response.writeHead(302, { location: 'https://127.0.0.1/private' });
      response.end();
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixture);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP address.');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('PlaywrightBrowserAdapter', () => {
  it('reads the title and visible text from a local fixture server', async () => {
    const adapter = new PlaywrightBrowserAdapter();
    const result = await adapter.readPage(`${baseUrl}/article`, { allowLocalHttp: true });

    expect(result.title).toBe('Serena Fixture Article');
    expect(result.text).toContain('This fixture verifies deterministic page reading.');
    expect(result.finalUrl).toBe(`${baseUrl}/article`);
    expect(result.retrievedAt).toMatch(/Z$/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records the final URL after a redirect', async () => {
    const adapter = new PlaywrightBrowserAdapter();
    const result = await adapter.readPage(`${baseUrl}/redirect`, { allowLocalHttp: true });

    expect(result.url).toBe(`${baseUrl}/redirect`);
    expect(result.finalUrl).toBe(`${baseUrl}/article`);
  });

  it('rejects redirects to private IP destinations with a typed policy error', async () => {
    const adapter = new PlaywrightBrowserAdapter();

    await expect(
      adapter.readPage(`${baseUrl}/private-redirect`, { allowLocalHttp: true }),
    ).rejects.toMatchObject({ code: 'INVALID_TARGET' });
  });

  it('rejects non-HTTPS targets unless local HTTP is explicitly enabled', async () => {
    const adapter = new PlaywrightBrowserAdapter();

    await expect(adapter.readPage('http://example.com')).rejects.toMatchObject({
      code: 'INVALID_TARGET',
    });
  });

  it('rejects private network targets by default', async () => {
    const adapter = new PlaywrightBrowserAdapter();

    await expect(adapter.readPage('https://127.0.0.1/private')).rejects.toMatchObject({
      code: 'INVALID_TARGET',
    });
  });

  it('maps slow navigation to a typed timeout error', async () => {
    const adapter = new PlaywrightBrowserAdapter();

    await expect(
      adapter.readPage(`${baseUrl}/slow`, { allowLocalHttp: true, timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: 'NAVIGATION_TIMEOUT' });
  });

  it('uses isolated browser contexts for separate reads', async () => {
    const adapter = new PlaywrightBrowserAdapter();
    const first = await adapter.readPage(`${baseUrl}/article`, { allowLocalHttp: true });
    const second = await adapter.readPage(`${baseUrl}/article`, { allowLocalHttp: true });

    expect(first.text).toBe(second.text);
    expect(first.finalUrl).toBe(second.finalUrl);
  });
});
