import { describe, expect, it, vi } from 'vitest';

import type { BrowserAdapter } from '../src/browser/browser-adapter.js';
import { BrowserReadError, type BrowserReadResult } from '../src/core/result.js';
import { InMemoryTaskRepository } from '../src/persistence/in-memory-task-repository.js';
import type { ClaimExtractor } from '../src/research/claim-extractor.js';
import { ResearchService } from '../src/research/research-service.js';
import type { SearchProvider } from '../src/search/search-provider.js';

const challengeText =
  'Performing security verification. This website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot. Ray ID: a49f47792f3de006. Performance and Security by Cloudflare Privacy.';

function page(url: string, text: string): BrowserReadResult {
  return {
    url,
    finalUrl: url,
    title: text === challengeText ? 'Performing security verification' : 'Scholarships',
    text,
    retrievedAt: '2026-10-13T00:00:00.000Z',
    durationMs: 25,
  };
}

function adapterFor(readPage: BrowserAdapter['readPage']): BrowserAdapter {
  return { readPage };
}

describe('research service security-challenge handling', () => {
  it('does not create evidence or findings from pages that require security verification', async () => {
    const repository = new InMemoryTaskRepository();
    const claimExtractor: ClaimExtractor = {
      extract: vi.fn(async () => []),
    };
    const service = new ResearchService(
      adapterFor(async (url) => page(url, challengeText)),
      repository,
      claimExtractor,
    );

    const { taskId, result } = await service.run({
      request: 'Find scholarships for Nigerian undergraduates.',
      sources: ['https://scholarshipair.com/scholarships', 'https://scholarsworld.ng/scholarships'],
    });

    expect(result.coverage).toEqual({
      status: 'incomplete',
      securityChallengeSourceCount: 2,
      unreadableSourceCount: 0,
    });
    expect(result.sources).toHaveLength(2);
    expect(
      result.sources.every((source) => source.quality.accessStatus === 'security-challenge'),
    ).toBe(true);
    expect(result.evidence).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(repository.getEvidence(taskId)).toEqual([]);
    expect(claimExtractor.extract).not.toHaveBeenCalled();
  });

  it('marks partial coverage and excludes challenge text when only some sources are blocked', async () => {
    const repository = new InMemoryTaskRepository();
    const claimExtractor: ClaimExtractor = {
      extract: vi.fn(async () => []),
    };
    const service = new ResearchService(
      adapterFor(async (url) =>
        page(
          url,
          url.includes('blocked')
            ? challengeText
            : 'An accessible scholarship page contains this source text.',
        ),
      ),
      repository,
      claimExtractor,
    );

    const { taskId, result } = await service.run({
      request: 'Find scholarships for Nigerian undergraduates.',
      sources: ['https://example.com/accessible', 'https://example.com/blocked'],
    });

    expect(result.coverage).toEqual({
      status: 'incomplete',
      securityChallengeSourceCount: 1,
      unreadableSourceCount: 0,
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.excerpt).not.toContain('Performing security verification');
    expect(repository.getEvidence(taskId)).toHaveLength(1);
    expect(claimExtractor.extract).not.toHaveBeenCalled();
  });
});

describe('research service discovery', () => {
  it('skips a navigation refusal and tries the next discovered page without bypassing it', async () => {
    const attempted: string[] = [];
    const service = new ResearchService(
      adapterFor(async (url) => {
        attempted.push(url);
        if (url.endsWith('/blocked')) {
          throw new BrowserReadError('NAVIGATION_FAILED', '403', url);
        }
        return page(url, 'A readable scholarship page.');
      }),
      new InMemoryTaskRepository(),
      undefined,
      {
        name: 'mock',
        search: async () => ({
          provider: 'mock',
          candidates: [
            { url: 'https://example.com/blocked', title: 'Blocked', rank: 1 },
            { url: 'https://example.org/open', title: 'Open', rank: 2 },
          ],
        }),
      },
    );

    const { result } = await service.run({ request: 'Find scholarships.', sourceMode: 'discover' });

    expect(attempted).toEqual(['https://example.com/blocked', 'https://example.org/open']);
    expect(result.coverage).toEqual({
      status: 'incomplete',
      securityChallengeSourceCount: 0,
      unreadableSourceCount: 1,
    });
    expect(result.sources).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
  });

  it('marks an empty candidate list as incomplete instead of a negative finding', async () => {
    const service = new ResearchService(
      adapterFor(async () => page('https://example.com', 'unused')),
      new InMemoryTaskRepository(),
      undefined,
      { name: 'firecrawl', search: async () => ({ provider: 'firecrawl', candidates: [] }) },
    );

    const { result } = await service.run({
      request: 'Find scholarships.',
      sourceMode: 'discover',
    });

    expect(result.coverage.status).toBe('incomplete');
    expect(result.sources).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.discovery).toEqual({
      provider: 'firecrawl',
      candidateCount: 0,
      attemptedCount: 0,
    });
  });

  it('skips security-check pages and continues through the bounded candidate list', async () => {
    const repository = new InMemoryTaskRepository();
    const attempted: string[] = [];
    const searchProvider: SearchProvider = {
      name: 'firecrawl',
      search: async () => ({
        provider: 'firecrawl',
        candidates: [
          { url: 'https://example.com/blocked', title: 'Challenge', rank: 1 },
          { url: 'https://example.org/readable', title: 'Scholarship listing', rank: 2 },
        ],
      }),
    };
    const service = new ResearchService(
      adapterFor(async (url) => {
        attempted.push(url);
        return page(
          url,
          url.endsWith('/blocked')
            ? challengeText
            : 'Accessible scholarship information appears on this page.',
        );
      }),
      repository,
      undefined,
      searchProvider,
    );

    const { result } = await service.run({
      request: 'Find scholarships for Nigerian undergraduates.',
      sourceMode: 'discover',
    });

    expect(attempted).toEqual(['https://example.com/blocked', 'https://example.org/readable']);
    expect(result.discovery).toEqual({
      provider: 'firecrawl',
      candidateCount: 2,
      attemptedCount: 2,
    });
    expect(result.coverage.status).toBe('incomplete');
    expect(result.sources).toHaveLength(2);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.excerpt).toContain('Accessible scholarship information');
  });
});
