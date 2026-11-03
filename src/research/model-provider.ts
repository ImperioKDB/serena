import { GeminiProviderError } from './gemini-research-provider.js';
import type {
  CandidateEvaluation,
  CandidateEvaluationInput,
  ClaimExtractor,
  ModelEvidenceAnalysis,
} from './claim-extractor.js';
import type { ResearchEvidenceRecord } from './types.js';

export type ModelProviderFailureKind =
  | 'rate_limited'
  | 'timeout'
  | 'cancelled'
  | 'model_unavailable'
  | 'invalid_response'
  | 'authentication_failed'
  | 'invalid_request'
  | 'upstream_error';

export type ModelProviderOperation = 'candidate_evaluation' | 'evidence_analysis';

export interface ModelProviderFailureDiagnostic {
  provider: string;
  operation: ModelProviderOperation;
  kind: ModelProviderFailureKind;
  statusCode?: number;
  errorCode?: string;
  attemptCount?: number;
  retryCount?: number;
  durationMs?: number;
}

export class ModelProviderError extends Error {
  public constructor(
    public readonly provider: string,
    public readonly kind: ModelProviderFailureKind,
    public readonly statusCode?: number,
    public readonly diagnostics: Omit<ModelProviderFailureDiagnostic, 'provider' | 'operation' | 'kind'> = {},
  ) {
    super(`Research model provider failed (${kind}).`);
    this.name = 'ModelProviderError';
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const value of [record.status, record.statusCode, record.response?.status]) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  if (error instanceof Error) {
    const match = /\bHTTP\s+(\d{3})\b/iu.exec(error.message);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function safeFailure(provider: string, error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  if (error instanceof GeminiProviderError) {
    return new ModelProviderError(provider, error.kind, error.statusCode, {
      ...error.diagnostics,
    });
  }
  const statusCode = statusOf(error);
  const text = error instanceof Error ? `${error.name} ${error.message}`.toLocaleLowerCase() : '';
  const kind: ModelProviderFailureKind =
    statusCode === 401 ||
    statusCode === 403 ||
    /unauthenticated|invalid.?api.?key|permission denied/u.test(text)
      ? 'authentication_failed'
      : statusCode === 400 || /invalid argument|invalid request|bad request/u.test(text)
        ? 'invalid_request'
        : statusCode === 429 || /rate.?limit|resource_exhausted/u.test(text)
          ? 'rate_limited'
          : statusCode === 404 || /model.{0,30}(?:not found|unavailable)/u.test(text)
            ? 'model_unavailable'
            : /aborterror|timeout|timed? ?out/u.test(text)
              ? 'timeout'
              : error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError')
                ? 'invalid_response'
                : 'upstream_error';
  return new ModelProviderError(provider, kind, statusCode);
}

function makeBasicAnalysis(
  provider: string,
  model: string,
  findings: ModelEvidenceAnalysis['findings'],
): ModelEvidenceAnalysis {
  return {
    provider,
    model,
    findings,
    sourceAssessments: [],
    evidenceAssessments: [],
    potentialContradictions: [],
    missingEvidence: [],
  };
}

export class ModelProviderChain implements ClaimExtractor {
  public readonly provider: string;
  public readonly model: string;
  public readonly supportsCandidateEvaluation: boolean;

  public constructor(
    private readonly providers: ClaimExtractor[],
    private readonly onFailure?: (diagnostic: ModelProviderFailureDiagnostic) => void,
  ) {
    if (providers.length === 0) throw new Error('At least one model provider must be configured.');
    this.provider = providers[0]?.provider ?? 'configured-provider';
    this.model = providers[0]?.model ?? 'configured-model';
    this.supportsCandidateEvaluation = providers.some(
      (provider) => provider.supportsCandidateEvaluation === true,
    );
  }

  public async evaluateCandidates(input: CandidateEvaluationInput): Promise<CandidateEvaluation[]> {
    let lastError: ModelProviderError | undefined;
    for (const provider of this.providers) {
      if (!provider.evaluateCandidates) continue;
      try {
        return await provider.evaluateCandidates(input);
      } catch (error) {
        lastError = safeFailure(provider.provider ?? 'unknown', error);
        this.notifyFailure({
          provider: lastError.provider,
          operation: 'candidate_evaluation',
          kind: lastError.kind,
          ...(lastError.statusCode === undefined ? {} : { statusCode: lastError.statusCode }),
          ...lastError.diagnostics,
          error: lastError,
        });
      }
    }
    if (lastError) throw lastError;
    return [];
  }

  public async analyzeEvidence(input: {
    request: string;
    sources: Array<{ id: string; title: string; domain: string; relevanceScore: number }>;
    evidence: ResearchEvidenceRecord[];
    signal?: AbortSignal;
  }): Promise<ModelEvidenceAnalysis> {
    let lastError: ModelProviderError | undefined;
    for (const provider of this.providers) {
      try {
        if (provider.analyzeEvidence) return await provider.analyzeEvidence(input);
        const findings = await provider.extract(input);
        return makeBasicAnalysis(
          provider.provider ?? 'configured-provider',
          provider.model ?? 'configured-model',
          findings,
        );
      } catch (error) {
        lastError = safeFailure(provider.provider ?? 'unknown', error);
        this.notifyFailure({
          provider: lastError.provider,
          operation: 'evidence_analysis',
          kind: lastError.kind,
          ...(lastError.statusCode === undefined ? {} : { statusCode: lastError.statusCode }),
          ...lastError.diagnostics,
          error: lastError,
        });
      }
    }
    throw lastError ?? new ModelProviderError(this.provider, 'upstream_error');
  }

  public async extract(input: {
    request: string;
    evidence: ResearchEvidenceRecord[];
    signal?: AbortSignal;
  }): Promise<ModelEvidenceAnalysis['findings']> {
    const sources = [...new Map(input.evidence.map((item) => [item.sourceId, item])).values()].map(
      (item) => ({
        id: item.sourceId,
        title: item.articleTitle ?? '',
        domain: item.sourceDomain ?? '',
        relevanceScore: 50,
      }),
    );
    return (await this.analyzeEvidence({ ...input, sources })).findings;
  }

  private notifyFailure(
    input: ModelProviderFailureDiagnostic & { error: ModelProviderError },
  ): void {
    try {
      this.onFailure?.({
        provider: input.provider,
        operation: input.operation,
        kind: input.error.kind,
        ...(input.error.statusCode === undefined ? {} : { statusCode: input.error.statusCode }),
        ...input.error.diagnostics,
      });
    } catch {
      // Diagnostics must never interrupt the research run.
    }
  }
}
