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
  const sourceUrl = evidence.originalUrl ?? source?.url;
  const finalUrl = evidence.finalUrl ?? source?.finalUrl;
  const title = evidence.articleTitle ?? source?.title ?? 'Source';

  return (
    <article className="evidence-card">
      <div className="evidence-card__topline">
        <span className="evidence-card__id">Evidence {evidence.id.slice(0, 8)}</span>
        <VerificationBadge status={evidence.verificationStatus} />
      </div>
      <blockquote>{evidence.excerpt}</blockquote>
      <div className="evidence-card__provenance">
        <strong>{title}</strong>
        {evidence.sectionHeading ? <span>Section: {evidence.sectionHeading}</span> : null}
        <span>{evidence.locator}</span>
        {evidence.startOffset !== undefined && evidence.endOffset !== undefined ? (
          <span>
            Characters {evidence.startOffset.toLocaleString()}–{evidence.endOffset.toLocaleString()}
          </span>
        ) : null}
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            Original page
          </a>
        ) : null}
        {finalUrl && finalUrl !== sourceUrl ? (
          <a href={finalUrl} target="_blank" rel="noreferrer">
            Resolved page
          </a>
        ) : null}
        {evidence.sourceDomain ? <span>Domain: {evidence.sourceDomain}</span> : null}
      </div>
    </article>
  );
}
