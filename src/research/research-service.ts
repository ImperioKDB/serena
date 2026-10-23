import type { BrowserAdapter, BrowserReadOptions } from '../browser/browser-adapter.js';
import { BrowserReadError, type ResponseSizeLimitScope } from '../core/result.js';
import type { TaskRepository } from '../persistence/task-repository.js';
import type { ClaimExtractor } from './claim-extractor.js';
import { extractCrossSourceFindings } from './finding-extractor.js';
import { assessSourceQuality } from './source-quality.js';
import type { ResearchResult } from './types.js';
import type { SearchProvider } from '../search/search-provider.js';

const MAX_EVIDENCE_CHARS = 500;
const MAX_RESEARCH_DURATION_MS = 65_000;
const DEFAULT_SOURCE_TIMEOUT_MS = 10_000;
const MAX_CLAIM_EXTRACTION_DURATION_MS = 15_000;

export interface ResearchServiceInput {
  ownerId?: string;
  request: string;
  sources?: string[];
  sourceMode?: 'provided' | 'discover';
  timeoutMs?: number;
  allowedDomains?: string[];
}

export interface SourceReadFailureDiagnostic {
  code: BrowserReadError['code'];
  responseSizeLimitScope?: ResponseSizeLimitScope;
}

export class ResearchService {
  public constructor(
    private readonly adapter: BrowserAdapter,
    private readonly repository: TaskRepository,
    private readonly claimExtractor?: ClaimExtractor,
    private readonly searchProvider?: SearchProvider,
    private readonly onSourceReadFailure?: (diagnostic: SourceReadFailureDiagnostic) => void,
  ) {}

  public async run(
    input: ResearchServiceInput,
  ): Promise<{ taskId: string; result: ResearchResult }> {
    const task = await this.repository.createTask({
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
      requestText: input.request,
      input: {
        request: input.request,
        sourceMode: input.sourceMode ?? 'provided',
        sources: input.sources ?? [],
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
      },
    });
    await this.repository.appendEvent(task.id, 'task_started', {
      sourceMode: input.sourceMode ?? 'provided',
      sourceCount: input.sources?.length ?? 0,
    });
    const taskStartedAt = performance.now();

    const sourceResults: ResearchResult['sources'] = [];
    const evidence: ResearchResult['evidence'] = [];
    const sourceSnapshots: Array<{ id: string; hash: string }> = [];
    let securityChallengeSourceCount = 0;
    let unreadableSourceCount = 0;
    const readOptions: BrowserReadOptions = {
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
    };

    try {
      let sourceUrls = input.sources ?? [];
      let discovery: ResearchResult['discovery'] | undefined;
      if ((input.sourceMode ?? 'provided') === 'discover') {
        if (!this.searchProvider) throw new Error('Automatic search is not configured.');
        const searchResult = await this.searchProvider.search(input.request, { maxResults: 10 });
        const candidates = searchResult.candidates;
        sourceUrls = candidates.slice(0, 5).map((candidate) => candidate.url);
        discovery = {
          provider: searchResult.provider,
          candidateCount: candidates.length,
          attemptedCount: 0,
        };
        await this.repository.appendEvent(task.id, 'search_completed', {
          provider: searchResult.provider,
          candidateCount: candidates.length,
          candidates: candidates.slice(0, 10).map(({ url, title, rank }) => ({ url, title, rank })),
        });
      }

      for (const sourceUrl of sourceUrls) {
        const remainingMs = Math.floor(
          MAX_RESEARCH_DURATION_MS - (performance.now() - taskStartedAt),
        );
        if (remainingMs < 100) {
          throw new Error('Research task exceeded its total time budget.');
        }
        const pageTimeoutMs = Math.min(input.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS, remainingMs);
        if (discovery) discovery.attemptedCount += 1;
        let page;
        try {
          page = await this.adapter.readPage(sourceUrl, {
            ...readOptions,
            timeoutMs: pageTimeoutMs,
          });
        } catch (error) {
          if (
            discovery &&
            error instanceof BrowserReadError &&
            (error.code === 'NAVIGATION_FAILED' ||
              error.code === 'NAVIGATION_TIMEOUT' ||
              error.code === 'RESPONSE_TOO_LARGE')
          ) {
            unreadableSourceCount += 1;
            try {
              this.onSourceReadFailure?.({
                code: error.code,
                ...(error.responseSizeLimitScope === undefined
                  ? {}
                  : { responseSizeLimitScope: error.responseSizeLimitScope }),
              });
            } catch {
              // Diagnostics must not interrupt an otherwise recoverable research run.
            }
            await this.repository.appendEvent(task.id, 'source_unreadable', {
              url: sourceUrl,
              reason: error.code,
            });
            continue;
          }
          throw error;
        }
        const source = await this.repository.recordSource(task.id, page);
        const quality = assessSourceQuality(page, source.id, sourceSnapshots);
        sourceResults.push({
          id: source.id,
          url: page.url,
          finalUrl: page.finalUrl,
          title: page.title,
          retrievedAt: page.retrievedAt,
          quality,
        });

        if (quality.accessStatus === 'security-challenge') {
          securityChallengeSourceCount += 1;
          await this.repository.appendEvent(task.id, 'source_blocked', {
            sourceId: source.id,
            url: page.finalUrl,
            reason: 'security_challenge',
          });
          continue;
        }

        sourceSnapshots.push({ id: source.id, hash: quality.contentHash });
        const evidenceRecord = await this.repository.recordEvidence(task.id, source.id, {
          excerpt: page.text.slice(0, MAX_EVIDENCE_CHARS),
          locator: 'body visible-text prefix',
          extractionMethod: 'visible-text-prefix',
          verificationStatus: 'unverified',
        });

        evidence.push({
          id: evidenceRecord.id,
          sourceId: source.id,
          excerpt: page.text.slice(0, MAX_EVIDENCE_CHARS),
          locator: evidenceRecord.locator,
          verificationStatus: evidenceRecord.verificationStatus,
        });
        await this.repository.appendEvent(task.id, 'source_completed', {
          sourceId: source.id,
          url: page.finalUrl,
        });
      }

      const evidenceRecords = evidence.map((item) => ({
        id: item.id,
        taskId: task.id,
        sourceId: item.sourceId,
        excerpt: item.excerpt,
        locator: item.locator,
        extractionMethod: 'visible-text-prefix' as const,
        verificationStatus: item.verificationStatus,
      }));
      const duplicateSourceIds = new Set(
        sourceResults
          .filter((source) => source.quality.duplicateOfSourceId !== undefined)
          .map((source) => source.id),
      );
      let findings = extractCrossSourceFindings(evidenceRecords, duplicateSourceIds);
      if (
        this.claimExtractor &&
        securityChallengeSourceCount === 0 &&
        unreadableSourceCount === 0 &&
        evidenceRecords.length > 0
      ) {
        try {
          const remainingMs = Math.floor(
            MAX_RESEARCH_DURATION_MS - (performance.now() - taskStartedAt),
          );
          if (remainingMs < 1) throw new Error('Research task exceeded its total time budget.');
          const extractedFindings = await this.claimExtractor.extract({
            request: input.request,
            evidence: evidenceRecords,
            signal: AbortSignal.timeout(Math.min(MAX_CLAIM_EXTRACTION_DURATION_MS, remainingMs)),
          });
          findings = extractedFindings.map(({ reviewRequired, ...finding }) =>
            reviewRequired === undefined ? finding : { ...finding, reviewRequired },
          );
          const exactFindings = new Map(
            extractCrossSourceFindings(evidenceRecords, duplicateSourceIds).map((finding) => [
              finding.claim.toLocaleLowerCase(),
              finding,
            ]),
          );
          findings = findings.map((finding) => {
            const exact = exactFindings.get(finding.claim.toLocaleLowerCase());
            return exact === undefined
              ? { ...finding, status: 'proposed' as const, reviewRequired: true }
              : exact;
          });
          await this.repository.appendEvent(task.id, 'claims_extracted', {
            findingCount: findings.length,
            method: 'llm-evidence-grounded',
          });
        } catch (error) {
          await this.repository.appendEvent(task.id, 'claims_extraction_fallback', {
            method: 'exact-text-match',
            errorType: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          });
        }
      } else if (
        this.claimExtractor &&
        (securityChallengeSourceCount > 0 || unreadableSourceCount > 0)
      ) {
        await this.repository.appendEvent(task.id, 'claims_extraction_skipped', {
          reason: 'incomplete_source_coverage',
          securityChallengeSourceCount,
          unreadableSourceCount,
        });
      }

      const result: ResearchResult = {
        request: input.request,
        ...(discovery === undefined ? {} : { discovery }),
        coverage: {
          status:
            securityChallengeSourceCount === 0 &&
            unreadableSourceCount === 0 &&
            !(discovery !== undefined && discovery.candidateCount === 0)
              ? 'complete'
              : 'incomplete',
          securityChallengeSourceCount,
          unreadableSourceCount,
        },
        sources: sourceResults,
        evidence,
        findings,
      };
      await this.repository.markCompleted(task.id, result);
      await this.repository.appendEvent(task.id, 'task_completed', {
        sourceCount: sourceResults.length,
        evidenceCount: evidence.length,
      });
      return { taskId: task.id, result };
    } catch (error) {
      await this.repository.markFailed(
        task.id,
        error instanceof Error ? error.name : 'RESEARCH_FAILED',
      );
      await this.repository.appendEvent(task.id, 'task_failed', {
        errorType: error instanceof Error ? error.name : 'RESEARCH_FAILED',
      });
      throw error;
    }
  }
}
