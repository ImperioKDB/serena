import type { BrowserReadResult } from '../core/result.js';
import type { SourceQualityMetadata } from './source-quality.js';

export type EvidenceVerificationStatus = 'unverified' | 'supported' | 'disputed';

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
  extractionMethod: 'visible-text-prefix';
  verificationStatus: EvidenceVerificationStatus;
}

export interface ResearchFinding {
  claim: string;
  status: 'proposed' | 'supported' | 'exact_match';
  verificationMethod: 'exact-text-match' | 'llm-evidence-grounded';
  uncertainty?: string;
  evidenceIds: string[];
  reviewRequired?: boolean;
}

export interface ResearchResult {
  request: string;
  discovery?: {
    provider: 'tavily';
    candidateCount: number;
    attemptedCount: number;
  };
  coverage: {
    status: 'complete' | 'incomplete';
    securityChallengeSourceCount: number;
    unreadableSourceCount: number;
  };
  sources: Array<{
    id: string;
    url: string;
    finalUrl: string;
    title: string;
    retrievedAt: string;
    quality: SourceQualityMetadata;
  }>;
  evidence: Array<{
    id: string;
    sourceId: string;
    excerpt: string;
    locator: string;
    verificationStatus: EvidenceVerificationStatus;
  }>;
  findings: ResearchFinding[];
}
