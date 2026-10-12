import type { ReactElement } from 'react';

import type { ResearchEvidence, ResearchSource } from '../app/types';
import { VerificationBadge } from './VerificationBadge';

export function EvidenceCard({
  evidence,
  source,
}: {
  evidence: ResearchEvidence;
  source?: ResearchSource;
}): ReactElement {
  return (
    <article className="evidence-card">
      <div className="evidence-card__topline">
        <span className="evidence-card__id">Evidence {evidence.id.slice(0, 8)}</span>
        <VerificationBadge status={evidence.verificationStatus} />
      </div>
      <blockquote>{evidence.excerpt}</blockquote>
      <p className="evidence-card__source">
        {source?.title || 'Source'} · {evidence.locator}
      </p>
    </article>
  );
}
