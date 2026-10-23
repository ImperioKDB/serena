import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fetchPublicResponse } from '../src/browser/safe-http.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/ok' });
      response.end();
      return;
    }
    if (request.url === '/gzip') {
      const body = gzipSync('decoded payload');
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
        'content-length': String(body.length),
      });
      response.end(body);
      return;
    }
    if (request.url === '/oversized') {
      const body = Buffer.alloc(64, 'x');
      response.writeHead(200, { 'content-length': String(body.length) });
      response.end(body);
      return;
    }
    if (request.url === '/chunked-oversized') {
      response.writeHead(200, { 'transfer-encoding': 'chunked' });
      response.end(Buffer.alloc(64, 'y'));
      return;
    }
    if (request.url === '/cookies') {
      response.writeHead(200, {
        'set-cookie': ['first=one; Path=/', 'second=two; Path=/'],
      });
      response.end('cookies');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server has no TCP address.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function get(path: string, maxResponseBytes = 1024 * 1024) {
  return fetchPublicResponse(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {},
    allowLocalHttp: true,
    timeoutMs: 2_000,
    maxResponseBytes,
  });
}

describe('IP-pinned bounded HTTP fetch', () => {
  it('returns a redirect response without following it', async () => {
    const result = await get('/redirect');

    expect(result.statusCode).toBe(302);
    expect(result.headers.location).toBe('/ok');
    expect(result.body.byteLength).toBe(0);
  });

  it('decompresses gzip within the decoded byte budget', async () => {
    const result = await get('/gzip', 64);

    expect(result.body.toString('utf8')).toBe('decoded payload');
    expect(result.headers['content-encoding']).toBeUndefined();
  });

  it('rejects a response when Content-Length exceeds the budget', async () => {
    await expect(get('/oversized', 16)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
      responseSizeLimitScope: 'resource',
    });
  });

  it('rejects a chunked response when streamed bytes exceed the budget', async () => {
    await expect(get('/chunked-oversized', 16)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
      responseSizeLimitScope: 'resource',
    });
  });

  it('preserves multiple Set-Cookie fields separately for the browser context', async () => {
    const result = await get('/cookies');

    expect(result.setCookies).toEqual(['first=one; Path=/', 'second=two; Path=/']);
  });
});
