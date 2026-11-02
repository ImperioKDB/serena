import { DEFAULT_RESEARCH_SERVICE_LIMITS, type ResearchServiceLimits } from './research-service.js';

export type ResearchLimitEnvironment = Record<string, string | undefined>;

function readInteger(
  environment: ResearchLimitEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function readResearchServiceLimits(
  environment: ResearchLimitEnvironment,
): ResearchServiceLimits {
  const limits: ResearchServiceLimits = {
    maxDiscoveryCandidates: readInteger(
      environment,
      'SERENA_MAX_DISCOVERY_CANDIDATES',
      DEFAULT_RESEARCH_SERVICE_LIMITS.maxDiscoveryCandidates,
      1,
      10,
    ),
    maxEvidenceSources: readInteger(
      environment,
      'SERENA_MAX_EVIDENCE_SOURCES',
      DEFAULT_RESEARCH_SERVICE_LIMITS.maxEvidenceSources,
      1,
      5,
    ),
    totalBudgetMs: readInteger(
      environment,
      'SERENA_RESEARCH_BUDGET_MS',
      DEFAULT_RESEARCH_SERVICE_LIMITS.totalBudgetMs,
      20_000,
      120_000,
    ),
    defaultSourceTimeoutMs: readInteger(
      environment,
      'SERENA_SOURCE_TIMEOUT_MS',
      DEFAULT_RESEARCH_SERVICE_LIMITS.defaultSourceTimeoutMs,
      1_000,
      15_000,
    ),
    maxSourceTimeoutMs: readInteger(
      environment,
      'SERENA_MAX_SOURCE_TIMEOUT_MS',
      DEFAULT_RESEARCH_SERVICE_LIMITS.maxSourceTimeoutMs,
      1_000,
      15_000,
    ),
    candidateEvaluationTimeoutMs: readInteger(
      environment,
      'SERENA_CANDIDATE_EVALUATION_TIMEOUT_MS',
      DEFAULT_RESEARCH_SERVICE_LIMITS.candidateEvaluationTimeoutMs,
      1_000,
      5_000,
    ),
    evidenceAnalysisTimeoutMs: readInteger(
      environment,
      'SERENA_EVIDENCE_ANALYSIS_TIMEOUT_MS',
      DEFAULT_RESEARCH_SERVICE_LIMITS.evidenceAnalysisTimeoutMs,
      1_000,
      15_000,
    ),
  };
  if (limits.defaultSourceTimeoutMs > limits.maxSourceTimeoutMs) {
    throw new Error('SERENA_SOURCE_TIMEOUT_MS must not exceed SERENA_MAX_SOURCE_TIMEOUT_MS.');
  }
  return limits;
}
