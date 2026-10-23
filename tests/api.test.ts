import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

import type { BrowserAdapter } from '../src/browser/browser-adapter.js';
import { createApp } from '../src/api/app.js';
import { BrowserReadError, type BrowserReadResult } from '../src/core/result.js';
import { InMemoryTaskRepository } from '../src/persistence/in-memory-task-repository.js';
import type { ClaimExtractor } from '../src/research/claim-extractor.js';
import { SearchProvidersUnavailableError } from '../src/search/fallback-search-provider.js';
import type { SearchProvider } from '../src/search/search-provider.js';

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

  it('rejects request bodies larger than 64 KiB before route validation', async () => {
    const readPage = vi.fn(async () => successfulResult);
    app = createApp(adapterFor(readPage));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      payload: { target: 'https://example.com/article', padding: 'x'.repeat(70_000) },
    });

    expect(response.statusCode).toBe(413);
    expect(readPage).not.toHaveBeenCalled();
  });

  it('rejects missing Supabase access tokens when authentication is configured', async () => {
    app = createApp(
      adapterFor(async () => successfulResult),
      { authVerifier: async () => null },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      payload: { target: 'https://example.com/article' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid Supabase access token', async () => {
    app = createApp(
      adapterFor(async () => successfulResult),
      {
        authVerifier: async () => null,
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      headers: { authorization: 'Bearer expired-session' },
      payload: { target: 'https://example.com/article' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('retains legacy API-key authentication for existing server-to-server clients', async () => {
    app = createApp(
      adapterFor(async () => successfulResult),
      { apiKey: 'legacy-server-key' },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      headers: { authorization: 'Bearer legacy-server-key' },
      payload: { target: 'https://example.com/article' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('verifies a Supabase bearer token before routing and stores its user as task owner', async () => {
    const ownerId = '6bffb79d-9f1d-41aa-91b9-75edb31ae70f';
    const repository = new InMemoryTaskRepository();
    const authVerifier = vi.fn(async (token: string) =>
      token === 'valid-session' ? { id: ownerId } : null,
    );
    app = createApp(
      adapterFor(async () => successfulResult),
      {
        authVerifier,
        taskRepository: repository,
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      headers: { authorization: 'Bearer valid-session' },
      payload: {
        request: 'Compare two sources.',
        sources: ['https://example.com/one'],
        ownerId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(authVerifier).toHaveBeenCalledWith('valid-session');
    expect(response.json().error.code).toBe('INVALID_REQUEST');
  });

  it('records the owner ID returned by Supabase Auth', async () => {
    const ownerId = '6bffb79d-9f1d-41aa-91b9-75edb31ae70f';
    const repository = new InMemoryTaskRepository();
    app = createApp(
      adapterFor(async (target) => ({ ...successfulResult, url: target })),
      {
        authVerifier: async () => ({ id: ownerId }),
        taskRepository: repository,
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      headers: { authorization: 'Bearer verified-session' },
      payload: {
        request: 'Compare two sources.',
        sources: ['https://example.com/one'],
      },
    });
    const taskId = response.json().taskId as string;

    expect(response.statusCode).toBe(200);
    expect(repository.getTaskOwner(taskId)).toBe(ownerId);
  });

  it('lists only the signed-in user’s tasks and paginates within that owner scope', async () => {
    const aliceId = '6bffb79d-9f1d-41aa-91b9-75edb31ae70f';
    const bobId = '97e5049e-76b3-4b44-8e47-4cb5e62054e0';
    const repository = new InMemoryTaskRepository();
    const authVerifier = async (token: string) => {
      if (token === 'alice-session') return { id: aliceId };
      if (token === 'bob-session') return { id: bobId };
      return null;
    };
    app = createApp(
      adapterFor(async (target) => ({ ...successfulResult, url: target })),
      {
        authVerifier,
        taskRepository: repository,
      },
    );
    const createTask = async (token: string, request: string): Promise<string> => {
      const response = await app!.inject({
        method: 'POST',
        url: '/v1/research-tasks',
        headers: { authorization: `Bearer ${token}` },
        payload: { request, sources: ['https://example.com/article'] },
      });
      expect(response.statusCode).toBe(200);
      return response.json().taskId as string;
    };

    const aliceTaskOne = await createTask('alice-session', 'Alice task one');
    const bobTask = await createTask('bob-session', 'Bob private task');
    const aliceTaskTwo = await createTask('alice-session', 'Alice task two');
    const firstPage = await app.inject({
      method: 'GET',
      url: '/v1/research-tasks?limit=1&offset=0',
      headers: { authorization: 'Bearer alice-session' },
    });
    const secondPage = await app.inject({
      method: 'GET',
      url: '/v1/research-tasks?limit=1&offset=1',
      headers: { authorization: 'Bearer alice-session' },
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().data.items).toHaveLength(1);
    expect(firstPage.json().data.hasMore).toBe(true);
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().data.items).toHaveLength(1);
    expect(secondPage.json().data.hasMore).toBe(false);
    expect(
      new Set([firstPage.json().data.items[0].id, secondPage.json().data.items[0].id]),
    ).toEqual(new Set([aliceTaskOne, aliceTaskTwo]));
    expect(JSON.stringify([firstPage.json().data, secondPage.json().data])).not.toContain(bobTask);
    expect(firstPage.json().data.items[0]).not.toHaveProperty('result');
  });

  it('returns task details to their owner but returns the same 404 for another user', async () => {
    const aliceId = '6bffb79d-9f1d-41aa-91b9-75edb31ae70f';
    const bobId = '97e5049e-76b3-4b44-8e47-4cb5e62054e0';
    const repository = new InMemoryTaskRepository();
    app = createApp(
      adapterFor(async (target) => ({ ...successfulResult, url: target })),
      {
        authVerifier: async (token) =>
          token === 'alice-session'
            ? { id: aliceId }
            : token === 'bob-session'
              ? { id: bobId }
              : null,
        taskRepository: repository,
      },
    );
    const created = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      headers: { authorization: 'Bearer alice-session' },
      payload: { request: 'Alice research record', sources: ['https://example.com/article'] },
    });
    const taskId = created.json().taskId as string;

    const ownerResponse = await app.inject({
      method: 'GET',
      url: `/v1/research-tasks/${taskId}`,
      headers: { authorization: 'Bearer alice-session' },
    });
    const otherUserResponse = await app.inject({
      method: 'GET',
      url: `/v1/research-tasks/${taskId}`,
      headers: { authorization: 'Bearer bob-session' },
    });

    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json().data.id).toBe(taskId);
    expect(ownerResponse.json().data.result.sources).toHaveLength(1);
    expect(ownerResponse.json().data.result.evidence).toHaveLength(1);
    expect(otherUserResponse.statusCode).toBe(404);
    expect(otherUserResponse.json().error.code).toBe('TASK_NOT_FOUND');
  });

  it('deletes only the owner’s task and removes its dependent source and evidence records', async () => {
    const aliceId = '6bffb79d-9f1d-41aa-91b9-75edb31ae70f';
    const bobId = '97e5049e-76b3-4b44-8e47-4cb5e62054e0';
    const repository = new InMemoryTaskRepository();
    app = createApp(
      adapterFor(async (target) => ({ ...successfulResult, url: target })),
      {
        authVerifier: async (token) =>
          token === 'alice-session'
            ? { id: aliceId }
            : token === 'bob-session'
              ? { id: bobId }
              : null,
        taskRepository: repository,
      },
    );
    const createTask = async (token: string): Promise<string> => {
      const response = await app!.inject({
        method: 'POST',
        url: '/v1/research-tasks',
        headers: { authorization: `Bearer ${token}` },
        payload: { request: 'Delete test research', sources: ['https://example.com/article'] },
      });
      expect(response.statusCode).toBe(200);
      return response.json().taskId as string;
    };
    const aliceTask = await createTask('alice-session');
    const bobTask = await createTask('bob-session');

    const deniedDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/research-tasks/${aliceTask}`,
      headers: { authorization: 'Bearer bob-session' },
    });
    const ownerDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/research-tasks/${aliceTask}`,
      headers: { authorization: 'Bearer alice-session' },
    });
    const bobTaskDetail = await app.inject({
      method: 'GET',
      url: `/v1/research-tasks/${bobTask}`,
      headers: { authorization: 'Bearer bob-session' },
    });

    expect(deniedDelete.statusCode).toBe(404);
    expect(ownerDelete.statusCode).toBe(204);
    expect(repository.getTaskStatus(aliceTask)).toBeUndefined();
    expect(repository.getSources(aliceTask)).toEqual([]);
    expect(repository.getEvidence(aliceTask)).toEqual([]);
    expect(bobTaskDetail.statusCode).toBe(200);
  });

  it('requires a Supabase user identity rather than a legacy API key for history', async () => {
    const repository = new InMemoryTaskRepository();
    app = createApp(
      adapterFor(async () => successfulResult),
      {
        apiKey: 'legacy-server-key',
        taskRepository: repository,
      },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/v1/research-tasks',
      headers: { authorization: 'Bearer legacy-server-key' },
    });
    const anonymousResponse = await app.inject({
      method: 'GET',
      url: '/v1/research-tasks',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('USER_AUTH_REQUIRED');
    expect(anonymousResponse.statusCode).toBe(401);
    expect(anonymousResponse.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects history pagination outside the documented bounds', async () => {
    app = createApp(
      adapterFor(async () => successfulResult),
      {
        authVerifier: async () => ({ id: '6bffb79d-9f1d-41aa-91b9-75edb31ae70f' }),
        taskRepository: new InMemoryTaskRepository(),
      },
    );

    const response = await app.inject({
      method: 'GET',
      url: '/v1/research-tasks?limit=51&offset=0',
      headers: { authorization: 'Bearer valid-session' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_REQUEST');
  });

  it('rejects over-capacity requests before starting a browser read', async () => {
    const readPage = vi.fn(async () => successfulResult);
    const acquireRequest = vi.fn(async () => 'concurrency_limited' as const);
    const releaseRequest = vi.fn(async () => undefined);
    app = createApp(adapterFor(readPage), {
      authVerifier: async () => ({ id: '6bffb79d-9f1d-41aa-91b9-75edb31ae70f' }),
      requestAdmission: { acquireRequest, releaseRequest },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/page-reads',
      headers: { authorization: 'Bearer test-session' },
      payload: { target: 'https://example.com/article' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.json().error.code).toBe('CONCURRENCY_LIMITED');
    expect(readPage).not.toHaveBeenCalled();
    expect(releaseRequest).not.toHaveBeenCalled();
  });

  it('allows only an explicitly configured HTTPS frontend origin through CORS', async () => {
    const frontendOrigin = 'https://serena-frontend.vercel.app';
    app = createApp(
      adapterFor(async () => successfulResult),
      {
        corsOrigins: [frontendOrigin],
      },
    );

    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/v1/research-tasks',
      headers: {
        origin: frontendOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    const unlisted = await app.inject({
      method: 'OPTIONS',
      url: '/v1/research-tasks',
      headers: {
        origin: 'https://unlisted.example',
        'access-control-request-method': 'POST',
      },
    });
    const deletePreflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/research-tasks/example-task',
      headers: {
        origin: frontendOrigin,
        'access-control-request-method': 'DELETE',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(allowed.headers['access-control-allow-origin']).toBe(frontendOrigin);
    expect(unlisted.headers['access-control-allow-origin']).toBeUndefined();
    expect(deletePreflight.headers['access-control-allow-methods']).toContain('DELETE');
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

  it('runs a controlled multi-source research task and records evidence', async () => {
    const repository = new InMemoryTaskRepository();
    const readPage = async (target: string) => ({
      ...successfulResult,
      url: target,
      finalUrl: target,
      text: `Evidence from ${target}`,
    });
    app = createApp(adapterFor(readPage), { taskRepository: repository });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      payload: {
        request: 'Compare two sources.',
        sources: ['https://example.com/one', 'https://example.com/two'],
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.taskId).toMatch(/^task_/);
    expect(body.data.sources).toHaveLength(2);
    expect(body.data.evidence).toHaveLength(2);
    expect(body.data.findings).toEqual([]);
    expect(repository.getTaskStatus(body.taskId)).toBe('completed');
    expect(repository.getSources(body.taskId)).toHaveLength(2);
    expect(repository.getEvidence(body.taskId)).toHaveLength(2);
  });

  it('returns an evidence-linked finding for an exact cross-source sentence match', async () => {
    const repository = new InMemoryTaskRepository();
    const sharedSentence = 'This identical statement appears in both sources.';
    let index = 0;
    const readPage = async (target: string) => ({
      ...successfulResult,
      url: target,
      finalUrl: target,
      text: `${sharedSentence} Unique source detail ${++index}.`,
    });
    app = createApp(adapterFor(readPage), { taskRepository: repository });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      payload: {
        request: 'Find exact agreement.',
        sources: ['https://example.com/one', 'https://example.com/two'],
      },
    });

    const finding = response.json().data.findings[0];
    expect(response.statusCode).toBe(200);
    expect(finding).toMatchObject({
      claim: sharedSentence,
      status: 'exact_match',
      verificationMethod: 'exact-text-match',
    });
    expect(finding.evidenceIds).toHaveLength(2);
  });

  it('does not treat duplicate page content as independent corroboration', async () => {
    const repository = new InMemoryTaskRepository();
    app = createApp(
      adapterFor(async (target) => ({
        ...successfulResult,
        url: target,
        finalUrl: target,
        text: 'This exact sentence is copied across the same content.',
      })),
      { taskRepository: repository },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      payload: {
        request: 'Check whether duplicates count independently.',
        sources: ['https://example.com/one', 'https://mirror.example.com/two'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.sources[1].quality.duplicateOfSourceId).toBe(
      response.json().data.sources[0].id,
    );
    expect(response.json().data.findings).toEqual([]);
  });

  it('uses an injected evidence-grounded claim extractor', async () => {
    const repository = new InMemoryTaskRepository();
    const claimExtractor: ClaimExtractor = {
      extract: async ({ evidence }) => [
        {
          claim: 'The sources contain a cautious extracted claim.',
          status: 'proposed',
          verificationMethod: 'llm-evidence-grounded',
          uncertainty: 'The model proposed this claim; human review is still appropriate.',
          evidenceIds: [evidence[0]!.id],
        },
      ],
    };
    app = createApp(
      adapterFor(async () => successfulResult),
      {
        taskRepository: repository,
        claimExtractor,
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      payload: {
        request: 'Extract a cautious claim.',
        sources: ['https://example.com/article'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.findings[0]).toMatchObject({
      status: 'proposed',
      verificationMethod: 'llm-evidence-grounded',
    });
  });

  it('falls back to deterministic findings when the claim extractor fails', async () => {
    const repository = new InMemoryTaskRepository();
    const claimExtractor: ClaimExtractor = {
      extract: async () => {
        throw new Error('model unavailable');
      },
    };
    app = createApp(
      adapterFor(async (target) => ({
        ...successfulResult,
        url: target,
        finalUrl: target,
        text: `This exact shared statement is long enough for matching. Unique detail from ${target}.`,
      })),
      {
        taskRepository: repository,
        claimExtractor,
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      payload: {
        request: 'Fallback safely.',
        sources: ['https://example.com/one', 'https://example.com/two'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.findings[0].verificationMethod).toBe('exact-text-match');
  });

  it('rejects research requests that exceed the source budget', async () => {
    const repository = new InMemoryTaskRepository();
    app = createApp(
      adapterFor(async () => successfulResult),
      { taskRepository: repository },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      payload: {
        request: 'Read too many sources.',
        sources: [
          'https://example.com/1',
          'https://example.com/2',
          'https://example.com/3',
          'https://example.com/4',
          'https://example.com/5',
          'https://example.com/6',
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_REQUEST');
  });

  it('discovers bounded candidates and reads only them through the browser adapter', async () => {
    const repository = new InMemoryTaskRepository();
    const readPage = vi.fn(async (target: string) => ({
      ...successfulResult,
      url: target,
      finalUrl: target,
      text: `Readable content from ${target}`,
    }));
    const searchProvider: SearchProvider = {
      name: 'firecrawl',
      search: vi.fn(async () => ({
        provider: 'firecrawl',
        candidates: Array.from({ length: 8 }, (_, index) => ({
          url: `https://example.com/page-${index + 1}`,
          title: `Result ${index + 1}`,
          rank: index + 1,
        })),
      })),
    };
    app = createApp(adapterFor(readPage), { taskRepository: repository, searchProvider });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      payload: {
        request: 'Find scholarships for Nigerian undergraduates.',
        sourceMode: 'discover',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(searchProvider.search).toHaveBeenCalledWith(
      'Find scholarships for Nigerian undergraduates.',
      { maxResults: 10 },
    );
    expect(readPage).toHaveBeenCalledTimes(5);
    expect(response.json().data.discovery).toEqual({
      provider: 'firecrawl',
      candidateCount: 8,
      attemptedCount: 5,
    });
    expect(response.json().data.sources).toHaveLength(5);
  });

  it('keeps manual research available when automatic search is not configured', async () => {
    const repository = new InMemoryTaskRepository();
    app = createApp(
      adapterFor(async () => successfulResult),
      { taskRepository: repository },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      payload: { request: 'Find scholarships.', sourceMode: 'discover' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SEARCH_UNAVAILABLE');
  });

  it('logs redacted provider diagnostics and returns a safe temporary-unavailable response', async () => {
    const repository = new InMemoryTaskRepository();
    const logLines: string[] = [];
    const searchProvider: SearchProvider = {
      name: 'fallback',
      search: async () => {
        throw new SearchProvidersUnavailableError([
          { provider: 'firecrawl', kind: 'upstream_http_error', statusCode: 403 },
        ]);
      },
    };
    app = createApp(
      adapterFor(async () => successfulResult),
      { taskRepository: repository, searchProvider },
      Fastify({ logger: { stream: { write: (line: string) => logLines.push(line) } } }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/research-tasks',
      payload: { request: 'Search for current information.', sourceMode: 'discover' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SEARCH_UNAVAILABLE');
    expect(response.body).not.toContain('upstream');
    await new Promise<void>((resolve) => setImmediate(resolve));
    const warning = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.msg === 'All configured search providers failed');
    expect(warning).toMatchObject({
      providerFailures: [{ provider: 'firecrawl', kind: 'upstream_http_error', statusCode: 403 }],
    });
    expect(JSON.stringify(warning)).not.toContain('Search for current information.');
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
