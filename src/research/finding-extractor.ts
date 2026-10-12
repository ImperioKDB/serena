import type { ResearchEvidenceRecord, ResearchFinding } from './types.js';

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
}

function normalize(sentence: string): string {
  return sentence.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

export function extractCrossSourceFindings(
  evidence: ResearchEvidenceRecord[],
  excludedSourceIds: ReadonlySet<string> = new Set(),
): ResearchFinding[] {
  const matches = new Map<string, { claim: string; evidenceIds: Set<string> }>();

  for (const item of evidence) {
    if (excludedSourceIds.has(item.sourceId)) continue;
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
      status: 'exact_match' as const,
      verificationMethod: 'exact-text-match' as const,
      evidenceIds: [...match.evidenceIds],
    }))
    .slice(0, 20);
}
