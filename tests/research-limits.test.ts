import { describe, expect, it } from 'vitest';

import { readResearchServiceLimits } from '../src/research/research-limits.js';
import { DEFAULT_RESEARCH_SERVICE_LIMITS } from '../src/research/research-service.js';

describe('research service limits', () => {
  it('uses bounded defaults when no environment overrides are supplied', () => {
    expect(readResearchServiceLimits({})).toEqual(DEFAULT_RESEARCH_SERVICE_LIMITS);
  });

  it('accepts valid bounded overrides', () => {
    expect(readResearchServiceLimits({
      SERENA_MAX_DISCOVERY_CANDIDATES: '8',
      SERENA_MAX_EVIDENCE_SOURCES: '4',
      SERENA_RESEARCH_BUDGET_MS: '90000',
      SERENA_SOURCE_TIMEOUT_MS: '12000',
      SERENA_MAX_SOURCE_TIMEOUT_MS: '15000',
      SERENA_CANDIDATE_EVALUATION_TIMEOUT_MS: '4000',
      SERENA_EVIDENCE_ANALYSIS_TIMEOUT_MS: '10000',
    })).toMatchObject({
      maxDiscoveryCandidates: 8,
      maxEvidenceSources: 4,
      totalBudgetMs: 90_000,
      defaultSourceTimeoutMs: 12_000,
      maxSourceTimeoutMs: 15_000,
      candidateEvaluationTimeoutMs: 4_000,
      evidenceAnalysisTimeoutMs: 10_000,
    });
  });

  it('rejects non-integers and out-of-range values instead of silently clamping', () => {
    expect(() => readResearchServiceLimits({ SERENA_MAX_DISCOVERY_CANDIDATES: '4.5' })).toThrow(
      'SERENA_MAX_DISCOVERY_CANDIDATES must be an integer between 1 and 10.',
    );
    expect(() => readResearchServiceLimits({ SERENA_MAX_EVIDENCE_SOURCES: '6' })).toThrow(
      'SERENA_MAX_EVIDENCE_SOURCES must be an integer between 1 and 5.',
    );
    expect(() => readResearchServiceLimits({ SERENA_RESEARCH_BUDGET_MS: '150000' })).toThrow(
      'SERENA_RESEARCH_BUDGET_MS must be an integer between 20000 and 120000.',
    );
  });

  it('requires the normal source timeout not to exceed its configured maximum', () => {
    expect(() => readResearchServiceLimits({
      SERENA_SOURCE_TIMEOUT_MS: '15000',
      SERENA_MAX_SOURCE_TIMEOUT_MS: '10000',
    })).toThrow('SERENA_SOURCE_TIMEOUT_MS must not exceed SERENA_MAX_SOURCE_TIMEOUT_MS.');
  });
});
