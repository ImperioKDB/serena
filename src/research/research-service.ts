import type { BrowserAdapter, BrowserReadOptions } from '../browser/browser-adapter.js';
import type { TaskRepository } from '../persistence/task-repository.js';
import type { ClaimExtractor } from './claim-extractor.js';
import { extractCrossSourceFindings } from './finding-extractor.js';
import { assessSourceQuality } from './source-quality.js';
import type { ResearchResult } from './types.js';

const MAX_EVIDENCE_CHARS = 500;
const MAX_RESEARCH_DURATION_MS = 65_000;
const DEFAULT_SOURCE_TIMEOUT_MS = 10_000;
const MAX_CLAIM_EXTRACTION_DURATION_MS = 15_000;

export interface ResearchServiceInput {
  request: string;
  sources: string[];
  timeoutMs?: number;
  allowedDomains?: string[];
}

export class ResearchService {
  public constructor(
    private readonly adapter: BrowserAdapter,
    private readonly repository: TaskRepository,
    private readonly claimExtractor?: ClaimExtractor,
  ) {}

  public async run(
    input: ResearchServiceInput,
  ): Promise<{ taskId: string; result: ResearchResult }> {
    const task = await this.repository.createTask({
      requestText: input.request,
      input: {
        request: input.request,
        sources: input.sources,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
      },
    });
    await this.repository.appendEvent(task.id, 'task_started', {
      sourceCount: input.sources.length,
    });
    const taskStartedAt = performance.now();

    const sourceResults: ResearchResult['sources'] = [];
    const evidence: ResearchResult['evidence'] = [];
    const sourceSnapshots: Array<{ id: string; hash: string }> = [];
    const readOptions: BrowserReadOptions = {
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
    };

    try {
      for (const sourceUrl of input.sources) {
        const remainingMs = Math.floor(
          MAX_RESEARCH_DURATION_MS - (performance.now() - taskStartedAt),
        );
        if (remainingMs < 100) {
          throw new Error('Research task exceeded its total time budget.');
        }
        const pageTimeoutMs = Math.min(input.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS, remainingMs);
        const page = await this.adapter.readPage(sourceUrl, {
          ...readOptions,
          timeoutMs: pageTimeoutMs,
        });
        const source = await this.repository.recordSource(task.id, page);
        const quality = assessSourceQuality(page, source.id, sourceSnapshots);
        sourceSnapshots.push({ id: source.id, hash: quality.contentHash });
        const evidenceRecord = await this.repository.recordEvidence(task.id, source.id, {
          excerpt: page.text.slice(0, MAX_EVIDENCE_CHARS),
          locator: 'body visible-text prefix',
          extractionMethod: 'visible-text-prefix',
          verificationStatus: 'unverified',
        });

        sourceResults.push({
          id: source.id,
          url: page.url,
          finalUrl: page.finalUrl,
          title: page.title,
          retrievedAt: page.retrievedAt,
          quality,
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
      if (this.claimExtractor) {
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
      }

      const result: ResearchResult = {
        request: input.request,
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
