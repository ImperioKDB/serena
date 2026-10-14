export type FindingStatus = 'proposed' | 'supported' | 'disputed' | 'exact_match';

export interface SourceQuality {
  domain: string;
  kind: 'government' | 'education' | 'organization-domain' | 'commercial' | 'unknown';
  accessStatus?: 'readable' | 'security-challenge';
  signals: string[];
  contentHash: string;
  duplicateOfSourceId?: string;
  assessment: 'domain-signals-only';
}

export interface ResearchSource {
  id: string;
  url: string;
  finalUrl: string;
  title: string;
  retrievedAt: string;
  quality: SourceQuality;
}

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  excerpt: string;
  locator: string;
  verificationStatus: 'unverified' | 'supported' | 'disputed';
}

export interface ResearchFinding {
  claim: string;
  status: FindingStatus;
  verificationMethod: 'exact-text-match' | 'llm-evidence-grounded';
  uncertainty?: string;
  evidenceIds: string[];
  reviewRequired?: boolean;
}

export interface ResearchResult {
  request: string;
  discovery?: {
    provider: string;
    candidateCount: number;
    attemptedCount: number;
  };
  coverage?: {
    status: 'complete' | 'incomplete';
    securityChallengeSourceCount: number;
    unreadableSourceCount?: number;
  };
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  findings: ResearchFinding[];
}

export interface ResearchApiResponse {
  data: ResearchResult;
  requestId: string;
  taskId: string;
}
