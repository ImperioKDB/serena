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
  const unreadableSourceCount = coverage.unreadableSourceCount ?? 0;

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

      {result.discovery ? (
        <p className="discovery-note" role="status">
          Web search found {result.discovery.candidateCount} candidate pages; Serena attempted to
          read {result.discovery.attemptedCount} of them. Only readable page content is used as
          evidence.
        </p>
      ) : null}

      {coverage.status === 'incomplete' ? (
        <div className="coverage-notice" role="status">
          <strong>Research incomplete</strong>
          {blockedSourceCount > 0 ? (
            <span>
              {blockedSourceCount} of {result.sources.length} source pages required a security
              verification. Serena excluded their text from evidence and AI extraction, so this run
              cannot establish whether matching opportunities exist. Review those sites yourself or
              try accessible sources; Serena will not bypass the security checks.
            </span>
          ) : unreadableSourceCount > 0 ? (
            <span>
              {unreadableSourceCount} discovered page{unreadableSourceCount === 1 ? '' : 's'} did
              not respond or denied access. Serena skipped them and did not attempt to bypass any
              checks. The remaining readable pages may not represent the full set of opportunities.
            </span>
          ) : (
            <span>
              Serena could not find a usable page for this run. This does not establish that no
              matching opportunities exist; try a more specific question or provide known public
              URLs.
            </span>
          )}
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
