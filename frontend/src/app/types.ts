export type FindingStatus = 'proposed' | 'supported' | 'disputed' | 'exact_match';

export type BrowserReadErrorCode =
  | 'INVALID_TARGET'
  | 'NAVIGATION_TIMEOUT'
  | 'NAVIGATION_FAILED'
  | 'RESPONSE_TOO_LARGE'
  | 'REQUEST_BUDGET_EXCEEDED'
  | 'READ_FAILED';

export interface SourceQuality {
  domain: string;
  kind: 'government' | 'education' | 'organization-domain' | 'commercial' | 'unknown';
  accessStatus?: 'readable' | 'security-challenge' | 'unavailable';
  evidenceStatus?: 'eligible' | 'excluded';
  qualityScore?: number;
  relevanceScore?: number;
  signals: string[];
  contentHash: string;
  exclusionReason?: string;
  duplicateOfSourceId?: string;
  assessment: 'domain-signals-only' | 'domain-and-content-signals-only';
}

export interface ExtractionMetadata {
  method: 'mozilla-readability' | 'semantic-fallback';
  qualityScore: number;
  characterCount: number;
  wordCount: number;
  sectionCount: number;
  byline?: string;
  siteName?: string;
  publishedTime?: string;
  language?: string;
}

export interface ResearchSource {
  id: string;
  url: string;
  finalUrl: string;
  title: string;
  retrievedAt: string;
  httpStatus?: number;
  contentType?: string;
  extraction?: ExtractionMetadata;
  quality: SourceQuality;
}

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  excerpt: string;
  locator: string;
  verificationStatus: 'unverified' | 'supported' | 'disputed';
  extractionMethod?:
    | 'mozilla-readability-passage'
    | 'semantic-fallback-passage'
    | 'visible-text-segmentation'
    | 'visible-text-prefix';
  originalUrl?: string;
  finalUrl?: string;
  articleTitle?: string;
  retrievedAt?: string;
  sourceDomain?: string;
  contentFingerprint?: string;
  segmentIndex?: number;
  relevanceScore?: number;
  startOffset?: number;
  endOffset?: number;
  sectionHeading?: string;
}

export interface ResearchFinding {
  claim: string;
  status: FindingStatus;
  verificationMethod: 'exact-text-match' | 'llm-evidence-grounded';
  uncertainty?: string;
  evidenceIds: string[];
  reviewRequired?: boolean;
}

export interface CandidateOutcome {
  rank: number;
  domain: string;
  score: number;
  relevanceScore: number;
  status:
    | 'rejected'
    | 'selected'
    | 'readable'
    | 'security-challenge'
    | 'unavailable'
    | 'duplicate'
    | 'low-quality'
    | 'irrelevant'
    | 'read-failed';
  reason?: string;
  errorCode?: BrowserReadErrorCode;
  responseSizeLimitScope?: 'resource' | 'page';
}

export interface ResearchResult {
  request: string;
  discovery?: {
    provider: string;
    candidateCount: number;
    selectedCount?: number;
    attemptedCount: number;
    retrievalAttemptCount?: number;
    retryCount?: number;
    successfulReadCount?: number;
    usefulContentCount?: number;
    candidates?: CandidateOutcome[];
  };
  coverage?: {
    status: 'complete' | 'incomplete';
    securityChallengeSourceCount: number;
    unreadableSourceCount?: number;
    retrievedSourceCount?: number;
    lowQualitySourceCount?: number;
    duplicateSourceCount?: number;
    evidenceSourceCount?: number;
  };
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  findings: ResearchFinding[];
  modelAnalysis?: {
    status: 'completed' | 'deterministic-only' | 'failed' | 'disabled' | 'skipped';
    provider?: string;
    model?: string;
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

export interface ResearchApiResponse {
  data: ResearchResult;
  requestId: string;
  taskId: string;
}

export type ResearchTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ResearchTaskSummary {
  id: string;
  status: ResearchTaskStatus;
  requestText: string;
  createdAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  sourceCount: number;
  findingCount: number;
}

export interface ResearchTaskDetail extends ResearchTaskSummary {
  result: unknown | null;
}

export interface ResearchHistoryPage {
  items: ResearchTaskSummary[];
  limit: number;
  offset: number;
  hasMore: boolean;
}
