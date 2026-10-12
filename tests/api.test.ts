import { afterEach, describe, expect, it } from 'vitest';

import type { BrowserAdapter } from '../src/browser/browser-adapter.js';
import { createApp } from '../src/api/app.js';
import { BrowserReadError, type BrowserReadResult } from '../src/core/result.js';
import { InMemoryTaskRepository } from '../src/persistence/in-memory-task-repository.js';
import type { ClaimExtractor } from '../src/research/claim-extractor.js';

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
      status: 'supported',
      verificationMethod: 'exact-text-match',
    });
    expect(finding.evidenceIds).toHaveLength(2);
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
        text: 'This exact shared statement is long enough for matching.',
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
