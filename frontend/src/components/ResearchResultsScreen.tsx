import type { ReactElement } from 'react';

import type { ResearchResult } from '../app/types';
import { ResearchResult as ResearchResultView } from './ResearchResult';

interface ResearchResultsScreenProps {
  request: string;
  result: ResearchResult | null;
  isLoading: boolean;
  error: string | null;
  onEditQuestion: () => void;
  onNewResearch: () => void;
}

export function ResearchResultsScreen({
  request,
  result,
  isLoading,
  error,
  onEditQuestion,
  onNewResearch,
}: ResearchResultsScreenProps): ReactElement {
  const status = isLoading
    ? 'Research in progress'
    : error
      ? 'Research did not complete'
      : result?.coverage?.status === 'incomplete'
        ? 'Incomplete coverage'
        : 'Research complete';

  return (
    <section className="results-screen" aria-labelledby="research-results-heading">
      <header className="results-screen__header">
        <div className="results-screen__title">
          <p className="eyebrow">Results</p>
          <h1 id="research-results-heading">{request || 'Research results'}</h1>
          <p className="results-screen__status" role="status">
            <span
              className={`results-screen__status-dot${error ? ' results-screen__status-dot--error' : result?.coverage?.status === 'incomplete' ? ' results-screen__status-dot--warning' : ''}`}
              aria-hidden="true"
            />
            {status}
          </p>
        </div>
        {!isLoading && !error ? (
          <button
            className="secondary-button results-screen__new"
            type="button"
            onClick={onNewResearch}
          >
            New research
          </button>
        ) : null}
      </header>

      {isLoading ? (
        <section
          className="loading-panel results-screen__state"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="loading-mark" aria-hidden="true" />
          <div>
            <strong>Research in progress</strong>
            <span>Serena is reading accessible pages and preparing evidence.</span>
          </div>
        </section>
      ) : error ? (
        <section className="error-panel results-screen__state" role="alert">
          <div>
            <strong>Research did not complete.</strong>
            <span>{error}</span>
          </div>
          <button className="secondary-button" type="button" onClick={onEditQuestion}>
            Edit question
          </button>
        </section>
      ) : result ? (
        <>
          <dl className="results-summary" aria-label="Research result summary">
            <div>
              <dt>Findings</dt>
              <dd>{result.findings.length}</dd>
            </div>
            <div>
              <dt>Evidence items</dt>
              <dd>{result.evidence.length}</dd>
            </div>
            <div>
              <dt>Sources</dt>
              <dd>{result.sources.length}</dd>
            </div>
          </dl>
          <ResearchResultView result={result} />
        </>
      ) : (
        <div className="empty-panel results-screen__state">
          <strong>No result is available.</strong>
          <span>Return to the research form to start an investigation.</span>
          <button className="secondary-button" type="button" onClick={onEditQuestion}>
            Back to Research
          </button>
        </div>
      )}
    </section>
  );
}
