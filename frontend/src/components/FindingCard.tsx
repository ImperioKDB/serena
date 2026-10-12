import type { ReactElement } from 'react';

import type { ResearchEvidence, ResearchFinding, ResearchSource } from '../app/types';
import { EvidenceCard } from './EvidenceCard';
import { VerificationBadge } from './VerificationBadge';

export function FindingCard({
  finding,
  evidence,
  sources,
}: {
  finding: ResearchFinding;
  evidence: ResearchEvidence[];
  sources: ResearchSource[];
}): ReactElement {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const sourceById = new Map(sources.map((item) => [item.id, item]));
  const status = finding.reviewRequired ? 'review-required' : finding.status;

  return (
    <article className="finding-card">
      <div className="finding-card__header">
        <VerificationBadge status={status} />
        <span className="finding-card__method">
          {finding.verificationMethod === 'exact-text-match'
            ? 'Deterministic check'
            : 'AI extraction'}
        </span>
      </div>
      <p className="finding-card__claim">{finding.claim}</p>
      {finding.uncertainty ? (
        <p className="finding-card__uncertainty">{finding.uncertainty}</p>
      ) : null}
      <div className="evidence-spine" aria-label="Evidence supporting this finding">
        {finding.evidenceIds.map((evidenceId) => {
          const item = evidenceById.get(evidenceId);
          const source = item ? sourceById.get(item.sourceId) : undefined;
          return item ? (
            <EvidenceCard key={evidenceId} evidence={item} source={source} />
          ) : (
            <p className="missing-evidence" key={evidenceId}>
              Evidence {evidenceId} is unavailable.
            </p>
          );
        })}
      </div>
    </article>
  );
}
