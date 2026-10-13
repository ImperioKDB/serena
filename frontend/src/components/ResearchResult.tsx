import type { ReactElement } from 'react';

import type { ResearchResult as ResearchResultData } from '../app/types';
import { FindingCard } from './FindingCard';
import { SourceCard } from './SourceCard';

export function ResearchResult({ result }: { result: ResearchResultData }): ReactElement {
  const coverage = result.coverage ?? {
    status: 'complete' as const,
    securityChallengeSourceCount: 0,
  };
  const blockedSourceCount = coverage.securityChallengeSourceCount;

  return (
    <section className="results-stack" aria-label="Research results">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Research result</p>
          <h2>
            {result.findings.length} finding{result.findings.length === 1 ? '' : 's'} to review
          </h2>
        </div>
        <span className="result-count">{result.sources.length} sources</span>
      </div>

      {coverage.status === 'incomplete' ? (
        <div className="coverage-notice" role="status">
          <strong>Research incomplete</strong>
          <span>
            {blockedSourceCount} of {result.sources.length} source pages required a security
            verification. Serena excluded their text from evidence and AI extraction, so this run
            cannot establish whether matching opportunities exist. Review those sites yourself or
            try accessible sources; Serena will not bypass the security checks.
          </span>
        </div>
      ) : null}

      {result.findings.length > 0 ? (
        <div className="finding-list">
          {result.findings.map((finding, index) => (
            <FindingCard
              key={`${finding.claim}-${index}`}
              finding={finding}
              evidence={result.evidence}
              sources={result.sources}
            />
          ))}
        </div>
      ) : (
        <div className="empty-panel">
          <strong>
            {coverage.status === 'incomplete'
              ? 'No findings were produced from this incomplete run.'
              : 'No cross-source findings were produced.'}
          </strong>
          <span>
            {coverage.status === 'incomplete'
              ? 'This does not mean that no suitable opportunities exist; some source pages could not be read.'
              : 'Review the evidence below and consider refining the research request.'}
          </span>
        </div>
      )}

      <div className="subsection-heading">
        <p className="eyebrow">Retrieved material</p>
        <h2>Sources and quality signals</h2>
      </div>
      <div className="source-list">
        {result.sources.map((source) => (
          <SourceCard key={source.id} source={source} />
        ))}
      </div>
    </section>
  );
}
