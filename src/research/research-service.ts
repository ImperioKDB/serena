import { createHash } from 'node:crypto';

import type { BrowserAdapter, BrowserReadOptions } from '../browser/browser-adapter.js';
import {
  segmentArticle,
  segmentPlainText,
  type ArticleExtractionMetadata,
  type EvidencePassage,
} from '../browser/article-extractor.js';
import { BrowserReadError, type ResponseSizeLimitScope } from '../core/result.js';
import type { TaskRepository } from '../persistence/task-repository.js';
import type { CreateEvidenceInput } from '../persistence/task-repository.js';
import type { ClaimExtractor, ModelEvidenceAnalysis } from './claim-extractor.js';
import { filterGroundedFindings } from './claim-extractor.js';
import { selectSearchCandidates, type CandidateSelection } from './candidate-ranker.js';
import { extractCrossSourceFindings } from './finding-extractor.js';
import { ModelProviderError, type ModelProviderOperation } from './model-provider.js';
import { assessSourceQuality, calculateRelevanceScore } from './source-quality.js';
import type {
  CandidateOutcome,
  ModelAnalysisFailure,
  ModelAnalysisFailureKind,
  ResearchResult,
  ResearchSourceRecord,
} from './types.js';
import type { SearchProvider, SearchCandidate } from '../search/search-provider.js';

const MAX_EVIDENCE_PASSAGES_PER_SOURCE = 6;
const MAX_TOTAL_EVIDENCE_PASSAGES = 30;
const MAX_RETRY_BACKOFF_MS = 250;
const MODEL_RESERVE_MS = 17_000;

export interface ResearchServiceLimits {
  maxDiscoveryCandidates: number;
  maxEvidenceSources: number;
  totalBudgetMs: number;
  defaultSourceTimeoutMs: number;
  maxSourceTimeoutMs: number;
  candidateEvaluationTimeoutMs: number;
  evidenceAnalysisTimeoutMs: number;
}

export const DEFAULT_RESEARCH_SERVICE_LIMITS: ResearchServiceLimits = {
  maxDiscoveryCandidates: 10,
  maxEvidenceSources: 5,
  totalBudgetMs: 90_000,
  defaultSourceTimeoutMs: 10_000,
  maxSourceTimeoutMs: 15_000,
  candidateEvaluationTimeoutMs: 4_000,
  evidenceAnalysisTimeoutMs: 15_000,
};

const LIMIT_BOUNDS: Record<keyof ResearchServiceLimits, { min: number; max: number }> = {
  maxDiscoveryCandidates: { min: 1, max: 10 },
  maxEvidenceSources: { min: 1, max: 5 },
  totalBudgetMs: { min: 20_000, max: 120_000 },
  defaultSourceTimeoutMs: { min: 1_000, max: 15_000 },
  maxSourceTimeoutMs: { min: 1_000, max: 15_000 },
  candidateEvaluationTimeoutMs: { min: 1_000, max: 5_000 },
  evidenceAnalysisTimeoutMs: { min: 1_000, max: 15_000 },
};

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

function normalizeLimits(input: Partial<ResearchServiceLimits>): ResearchServiceLimits {
  const result = { ...DEFAULT_RESEARCH_SERVICE_LIMITS, ...input };
  for (const key of Object.keys(LIMIT_BOUNDS) as Array<keyof ResearchServiceLimits>) {
    const value = result[key];
    const bounds = LIMIT_BOUNDS[key];
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
      throw new Error(`${key} must be an integer between ${bounds.min} and ${bounds.max}.`);
    }
  }
  if (result.defaultSourceTimeoutMs > result.maxSourceTimeoutMs) {
    throw new Error('defaultSourceTimeoutMs must not exceed maxSourceTimeoutMs.');
  }
  return result;
}

function remainingBudgetMs(startedAt: number, totalBudgetMs: number): number {
  return Math.max(0, Math.floor(totalBudgetMs - (performance.now() - startedAt)));
}

function boundedTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Research model operation exceeded its time budget.'));
    }, timeoutMs);
  });
  return Promise.race([operation(controller.signal), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  });
}

function candidateDomain(candidate: SearchCandidate): string {
  try {
    return new URL(candidate.url).hostname.toLocaleLowerCase().replace(/^www\./u, '');
  } catch {
    return 'unknown';
  }
}

function rejectionLabel(reason: CandidateSelection['rejected'][number]['reason']): string {
  switch (reason) {
    case 'invalid-url':
      return 'invalid-destination';
    case 'duplicate-url':
      return 'duplicate-candidate';
    case 'unsupported-browser-route':
      return 'unsupported-browser-error-route';
    case 'outside-selection-cap':
      return 'outside-selection-cap';
  }
}

function failureLabel(code: BrowserReadError['code']): string {
  switch (code) {
    case 'INVALID_TARGET':
      return 'blocked-by-safety-policy';
    case 'NAVIGATION_TIMEOUT':
      return 'navigation-timeout';
    case 'NAVIGATION_FAILED':
      return 'navigation-failed';
    case 'RESPONSE_TOO_LARGE':
      return 'response-size-limit';
    case 'REQUEST_BUDGET_EXCEEDED':
      return 'page-request-budget';
    case 'READ_FAILED':
      return 'page-read-failed';
  }
}

function passageFingerprint(value: string): string {
  return createHash('sha256')
    .update(value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase())
    .digest('hex');
}

function safeText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
}

function validateModelAnalysis(
  analysis: ModelEvidenceAnalysis,
  evidence: ResearchResult['evidence'],
  sources: ResearchResult['sources'],
): ModelEvidenceAnalysis {
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const sourceIds = new Set(sources.map((item) => item.id));
  const validFindings = filterGroundedFindings(
    analysis.findings,
    evidence.map((item) => ({
      id: item.id,
      taskId: '',
      sourceId: item.sourceId,
      excerpt: item.excerpt,
      locator: item.locator,
      extractionMethod: item.extractionMethod,
      verificationStatus: item.verificationStatus,
    })),
  ).map((finding) => ({ ...finding, status: 'proposed' as const, reviewRequired: true }));
  const uniqueBy = <T>(values: T[], keyOf: (value: T) => string): T[] => {
    const seen = new Set<string>();
    return values.filter((value) => {
      const key = keyOf(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return {
    provider: safeText(analysis.provider, 80) ?? 'configured-provider',
    model: safeText(analysis.model, 120) ?? 'configured-model',
    findings: validFindings,
    sourceAssessments: uniqueBy(
      analysis.sourceAssessments.filter(
        (item) =>
          sourceIds.has(item.sourceId) &&
          Number.isInteger(item.relevanceScore) &&
          item.relevanceScore >= 0 &&
          item.relevanceScore <= 100,
      ),
      (item) => item.sourceId,
    ),
    evidenceAssessments: uniqueBy(
      analysis.evidenceAssessments.filter(
        (item) =>
          evidenceIds.has(item.evidenceId) &&
          Number.isInteger(item.relevanceScore) &&
          item.relevanceScore >= 0 &&
          item.relevanceScore <= 100 &&
          ['supports', 'contradicts', 'context'].includes(item.relation),
      ),
      (item) => item.evidenceId,
    ),
    potentialContradictions: analysis.potentialContradictions
      .map((item) => ({
        summary: safeText(item.summary, 300),
        evidenceIds: [...new Set(item.evidenceIds.filter((id) => evidenceIds.has(id)))],
      }))
      .filter(
        (item): item is { summary: string; evidenceIds: string[] } =>
          Boolean(item.summary) && item.evidenceIds.length >= 2,
      ),
    missingEvidence: [
      ...new Set(analysis.missingEvidence.map((item) => safeText(item, 160)).filter(Boolean)),
    ] as string[],
    ...(analysis.usage === undefined
      ? {}
      : {
          usage: {
            ...(Number.isInteger(analysis.usage.inputTokens) && analysis.usage.inputTokens! >= 0
              ? { inputTokens: analysis.usage.inputTokens }
              : {}),
            ...(Number.isInteger(analysis.usage.outputTokens) && analysis.usage.outputTokens! >= 0
              ? { outputTokens: analysis.usage.outputTokens }
              : {}),
          },
        }),
  };
}

function toReadFailure(error: unknown): BrowserReadError {
  return error instanceof BrowserReadError
    ? error
    : new BrowserReadError('READ_FAILED', 'The browser could not complete the page read.');
}

function modelFailureDetails(
  error: unknown,
  operation: ModelProviderOperation,
  provider: string | undefined,
): ModelAnalysisFailure {
  const safeStatusCode = (statusCode: number | undefined): number | undefined =>
    statusCode !== undefined && statusCode >= 400 && statusCode <= 599 ? statusCode : undefined;
  const publicKind = (kind: string): ModelAnalysisFailureKind => {
    switch (kind) {
      case 'rate_limited':
      case 'timeout':
      case 'cancelled':
      case 'model_unavailable':
      case 'authentication_failed':
      case 'invalid_request':
      case 'invalid_response':
        return kind;
      default:
        return 'upstream_unavailable';
    }
  };
  if (error instanceof ModelProviderError) {
    const statusCode = safeStatusCode(error.statusCode);
    return {
      provider: error.provider,
      operation,
      kind: publicKind(error.kind),
      ...(statusCode === undefined ? {} : { statusCode }),
      ...(error.diagnostics.errorCode === undefined
        ? {}
        : { errorCode: error.diagnostics.errorCode }),
      ...(error.diagnostics.attemptCount === undefined
        ? {}
        : { attemptCount: error.diagnostics.attemptCount }),
      ...(error.diagnostics.retryCount === undefined
        ? {}
        : { retryCount: error.diagnostics.retryCount }),
      ...(error.diagnostics.durationMs === undefined
        ? {}
        : { durationMs: error.diagnostics.durationMs }),
    };
  }
  return {
    provider: provider ?? 'configured-provider',
    operation,
    kind: 'upstream_unavailable',
  };
}

function metadataForPage(page: ResearchSourceRecord['result']): ArticleExtractionMetadata {
  if (page.extraction) return page.extraction;
  const wordCount = page.text.split(/\s+/u).filter(Boolean).length;
  return {
    method: 'semantic-fallback',
    qualityScore: Math.min(100, Math.round(page.text.length / 50)),
    characterCount: page.text.length,
    wordCount,
    sectionCount: 0,
  };
}

export class ResearchService {
  private readonly limits: ResearchServiceLimits;

  public constructor(
    private readonly adapter: BrowserAdapter,
    private readonly repository: TaskRepository,
    private readonly claimExtractor?: ClaimExtractor,
    private readonly searchProvider?: SearchProvider,
    private readonly onSourceReadFailure?: (diagnostic: SourceReadFailureDiagnostic) => void,
    limits: Partial<ResearchServiceLimits> = {},
  ) {
    this.limits = normalizeLimits(limits);
  }

  public async run(
    input: ResearchServiceInput,
  ): Promise<{ taskId: string; result: ResearchResult }> {
    const sourceMode = input.sourceMode ?? 'provided';
    const task = await this.repository.createTask({
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
      requestText: input.request,
      input: {
        request: input.request,
        sourceMode,
        sources: input.sources ?? [],
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
      },
    });
    const taskStartedAt = performance.now();
    await this.repository.appendEvent(task.id, 'task_started', {
      sourceMode,
      sourceCount: input.sources?.length ?? 0,
      configuredCandidateCap: this.limits.maxDiscoveryCandidates,
      configuredEvidenceSourceCap: this.limits.maxEvidenceSources,
      totalBudgetMs: this.limits.totalBudgetMs,
    });

    const sourceResults: ResearchResult['sources'] = [];
    const evidence: ResearchResult['evidence'] = [];
    const sourceSnapshots: Array<{ id: string; hash: string; text: string }> = [];
    let securityChallengeSourceCount = 0;
    let unreadableSourceCount = 0;
    let lowQualitySourceCount = 0;
    let duplicateSourceCount = 0;
    let evidenceSourceCount = 0;
    let retrievalAttemptCount = 0;
    let retryCount = 0;
    let candidateEvaluationOperationCount = 0;
    const readOptions: BrowserReadOptions = {
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
    };

    try {
      let discovery: ResearchResult['discovery'] | undefined;
      let candidateOutcomes: CandidateOutcome[] = [];
      let selectedCandidates: CandidateSelection['selected'] = [];
      if (sourceMode === 'discover') {
        if (!this.searchProvider) throw new Error('Automatic search is not configured.');
        const searchResult = await this.searchProvider.search(input.request, {
          maxResults: this.limits.maxDiscoveryCandidates,
        });
        const rawCandidates = searchResult.candidates;
        const normalizedCandidates = rawCandidates
          .slice(0, this.limits.maxDiscoveryCandidates)
          .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
        let selection = selectSearchCandidates(
          input.request,
          normalizedCandidates,
          this.limits.maxDiscoveryCandidates,
        );
        if (
          this.claimExtractor?.supportsCandidateEvaluation === true &&
          this.claimExtractor.evaluateCandidates &&
          selection.ranked.length > 0
        ) {
          const remaining = remainingBudgetMs(taskStartedAt, this.limits.totalBudgetMs);
          const evaluationBudget = Math.min(
            this.limits.candidateEvaluationTimeoutMs,
            remaining - MODEL_RESERVE_MS - 2_000,
          );
          if (evaluationBudget >= 1_000) {
            candidateEvaluationOperationCount += 1;
            try {
              const evaluations = await boundedTimeout(evaluationBudget, (signal) =>
                this.claimExtractor!.evaluateCandidates!({
                  request: input.request,
                  candidates: selection.ranked.map((item) => ({
                    rank: item.candidate.rank,
                    url: item.candidate.url,
                    title: item.candidate.title,
                  })),
                  signal,
                }),
              );
              const validRanks = new Set(selection.ranked.map((item) => item.candidate.rank));
              const scoreMap = new Map<number, number>();
              for (const evaluation of evaluations) {
                if (
                  validRanks.has(evaluation.rank) &&
                  Number.isInteger(evaluation.relevanceScore) &&
                  evaluation.relevanceScore >= 0 &&
                  evaluation.relevanceScore <= 100
                ) {
                  scoreMap.set(evaluation.rank, evaluation.relevanceScore);
                }
              }
              selection = selectSearchCandidates(
                input.request,
                normalizedCandidates,
                this.limits.maxDiscoveryCandidates,
                scoreMap,
              );
              await this.repository.appendEvent(task.id, 'candidate_evaluation_completed', {
                provider: this.claimExtractor.provider ?? 'configured-provider',
                evaluatedCandidateCount: scoreMap.size,
                scoreInfluence: 'advisory-only',
              });
            } catch (error) {
              await this.recordModelFailure(task.id, error, 'candidate_evaluation');
              await this.repository.appendEvent(task.id, 'candidate_evaluation_fallback', {
                method: 'deterministic-ranking',
              });
            }
          } else {
            await this.repository.appendEvent(task.id, 'candidate_evaluation_skipped', {
              reason: 'insufficient-time-budget',
            });
          }
        }
        selectedCandidates = selection.selected;
        candidateOutcomes = this.makeInitialCandidateOutcomes(
          selection,
          rawCandidates,
          rawCandidates.length,
          this.limits.maxDiscoveryCandidates,
        );
        discovery = {
          provider: searchResult.provider,
          candidateCount: rawCandidates.length,
          selectedCount: selectedCandidates.length,
          attemptedCount: 0,
          retrievalAttemptCount: 0,
          retryCount: 0,
          successfulReadCount: 0,
          usefulContentCount: 0,
          candidates: candidateOutcomes,
        };
        await this.repository.appendEvent(task.id, 'search_completed', {
          provider: searchResult.provider,
          candidateCount: rawCandidates.length,
          selectedCount: selectedCandidates.length,
          candidateEvaluationOperationCount,
          candidates: candidateOutcomes.map(
            ({ rank, domain, score, relevanceScore, status, reason }) => ({
              rank,
              domain,
              score,
              relevanceScore,
              status,
              ...(reason ? { reason } : {}),
            }),
          ),
        });
      }

      const selectedCandidateByUrl = new Map(
        selectedCandidates.map((item) => [item.candidate.url, item]),
      );
      const sourceUrls =
        sourceMode === 'discover'
          ? selectedCandidates.map((item) => item.candidate.url)
          : (input.sources ?? []);

      for (let sourceIndex = 0; sourceIndex < sourceUrls.length; sourceIndex += 1) {
        const sourceUrl = sourceUrls[sourceIndex]!;
        const candidate = selectedCandidateByUrl.get(sourceUrl);
        const remaining = remainingBudgetMs(taskStartedAt, this.limits.totalBudgetMs);
        if (remaining < 1_000) {
          await this.repository.appendEvent(task.id, 'source_reads_stopped', {
            reason: 'research-budget-exhausted',
            unattemptedCount: sourceUrls.length - sourceIndex,
          });
          for (const unattempted of selectedCandidates.slice(sourceIndex)) {
            this.updateCandidateOutcome(candidateOutcomes, unattempted.candidate.rank, {
              status: 'rejected',
              reason: 'research-budget-exhausted',
            });
          }
          break;
        }
        if (sourceMode === 'discover' && evidenceSourceCount >= this.limits.maxEvidenceSources) {
          await this.repository.appendEvent(task.id, 'source_reads_stopped', {
            reason: 'evidence-source-cap-reached',
            unattemptedCount: sourceUrls.length - sourceIndex,
          });
          for (const unattempted of selectedCandidates.slice(sourceIndex)) {
            this.updateCandidateOutcome(candidateOutcomes, unattempted.candidate.rank, {
              status: 'rejected',
              reason: 'evidence-source-cap-reached',
            });
          }
          break;
        }

        if (discovery) discovery.attemptedCount += 1;
        const candidatesRemaining = Math.max(1, sourceUrls.length - sourceIndex);
        const reserveForModels = Math.min(MODEL_RESERVE_MS, Math.floor(remaining / 3));
        const adaptiveShare = Math.floor((remaining - reserveForModels) / candidatesRemaining);
        const requestedPageTimeout = Math.min(
          input.timeoutMs ?? this.limits.defaultSourceTimeoutMs,
          this.limits.maxSourceTimeoutMs,
        );
        const pageTimeoutMs = Math.max(1_000, Math.min(requestedPageTimeout, adaptiveShare));
        let page: Awaited<ReturnType<BrowserAdapter['readPage']>> | undefined;
        let lastReadFailure: BrowserReadError | undefined;
        let candidateRetryCount = 0;
        for (let readAttempt = 0; readAttempt < 2; readAttempt += 1) {
          const readRemaining = remainingBudgetMs(taskStartedAt, this.limits.totalBudgetMs);
          if (readRemaining < 1_000) break;
          const timeoutMs =
            readAttempt === 0
              ? Math.min(pageTimeoutMs, readRemaining)
              : Math.min(pageTimeoutMs, 5_000, readRemaining - 1_000);
          if (timeoutMs < 1_000) break;
          retrievalAttemptCount += 1;
          if (discovery) discovery.retrievalAttemptCount += 1;
          try {
            page = await this.adapter.readPage(sourceUrl, { ...readOptions, timeoutMs });
            if (discovery) discovery.successfulReadCount += 1;
            break;
          } catch (error) {
            const failure = toReadFailure(error);
            lastReadFailure = failure;
            if (
              discovery &&
              failure.code === 'NAVIGATION_TIMEOUT' &&
              readAttempt === 0 &&
              remainingBudgetMs(taskStartedAt, this.limits.totalBudgetMs) > MODEL_RESERVE_MS + 2_000
            ) {
              const retryBudget = Math.min(
                5_000,
                pageTimeoutMs,
                remainingBudgetMs(taskStartedAt, this.limits.totalBudgetMs) - MODEL_RESERVE_MS,
              );
              if (retryBudget >= 1_000) {
                candidateRetryCount += 1;
                retryCount += 1;
                if (discovery) discovery.retryCount += 1;
                await this.repository.appendEvent(task.id, 'source_read_retry', {
                  rank: candidate?.candidate.rank,
                  domain:
                    candidate?.domain ??
                    candidateDomain({ url: sourceUrl, title: '', rank: sourceIndex + 1 }),
                  retryCount: candidateRetryCount,
                  reason: 'navigation-timeout',
                  backoffMs: MAX_RETRY_BACKOFF_MS,
                });
                await new Promise((resolve) => setTimeout(resolve, MAX_RETRY_BACKOFF_MS));
                continue;
              }
            }
            break;
          }
        }

        if (!page) {
          const failure =
            lastReadFailure ??
            new BrowserReadError(
              'NAVIGATION_TIMEOUT',
              'Source read stopped at the research time budget.',
            );
          if (discovery) {
            unreadableSourceCount += 1;
            this.updateCandidateOutcome(
              candidateOutcomes,
              candidate?.candidate.rank ?? sourceIndex + 1,
              {
                status: 'read-failed',
                reason: failureLabel(failure.code),
                errorCode: failure.code,
                ...(failure.responseSizeLimitScope === undefined
                  ? {}
                  : { responseSizeLimitScope: failure.responseSizeLimitScope }),
              },
            );
            try {
              this.onSourceReadFailure?.({
                code: failure.code,
                ...(failure.responseSizeLimitScope === undefined
                  ? {}
                  : { responseSizeLimitScope: failure.responseSizeLimitScope }),
              });
            } catch {
              // Diagnostics must never interrupt an otherwise recoverable research run.
            }
            await this.repository.appendEvent(task.id, 'source_unreadable', {
              rank: candidate?.candidate.rank,
              domain:
                candidate?.domain ??
                candidateDomain({ url: sourceUrl, title: '', rank: sourceIndex + 1 }),
              reason: failureLabel(failure.code),
              errorCode: failure.code,
              ...(failure.responseSizeLimitScope === undefined
                ? {}
                : { responseSizeLimitScope: failure.responseSizeLimitScope }),
            });
            continue;
          }
          throw failure;
        }

        const storedSource = await this.repository.recordSource(task.id, page);
        const quality = assessSourceQuality(page, storedSource.id, sourceSnapshots, input.request);
        sourceResults.push({
          id: storedSource.id,
          url: page.url,
          finalUrl: page.finalUrl,
          title: page.title,
          retrievedAt: page.retrievedAt,
          ...(page.httpStatus === undefined ? {} : { httpStatus: page.httpStatus }),
          ...(page.contentType === undefined ? {} : { contentType: page.contentType }),
          ...(page.extraction === undefined ? {} : { extraction: page.extraction }),
          quality,
        });
        if (candidate) {
          this.updateCandidateOutcome(candidateOutcomes, candidate.candidate.rank, {
            status: 'readable',
            relevanceScore: quality.relevanceScore,
            reason: 'page-read-completed',
          });
        }

        if (quality.accessStatus === 'security-challenge') {
          securityChallengeSourceCount += 1;
          if (candidate) {
            this.updateCandidateOutcome(candidateOutcomes, candidate.candidate.rank, {
              status: 'security-challenge',
              reason: 'security-verification-required',
            });
          }
          await this.repository.appendEvent(task.id, 'source_blocked', {
            sourceId: storedSource.id,
            rank: candidate?.candidate.rank,
            domain: quality.domain,
            reason: 'security-verification-required',
          });
          continue;
        }

        if (quality.accessStatus === 'unavailable') {
          unreadableSourceCount += 1;
          if (candidate) {
            this.updateCandidateOutcome(candidateOutcomes, candidate.candidate.rank, {
              status: 'unavailable',
              reason: quality.exclusionReason ?? 'unavailable-page',
            });
          }
          await this.repository.appendEvent(task.id, 'source_unreadable', {
            sourceId: storedSource.id,
            rank: candidate?.candidate.rank,
            domain: quality.domain,
            reason: quality.exclusionReason ?? 'unavailable-page',
          });
          continue;
        }

        const duplicate = quality.duplicateOfSourceId !== undefined;
        sourceSnapshots.push({ id: storedSource.id, hash: quality.contentHash, text: page.text });
        if (duplicate) {
          duplicateSourceCount += 1;
          if (candidate) {
            this.updateCandidateOutcome(candidateOutcomes, candidate.candidate.rank, {
              status: 'duplicate',
              reason: 'near-duplicate-content',
            });
          }
          await this.repository.appendEvent(task.id, 'source_excluded', {
            sourceId: storedSource.id,
            rank: candidate?.candidate.rank,
            domain: quality.domain,
            reason: 'near-duplicate-content',
            duplicateOfSourceId: quality.duplicateOfSourceId,
          });
          continue;
        }
        if (quality.evidenceStatus !== 'eligible') {
          lowQualitySourceCount += 1;
          if (candidate) {
            this.updateCandidateOutcome(candidateOutcomes, candidate.candidate.rank, {
              status: 'low-quality',
              reason: quality.exclusionReason ?? 'evidence-quality-threshold',
            });
          }
          await this.repository.appendEvent(task.id, 'source_excluded', {
            sourceId: storedSource.id,
            rank: candidate?.candidate.rank,
            domain: quality.domain,
            reason: quality.exclusionReason ?? 'evidence-quality-threshold',
          });
          continue;
        }

        const passages = this.makePassages(page);
        const remainingPassageCap = MAX_TOTAL_EVIDENCE_PASSAGES - evidence.length;
        const boundedPassages = passages.slice(
          0,
          Math.min(MAX_EVIDENCE_PASSAGES_PER_SOURCE, remainingPassageCap),
        );
        if (boundedPassages.length === 0) {
          lowQualitySourceCount += 1;
          if (candidate) {
            this.updateCandidateOutcome(candidateOutcomes, candidate.candidate.rank, {
              status: 'low-quality',
              reason: 'no-extractable-passage',
            });
          }
          await this.repository.appendEvent(task.id, 'source_excluded', {
            sourceId: storedSource.id,
            rank: candidate?.candidate.rank,
            domain: quality.domain,
            reason: 'no-extractable-passage',
          });
          continue;
        }

        const extractionMethod = page.articleBlocks?.length
          ? page.extraction?.method === 'mozilla-readability'
            ? 'mozilla-readability-passage'
            : 'semantic-fallback-passage'
          : 'visible-text-segmentation';
        const evidenceInputs: CreateEvidenceInput[] = boundedPassages.map((passage) => ({
          excerpt: passage.excerpt,
          locator: passage.locator,
          extractionMethod,
          verificationStatus: 'unverified',
        }));
        const persistedEvidence = this.repository.recordEvidenceBatch
          ? await this.repository.recordEvidenceBatch(task.id, storedSource.id, evidenceInputs)
          : await Promise.all(
              evidenceInputs.map((evidenceInput) =>
                this.repository.recordEvidence(task.id, storedSource.id, evidenceInput),
              ),
            );
        const recordsByLocator = new Map(persistedEvidence.map((item) => [item.locator, item]));
        for (const passage of boundedPassages) {
          const record = recordsByLocator.get(passage.locator);
          if (!record) throw new Error('The evidence repository omitted a saved passage.');
          evidence.push({
            id: record.id,
            sourceId: storedSource.id,
            excerpt: passage.excerpt,
            locator: record.locator,
            verificationStatus: record.verificationStatus,
            extractionMethod,
            originalUrl: page.url,
            finalUrl: page.finalUrl,
            articleTitle: page.title,
            retrievedAt: page.retrievedAt,
            sourceDomain: quality.domain,
            contentFingerprint: passageFingerprint(passage.excerpt),
            segmentIndex: passage.segmentIndex,
            relevanceScore: calculateRelevanceScore(input.request, page.title, passage.excerpt),
            startOffset: passage.startOffset,
            endOffset: passage.endOffset,
            ...(passage.sectionHeading === undefined
              ? {}
              : { sectionHeading: passage.sectionHeading }),
          });
        }
        evidenceSourceCount += 1;
        if (discovery) discovery.usefulContentCount = evidenceSourceCount;
        await this.repository.appendEvent(task.id, 'source_completed', {
          sourceId: storedSource.id,
          rank: candidate?.candidate.rank,
          domain: quality.domain,
          evidencePassageCount: boundedPassages.length,
          extractionMethod,
          qualityScore: quality.qualityScore,
          relevanceScore: quality.relevanceScore,
        });
      }

      if (discovery) {
        discovery.retrievalAttemptCount = retrievalAttemptCount;
        discovery.retryCount = retryCount;
        discovery.successfulReadCount = sourceResults.length;
        discovery.usefulContentCount = evidenceSourceCount;
        discovery.candidates = [...candidateOutcomes].sort((left, right) => left.rank - right.rank);
      }

      const evidenceRecords = evidence.map((item) => ({
        id: item.id,
        taskId: task.id,
        sourceId: item.sourceId,
        excerpt: item.excerpt,
        locator: item.locator,
        extractionMethod: item.extractionMethod,
        verificationStatus: item.verificationStatus,
        originalUrl: item.originalUrl,
        finalUrl: item.finalUrl,
        articleTitle: item.articleTitle,
        retrievedAt: item.retrievedAt,
        sourceDomain: item.sourceDomain,
        contentFingerprint: item.contentFingerprint,
        ...(item.sectionHeading === undefined ? {} : { sectionHeading: item.sectionHeading }),
        segmentIndex: item.segmentIndex,
        relevanceScore: item.relevanceScore,
        startOffset: item.startOffset,
        endOffset: item.endOffset,
      }));
      const duplicateSourceIds = new Set(
        sourceResults
          .filter((source) => source.quality.duplicateOfSourceId !== undefined)
          .map((source) => source.id),
      );
      const exactFindings = extractCrossSourceFindings(evidenceRecords, duplicateSourceIds);
      let findings = [...exactFindings];
      const modelAnalysis: NonNullable<ResearchResult['modelAnalysis']> = {
        status: this.claimExtractor
          ? 'skipped'
          : evidenceRecords.length > 0
            ? 'deterministic-only'
            : 'disabled',
        ...(this.claimExtractor?.provider === undefined
          ? {}
          : { provider: this.claimExtractor.provider }),
        ...(this.claimExtractor?.model === undefined ? {} : { model: this.claimExtractor.model }),
        requestCount: candidateEvaluationOperationCount,
        sourceAssessments: [],
        evidenceAssessments: [],
        potentialContradictions: [],
        missingEvidence: [],
      };

      if (this.claimExtractor && evidenceRecords.length > 0) {
        const remaining = remainingBudgetMs(taskStartedAt, this.limits.totalBudgetMs);
        const analysisBudget = Math.min(this.limits.evidenceAnalysisTimeoutMs, remaining);
        if (analysisBudget < 1_000) {
          modelAnalysis.status = 'skipped';
          modelAnalysis.missingEvidence = [
            'AI analysis was skipped because the research time budget was nearly exhausted.',
          ];
          await this.repository.appendEvent(task.id, 'model_analysis_skipped', {
            reason: 'insufficient-time-budget',
            evidencePassageCount: evidenceRecords.length,
          });
        } else {
          modelAnalysis.requestCount = (modelAnalysis.requestCount ?? 0) + 1;
          try {
            const analysis = await boundedTimeout(analysisBudget, async (signal) => {
              if (this.claimExtractor!.analyzeEvidence) {
                return this.claimExtractor!.analyzeEvidence({
                  request: input.request,
                  sources: sourceResults.map((source) => ({
                    id: source.id,
                    title: source.title,
                    domain: source.quality.domain,
                    relevanceScore: source.quality.relevanceScore,
                  })),
                  evidence: evidenceRecords,
                  signal,
                });
              }
              const extracted = await this.claimExtractor!.extract({
                request: input.request,
                evidence: evidenceRecords,
                signal,
              });
              return {
                provider: this.claimExtractor!.provider ?? 'configured-provider',
                model: this.claimExtractor!.model ?? 'configured-model',
                findings: extracted,
                sourceAssessments: [],
                evidenceAssessments: [],
                potentialContradictions: [],
                missingEvidence: [],
              } satisfies ModelEvidenceAnalysis;
            });
            const validated = validateModelAnalysis(analysis, evidence, sourceResults);
            const exactByClaim = new Map(
              exactFindings.map((finding) => [
                finding.claim.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
                finding,
              ]),
            );
            const provisionalFindings: ResearchResult['findings'] = filterGroundedFindings(
              validated.findings,
              evidenceRecords,
            ).map((finding) => ({
              ...finding,
              status: 'proposed' as const,
              reviewRequired: true as const,
            }));
            const provisionalByClaim = new Map<string, ResearchResult['findings'][number]>();
            for (const finding of provisionalFindings) {
              const key = finding.claim.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
              if (!exactByClaim.has(key)) provisionalByClaim.set(key, finding);
            }
            findings = [
              ...exactFindings,
              ...[...provisionalByClaim.values()].slice(0, Math.max(0, 20 - exactFindings.length)),
            ];
            modelAnalysis.status = 'completed';
            modelAnalysis.provider = validated.provider;
            modelAnalysis.model = validated.model;
            modelAnalysis.sourceAssessments = validated.sourceAssessments;
            modelAnalysis.evidenceAssessments = validated.evidenceAssessments;
            modelAnalysis.potentialContradictions = validated.potentialContradictions.map(
              (item) => ({
                ...item,
                reviewRequired: true as const,
              }),
            );
            modelAnalysis.missingEvidence = validated.missingEvidence;
            if (validated.usage?.inputTokens !== undefined) {
              modelAnalysis.inputTokens = validated.usage.inputTokens;
            }
            if (validated.usage?.outputTokens !== undefined) {
              modelAnalysis.outputTokens = validated.usage.outputTokens;
            }
            await this.repository.appendEvent(task.id, 'model_analysis_completed', {
              provider: validated.provider,
              model: validated.model,
              modelOperationCount: modelAnalysis.requestCount,
              findingCount: provisionalFindings.length,
              sourceAssessmentCount: validated.sourceAssessments.length,
              evidenceAssessmentCount: validated.evidenceAssessments.length,
              potentialContradictionCount: validated.potentialContradictions.length,
              missingEvidenceCount: validated.missingEvidence.length,
              ...(validated.usage?.inputTokens === undefined
                ? {}
                : { inputTokens: validated.usage.inputTokens }),
              ...(validated.usage?.outputTokens === undefined
                ? {}
                : { outputTokens: validated.usage.outputTokens }),
            });
          } catch (error) {
            modelAnalysis.status = 'failed';
            modelAnalysis.missingEvidence = [
              'AI analysis did not complete; review the saved evidence manually.',
            ];
            const failure = modelFailureDetails(
              error,
              'evidence_analysis',
              this.claimExtractor.provider,
            );
            modelAnalysis.failure = failure;
            await this.repository.appendEvent(task.id, 'model_analysis_failed', { ...failure });
            findings = exactFindings;
          }
        }
      } else if (this.claimExtractor) {
        modelAnalysis.status = 'skipped';
        modelAnalysis.missingEvidence = [
          'No evidence-eligible passages were available for AI analysis.',
        ];
        await this.repository.appendEvent(task.id, 'model_analysis_skipped', {
          reason: 'no-evidence-eligible-passages',
          securityChallengeSourceCount,
          unreadableSourceCount,
        });
      }

      const incompleteSourceCoverage =
        securityChallengeSourceCount > 0 ||
        unreadableSourceCount > 0 ||
        lowQualitySourceCount > 0 ||
        duplicateSourceCount > 0 ||
        evidenceSourceCount === 0 ||
        (discovery !== undefined &&
          (discovery.candidateCount > discovery.selectedCount ||
            discovery.attemptedCount < discovery.selectedCount));
      const result: ResearchResult = {
        request: input.request,
        ...(discovery === undefined ? {} : { discovery }),
        coverage: {
          status: incompleteSourceCoverage ? 'incomplete' : 'complete',
          securityChallengeSourceCount,
          unreadableSourceCount,
          retrievedSourceCount: sourceResults.length,
          lowQualitySourceCount,
          duplicateSourceCount,
          evidenceSourceCount,
        },
        sources: sourceResults,
        evidence,
        findings,
        modelAnalysis,
      };
      await this.repository.markCompleted(task.id, result);
      await this.repository.appendEvent(task.id, 'task_completed', {
        sourceCount: sourceResults.length,
        evidencePassageCount: evidence.length,
        evidenceSourceCount,
        findingCount: findings.length,
        coverage: result.coverage.status,
        modelAnalysisStatus: modelAnalysis.status,
      });
      return { taskId: task.id, result };
    } catch (error) {
      await this.repository.markFailed(
        task.id,
        error instanceof BrowserReadError
          ? error.code
          : error instanceof Error
            ? error.name
            : 'RESEARCH_FAILED',
      );
      await this.repository.appendEvent(task.id, 'task_failed', {
        errorCode: error instanceof BrowserReadError ? error.code : 'RESEARCH_FAILED',
      });
      throw error;
    }
  }

  private makePassages(page: ResearchSourceRecord['result']): EvidencePassage[] {
    if (page.articleBlocks && page.articleBlocks.length > 0) {
      return segmentArticle(
        {
          title: page.title,
          text: page.text,
          blocks: page.articleBlocks,
          metadata: metadataForPage(page),
        },
        { maxSegments: MAX_EVIDENCE_PASSAGES_PER_SOURCE, maxCharsPerSegment: 1_000 },
      );
    }
    return segmentPlainText(page.text, {
      maxSegments: MAX_EVIDENCE_PASSAGES_PER_SOURCE,
      maxCharsPerSegment: 1_000,
    });
  }

  private makeInitialCandidateOutcomes(
    selection: CandidateSelection,
    candidates: SearchCandidate[],
    totalCandidateCount: number,
    candidateCap: number,
  ): CandidateOutcome[] {
    const outcomes: CandidateOutcome[] = [
      ...selection.selected.map((item) => ({
        rank: item.candidate.rank,
        domain: item.domain,
        score: item.score,
        relevanceScore: item.relevanceScore,
        status: 'selected' as const,
        reason: item.signals.join(', ') || 'deterministic-relevance-selection',
      })),
      ...selection.rejected.map((item) => {
        return {
          rank: item.rank,
          domain: item.domain ?? 'unknown',
          score: 0,
          relevanceScore: 0,
          status: 'rejected' as const,
          reason: rejectionLabel(item.reason),
        };
      }),
    ];
    for (let index = candidateCap; index < totalCandidateCount; index += 1) {
      const candidate = candidates[index];
      if (!candidate) continue;
      outcomes.push({
        rank: index + 1,
        domain: candidateDomain(candidate),
        score: 0,
        relevanceScore: 0,
        status: 'rejected',
        reason: 'candidate-cap-exceeded',
      });
    }
    return outcomes.sort((left, right) => left.rank - right.rank);
  }

  private updateCandidateOutcome(
    outcomes: CandidateOutcome[],
    rank: number,
    update: Partial<CandidateOutcome>,
  ): void {
    const index = outcomes.findIndex((outcome) => outcome.rank === rank);
    if (index < 0) return;
    outcomes[index] = { ...outcomes[index]!, ...update };
  }

  private async recordModelFailure(
    taskId: string,
    error: unknown,
    operation: ModelProviderOperation,
  ): Promise<void> {
    const failure = modelFailureDetails(error, operation, this.claimExtractor?.provider);
    await this.repository.appendEvent(taskId, 'model_provider_failure', { ...failure });
  }
}
