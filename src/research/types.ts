import type { BrowserReadError, BrowserReadResult } from '../core/result.js';
import type { SourceQualityMetadata } from './source-quality.js';

export type EvidenceVerificationStatus = 'unverified' | 'supported' | 'disputed';
export type EvidenceExtractionMethod =
  | 'mozilla-readability-passage'
  | 'semantic-fallback-passage'
  | 'visible-text-segmentation'
  | 'visible-text-prefix';

export type CandidateOutcomeStatus =
  | 'rejected'
  | 'selected'
  | 'readable'
  | 'security-challenge'
  | 'unavailable'
  | 'duplicate'
  | 'low-quality'
  | 'irrelevant'
  | 'read-failed';

export interface CandidateOutcome {
  rank: number;
  domain: string;
  score: number;
  relevanceScore: number;
  status: CandidateOutcomeStatus;
  reason?: string;
  errorCode?: BrowserReadError['code'];
  responseSizeLimitScope?: NonNullable<BrowserReadError['responseSizeLimitScope']>;
}

export interface ResearchSourceRecord {
  id: string;
  taskId: string;
  result: BrowserReadResult;
}

export interface ResearchEvidenceRecord {
  id: string;
  taskId: string;
  sourceId: string;
  excerpt: string;
  locator: string;
  extractionMethod: EvidenceExtractionMethod;
  verificationStatus: EvidenceVerificationStatus;
  originalUrl?: string;
  finalUrl?: string;
  articleTitle?: string;
  retrievedAt?: string;
  sourceDomain?: string;
  contentFingerprint?: string;
  sectionHeading?: string;
  segmentIndex?: number;
  relevanceScore?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface ResearchFinding {
  claim: string;
  status: 'proposed' | 'supported' | 'exact_match';
  verificationMethod: 'exact-text-match' | 'llm-evidence-grounded';
  uncertainty?: string;
  evidenceIds: string[];
  reviewRequired?: boolean;
}

export type ModelAnalysisFailureKind =
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'timeout'
  | 'cancelled'
  | 'model_unavailable'
  | 'authentication_failed'
  | 'invalid_request'
  | 'invalid_response';

export interface ModelAnalysisFailure {
  provider: string;
  operation: 'candidate_evaluation' | 'evidence_analysis';
  kind: ModelAnalysisFailureKind;
  statusCode?: number;
  errorCode?: string;
  attemptCount?: number;
  retryCount?: number;
  durationMs?: number;
}

export interface ResearchResult {
  request: string;
  discovery?: {
    provider: string;
    candidateCount: number;
    selectedCount: number;
    attemptedCount: number;
    retrievalAttemptCount: number;
    retryCount: number;
    successfulReadCount: number;
    usefulContentCount: number;
    candidates: CandidateOutcome[];
  };
  coverage: {
    status: 'complete' | 'incomplete';
    securityChallengeSourceCount: number;
    unreadableSourceCount: number;
    retrievedSourceCount: number;
    lowQualitySourceCount: number;
    duplicateSourceCount: number;
    evidenceSourceCount: number;
  };
  sources: Array<{
    id: string;
    url: string;
    finalUrl: string;
    title: string;
    retrievedAt: string;
    httpStatus?: number;
    contentType?: string;
    extraction?: BrowserReadResult['extraction'];
    quality: SourceQualityMetadata;
  }>;
  evidence: Array<{
    id: string;
    sourceId: string;
    excerpt: string;
    locator: string;
    verificationStatus: EvidenceVerificationStatus;
    extractionMethod: EvidenceExtractionMethod;
    originalUrl: string;
    finalUrl: string;
    articleTitle: string;
    retrievedAt: string;
    sourceDomain: string;
    contentFingerprint: string;
    segmentIndex: number;
    relevanceScore: number;
    startOffset: number;
    endOffset: number;
    sectionHeading?: string;
  }>;
  findings: ResearchFinding[];
  modelAnalysis?: {
    status: 'completed' | 'deterministic-only' | 'failed' | 'disabled' | 'skipped';
    provider?: string;
    model?: string;
    failure?: ModelAnalysisFailure;
    requestCount?: number;
    inputTokens?: number;
    outputTokens?: number;
    sourceAssessments: Array<{
      sourceId: string;
      relevanceScore: number;
      contentType: 'article' | 'listing' | 'program-page' | 'directory' | 'other';
    }>;
    evidenceAssessments: Array<{
      evidenceId: string;
      relevanceScore: number;
      relation: 'supports' | 'contradicts' | 'context';
    }>;
    potentialContradictions: Array<{
      summary: string;
      evidenceIds: string[];
      reviewRequired: true;
    }>;
    missingEvidence: string[];
  };
}
