import type { BrowserReadResult } from '../core/result.js';

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
  status: 'proposed' | 'supported';
  verificationMethod: 'exact-text-match' | 'llm-evidence-grounded';
  uncertainty?: string;
  evidenceIds: string[];
}

export interface ResearchResult {
  request: string;
  sources: Array<{
    id: string;
    url: string;
    finalUrl: string;
    title: string;
    retrievedAt: string;
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
