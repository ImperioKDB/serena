import type { ResearchEvidenceRecord } from './types.js';

export interface FindingCandidate {
  claim: string;
  status: 'supported';
  verificationMethod: 'exact-text-match';
  evidenceIds: string[];
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
}

function normalize(sentence: string): string {
  return sentence.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

export function extractCrossSourceFindings(evidence: ResearchEvidenceRecord[]): FindingCandidate[] {
  const matches = new Map<string, { claim: string; evidenceIds: Set<string> }>();

  for (const item of evidence) {
    for (const sentence of sentences(item.excerpt)) {
      const key = normalize(sentence);
      const match = matches.get(key) ?? { claim: sentence, evidenceIds: new Set<string>() };
      match.evidenceIds.add(item.id);
      matches.set(key, match);
    }
  }

  return [...matches.values()]
    .filter((match) => match.evidenceIds.size >= 2)
    .map((match) => ({
      claim: match.claim,
      status: 'supported' as const,
      verificationMethod: 'exact-text-match' as const,
      evidenceIds: [...match.evidenceIds],
    }))
    .slice(0, 20);
}
