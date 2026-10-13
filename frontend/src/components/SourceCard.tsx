import type { ReactElement } from 'react';

import type { ResearchSource } from '../app/types';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function SourceCard({ source }: { source: ResearchSource }): ReactElement {
  const blocked = source.quality.accessStatus === 'security-challenge';

  return (
    <article className="source-card">
      <div className="source-card__heading">
        <div>
          <p className="eyebrow">Source {source.id.slice(0, 8)}</p>
          <h3>{source.title || 'Untitled source'}</h3>
        </div>
        {blocked ? (
          <span className="signal-chip signal-chip--warning">Security check · excluded</span>
        ) : source.quality.duplicateOfSourceId ? (
          <span className="signal-chip signal-chip--warning">Duplicate content</span>
        ) : null}
      </div>
      <a className="source-card__url" href={source.finalUrl} target="_blank" rel="noreferrer">
        {source.finalUrl}
      </a>
      <div className="source-card__meta">
        <span>{source.quality.domain}</span>
        <span>Retrieved {formatDate(source.retrievedAt)}</span>
      </div>
      <div className="source-card__signals" aria-label="Source quality signals">
        <span className="signal-chip">{source.quality.kind}</span>
        {source.quality.signals
          .filter((signal) => signal !== 'security-challenge')
          .map((signal) => (
            <span className="signal-chip" key={signal}>
              {signal}
            </span>
          ))}
      </div>
      <p className="source-card__note">
        {blocked
          ? 'This page required a security verification. Serena excluded its text from evidence and did not bypass the check.'
          : 'These are domain and content signals only. They are not proof that this source is accurate.'}
      </p>
    </article>
  );
}
