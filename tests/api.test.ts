import { afterEach, describe, expect, it } from 'vitest';

import type { BrowserAdapter } from '../src/browser/browser-adapter.js';
import { createApp } from '../src/api/app.js';
import { BrowserReadError, type BrowserReadResult } from '../src/core/result.js';
import { InMemoryTaskRepository } from '../src/persistence/in-memory-task-repository.js';

const successfulResult: BrowserReadResult = {
  url: 'https://example.com/article',
  finalUrl: 'https://example.com/article',
  title: 'Example article',
  text: 'Evidence text',
  retrievedAt: '2026-10-11T18:00:00.000Z',
  durationMs: 120,
};

const adapterFor = (readPage: BrowserAdapter['readPage']): BrowserAdapter => ({ readPage });

let app: Awaited<ReturnType<typeof createApp>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('Serena API', () => {
  it('returns a health response', async () => {
    app = createApp(adapterFor(async () => successfulResult));

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('validates the page-read request body', async () => {
    app = createApp(adapterFor(async () => successfulResult));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      payload: { target: 'http://example.com', unexpected: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_REQUEST');
  });

  it('requires a bearer token when API protection is configured', async () => {
    app = createApp(
      adapterFor(async () => successfulResult),
      { apiKey: 'test-key' },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      payload: { target: 'https://example.com/article' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('returns the structured page-read result', async () => {
    const readPage = async (target: string) => {
      expect(target).toBe('https://example.com/article');
      return successfulResult;
    };
    app = createApp(adapterFor(readPage));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      payload: { target: 'https://example.com/article', timeoutMs: 5_000 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(successfulResult);
    expect(response.json().requestId).toEqual(expect.any(String));
  });

  it('persists task lifecycle state when a repository is configured', async () => {
    const repository = new InMemoryTaskRepository();
    app = createApp(
      adapterFor(async () => successfulResult),
      { taskRepository: repository },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      payload: { target: 'https://example.com/article' },
    });

    const taskId = response.json().taskId as string;
    expect(response.statusCode).toBe(200);
    expect(taskId).toMatch(/^task_/);
    expect(repository.getTaskStatus(taskId)).toBe('completed');
  });

  it('maps browser errors without leaking internal details', async () => {
    const readPage = async () => {
      throw new BrowserReadError(
        'NAVIGATION_TIMEOUT',
        'internal timeout details',
        'https://example.com',
      );
    };
    app = createApp(adapterFor(readPage));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      payload: { target: 'https://example.com/article' },
    });

    expect(response.statusCode).toBe(504);
    expect(response.json().error).toMatchObject({
      code: 'NAVIGATION_TIMEOUT',
      message: 'The page did not respond before the timeout.',
    });
    expect(response.body).not.toContain('internal timeout details');
  });
});
