import type { ReactElement } from 'react';

import type { ResearchSource } from '../app/types';

interface SourceAssessment {
  relevanceScore: number;
  contentType: 'article' | 'listing' | 'program-page' | 'directory' | 'other';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function SourceCard({
  source,
  assessment,
}: {
  source: ResearchSource;
  assessment?: SourceAssessment;
}): ReactElement {
  const blocked = source.quality.accessStatus === 'security-challenge';
  const unavailable = source.quality.accessStatus === 'unavailable';

  return (
    <article className="source-card">
      <div className="source-card__heading">
        <div>
          <p className="eyebrow">Source {source.id.slice(0, 8)}</p>
          <h3>{source.title || 'Untitled source'}</h3>
        </div>
        {blocked ? (
          <span className="signal-chip signal-chip--warning">Security check · excluded</span>
        ) : unavailable ? (
          <span className="signal-chip signal-chip--warning">Unavailable page · excluded</span>
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
        {source.extraction ? (
          <span>
            {source.extraction.wordCount.toLocaleString()} extracted words ·{' '}
            {source.extraction.method === 'mozilla-readability'
              ? 'article extraction'
              : 'semantic extraction'}
          </span>
        ) : null}
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
        {source.quality.relevanceScore !== undefined ? (
          <span className="signal-chip">Query signal {source.quality.relevanceScore}/100</span>
        ) : null}
        {source.quality.qualityScore !== undefined ? (
          <span className="signal-chip">Content signal {source.quality.qualityScore}/100</span>
        ) : null}
      </div>
      {assessment ? (
        <p className="source-card__assessment">
          AI page-type assessment: {assessment.contentType}; relevance signal{' '}
          {assessment.relevanceScore}/100. This is a triage signal, not source verification.
        </p>
      ) : null}
      <p className="source-card__note">
        {blocked
          ? 'This page required a security verification. Serena excluded its text from evidence and did not bypass the check.'
          : unavailable
            ? 'This page returned an unsupported-browser error. Serena excluded its text from evidence.'
            : 'Domain, extraction and relevance signals are not proof that this source is accurate.'}
      </p>
    </article>
  );
}
