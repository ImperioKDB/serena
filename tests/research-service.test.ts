import { describe, expect, it, vi } from 'vitest';

import type { BrowserAdapter } from '../src/browser/browser-adapter.js';
import { BrowserReadError, type BrowserReadResult } from '../src/core/result.js';
import { InMemoryTaskRepository } from '../src/persistence/in-memory-task-repository.js';
import type { AiClaimFinding, ClaimExtractor } from '../src/research/claim-extractor.js';
import { ModelProviderError } from '../src/research/model-provider.js';
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

function usefulArticleText(label: string): string {
  return `At ${label}, program managers publish a distinct award overview and applicant rules. Applicants considering ${label} should verify the deadline on the primary page and gather transcripts, references, and proof of enrollment before submitting anything. For ${label}, the selection panel weighs academic readiness, community service, and financial need; students can contact the office to ask about renewal and payment timelines.`;
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
      retrievedSourceCount: 2,
      evidenceSourceCount: 0,
      duplicateSourceCount: 0,
      lowQualitySourceCount: 0,
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
      extract: vi.fn(async (input: Parameters<ClaimExtractor['extract']>[0]) => {
        const findings: AiClaimFinding[] = [
          {
            claim: 'The accessible page describes a scholarship program.',
            status: 'supported',
            verificationMethod: 'llm-evidence-grounded',
            uncertainty: 'Only one readable source was available.',
            evidenceIds: [input.evidence[0]!.id],
            reviewRequired: false,
          },
          {
            claim: 'This unrelated claim cites evidence from another task.',
            status: 'supported',
            verificationMethod: 'llm-evidence-grounded',
            uncertainty: 'The cited evidence is not in this research task.',
            evidenceIds: ['evidence-from-another-task'],
          },
        ];
        return findings;
      }),
    };
    const service = new ResearchService(
      adapterFor(async (url) =>
        page(
          url,
          url.includes('blocked')
            ? challengeText
            : usefulArticleText('accessible scholarship page'),
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
      retrievedSourceCount: 2,
      evidenceSourceCount: 1,
      duplicateSourceCount: 0,
      lowQualitySourceCount: 0,
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.excerpt).not.toContain('Performing security verification');
    expect(repository.getEvidence(taskId)).toHaveLength(1);
    expect(claimExtractor.extract).toHaveBeenCalledOnce();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      claim: 'The accessible page describes a scholarship program.',
      status: 'proposed',
      verificationMethod: 'llm-evidence-grounded',
      reviewRequired: true,
      evidenceIds: [result.evidence[0]?.id],
    });
  });
});

describe('research service discovery', () => {
  it('excludes unsupported-browser error pages from evidence and marks coverage incomplete', async () => {
    const repository = new InMemoryTaskRepository();
    const claimExtractor: ClaimExtractor = { extract: vi.fn(async () => []) };
    const service = new ResearchService(
      adapterFor(async (url) => ({
        ...page('https://www.facebook.com/unsupportedbrowser', 'Your browser is not supported.'),
        url,
        title: 'Error',
      })),
      repository,
      claimExtractor,
      {
        name: 'mock',
        search: async () => ({
          provider: 'mock',
          candidates: [
            { url: 'https://www.facebook.com/scholarship-post', title: 'Scholarship', rank: 1 },
          ],
        }),
      },
    );

    const { taskId, result } = await service.run({
      request: 'Find scholarships for Nigerian undergraduates.',
      sourceMode: 'discover',
    });

    expect(result.coverage).toEqual({
      status: 'incomplete',
      securityChallengeSourceCount: 0,
      unreadableSourceCount: 1,
      retrievedSourceCount: 1,
      evidenceSourceCount: 0,
      duplicateSourceCount: 0,
      lowQualitySourceCount: 0,
    });
    expect(result.sources[0]?.quality.accessStatus).toBe('unavailable');
    expect(result.evidence).toEqual([]);
    expect(repository.getEvidence(taskId)).toEqual([]);
    expect(claimExtractor.extract).not.toHaveBeenCalled();
  });

  it('skips a navigation refusal and tries the next discovered page without bypassing it', async () => {
    const attempted: string[] = [];
    const service = new ResearchService(
      adapterFor(async (url) => {
        attempted.push(url);
        if (url.endsWith('/blocked')) {
          throw new BrowserReadError('NAVIGATION_FAILED', '403', url);
        }
        return page(url, usefulArticleText('readable scholarship page'));
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
      retrievedSourceCount: 1,
      evidenceSourceCount: 1,
      duplicateSourceCount: 0,
      lowQualitySourceCount: 0,
    });
    expect(result.sources).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
  });

  it('skips a source that exceeds the response-size budget and continues within the candidate cap', async () => {
    const repository = new InMemoryTaskRepository();
    const attempted: string[] = [];
    const claimExtractor: ClaimExtractor = { extract: vi.fn(async () => []) };
    const service = new ResearchService(
      adapterFor(async (url) => {
        attempted.push(url);
        if (url.endsWith('/oversized')) {
          throw new BrowserReadError(
            'RESPONSE_TOO_LARGE',
            'Page exceeded response-size limit.',
            url,
          );
        }
        return page(url, usefulArticleText('accessible public statistics page'));
      }),
      repository,
      claimExtractor,
      {
        name: 'mock',
        search: async () => ({
          provider: 'mock',
          candidates: [
            { url: 'https://example.com/oversized', title: 'Large page', rank: 1 },
            { url: 'https://example.org/readable', title: 'Readable page', rank: 2 },
          ],
        }),
      },
    );

    const { taskId, result } = await service.run({
      request: 'Compare football players using public statistics.',
      sourceMode: 'discover',
    });

    expect(attempted).toEqual(['https://example.com/oversized', 'https://example.org/readable']);
    expect(result.discovery).toMatchObject({
      provider: 'mock',
      candidateCount: 2,
      attemptedCount: 2,
      selectedCount: 2,
      retrievalAttemptCount: 2,
      successfulReadCount: 1,
      usefulContentCount: 1,
      retryCount: 0,
    });
    expect(result.coverage).toEqual({
      status: 'incomplete',
      securityChallengeSourceCount: 0,
      unreadableSourceCount: 1,
      retrievedSourceCount: 1,
      evidenceSourceCount: 1,
      duplicateSourceCount: 0,
      lowQualitySourceCount: 0,
    });
    expect(result.sources).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.excerpt).toContain('accessible public statistics');
    expect(repository.getEvidence(taskId)).toHaveLength(1);
    expect(claimExtractor.extract).toHaveBeenCalledOnce();
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
    expect(result.discovery).toMatchObject({
      provider: 'firecrawl',
      candidateCount: 0,
      attemptedCount: 0,
      selectedCount: 0,
      retrievalAttemptCount: 0,
      successfulReadCount: 0,
      usefulContentCount: 0,
      retryCount: 0,
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
            : usefulArticleText('accessible scholarship information'),
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
    expect(result.discovery).toMatchObject({
      provider: 'firecrawl',
      candidateCount: 2,
      attemptedCount: 2,
      selectedCount: 2,
      retrievalAttemptCount: 2,
      successfulReadCount: 2,
      usefulContentCount: 1,
      retryCount: 0,
    });
    expect(result.coverage.status).toBe('incomplete');
    expect(result.sources).toHaveLength(2);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.excerpt).toContain('accessible scholarship information');
  });
});

describe('research service model diagnostics', () => {
  it('persists a safe provider failure while retaining saved evidence', async () => {
    const repository = new InMemoryTaskRepository();
    const claimExtractor: ClaimExtractor = {
      provider: 'gemini',
      model: 'gemini-test-model',
      analyzeEvidence: vi.fn(async () => {
        throw new ModelProviderError('gemini', 'upstream_error', 503);
      }),
      extract: vi.fn(async () => []),
    };
    const service = new ResearchService(
      adapterFor(async (url) => page(url, usefulArticleText('public scholarship page'))),
      repository,
      claimExtractor,
    );

    const { result } = await service.run({
      request: 'Find public scholarship information.',
      sources: ['https://example.com/scholarship'],
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.modelAnalysis).toMatchObject({
      status: 'failed',
      failure: {
        provider: 'gemini',
        operation: 'evidence_analysis',
        kind: 'upstream_unavailable',
        statusCode: 503,
      },
    });
    expect(JSON.stringify(result)).not.toContain('Research model provider failed');
  });
});
