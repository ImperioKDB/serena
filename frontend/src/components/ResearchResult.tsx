import type { ReactElement } from 'react';

import type { ResearchResult as ResearchResultData } from '../app/types';
import { FindingCard } from './FindingCard';
import { SourceCard } from './SourceCard';

export function ResearchResult({ result }: { result: ResearchResultData }): ReactElement {
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
          <strong>No cross-source findings were produced.</strong>
          <span>Review the evidence below and consider refining the research request.</span>
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
