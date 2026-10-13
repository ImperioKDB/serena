import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserAdapter } from '../src/browser/browser-adapter.js';
import { createApp } from '../src/api/app.js';
import { BrowserReadError, type BrowserReadResult } from '../src/core/result.js';
import { InMemoryTaskRepository } from '../src/persistence/in-memory-task-repository.js';
import type { ClaimExtractor } from '../src/research/claim-extractor.js';
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

    expect(allowed.headers['access-control-allow-origin']).toBe(frontendOrigin);
    expect(unlisted.headers['access-control-allow-origin']).toBeUndefined();
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
      search: vi.fn(async () =>
        Array.from({ length: 8 }, (_, index) => ({
          url: `https://example.com/page-${index + 1}`,
          title: `Result ${index + 1}`,
          rank: index + 1,
        })),
      ),
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
      provider: 'tavily',
      candidateCount: 8,
      attemptedCount: 5,
    });
    expect(response.json().data.sources).toHaveLength(5);
  });

  it('keeps automatic discovery unavailable when the server has no provider key', async () => {
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
