import type { ReactElement } from 'react';

import type { CandidateOutcome, ResearchResult as ResearchResultData } from '../app/types';
import { FindingCard } from './FindingCard';
import { SourceCard } from './SourceCard';

function analysisMessage(
  status: NonNullable<ResearchResultData['modelAnalysis']>['status'],
): string {
  switch (status) {
    case 'completed':
      return 'AI analysis completed. Its outputs remain proposals grounded in saved evidence, not independent verification.';
    case 'deterministic-only':
      return 'No model provider was available. Serena used deterministic evidence checks only; matching claims can be missed.';
    case 'failed':
      return 'The configured model provider did not complete analysis. Any findings shown are based only on available evidence and must be reviewed.';
    case 'disabled':
      return 'AI analysis is disabled. No research text was sent to a model provider.';
    case 'skipped':
      return 'AI analysis was skipped because no evidence-eligible page content was available.';
  }
}

function failureMessage(
  kind: NonNullable<NonNullable<ResearchResultData['modelAnalysis']>['failure']>['kind'],
): string {
  switch (kind) {
    case 'rate_limited':
      return 'The model provider is rate limiting requests. Please try again shortly.';
    case 'upstream_unavailable':
      return 'The model provider is temporarily unavailable. The saved evidence is still available for review.';
    case 'timeout':
      return 'The model analysis exceeded its time budget. The saved evidence is still available for review.';
    case 'cancelled':
      return 'The model analysis was cancelled before it completed. The saved evidence is still available for review.';
    case 'model_unavailable':
      return 'The configured model is unavailable. Check the provider model configuration before retrying.';
    case 'authentication_failed':
      return 'The model provider rejected authentication. Check the server-side provider credentials before retrying.';
    case 'invalid_request':
      return 'The model provider rejected the request format. Check the model and structured-output configuration.';
    case 'invalid_response':
      return 'The model returned an invalid structured response. The saved evidence is still available for review.';
  }
}

function candidateStatusLabel(outcome: CandidateOutcome): string {
  switch (outcome.status) {
    case 'security-challenge':
      return 'security check · excluded';
    case 'read-failed':
      return outcome.errorCode ? `read failed · ${outcome.errorCode}` : 'read failed';
    case 'unavailable':
      return 'unavailable · excluded';
    case 'low-quality':
      return 'low information · excluded';
    case 'duplicate':
      return 'duplicate · excluded';
    case 'irrelevant':
      return 'low relevance';
    case 'rejected':
      return 'not selected';
    case 'selected':
      return 'selected';
    case 'readable':
      return 'readable';
  }
}

export function ResearchResult({ result }: { result: ResearchResultData }): ReactElement {
  const coverage = result.coverage ?? {
    status: 'complete' as const,
    securityChallengeSourceCount: 0,
  };
  const blockedSourceCount = coverage.securityChallengeSourceCount;
  const unreadableSourceCount = coverage.unreadableSourceCount ?? 0;
  const discovery = result.discovery;
  const analysis = result.modelAnalysis;
  const sourceAssessments = new Map(
    (analysis?.sourceAssessments ?? []).map((assessment) => [assessment.sourceId, assessment]),
  );

  return (
    <section className="results-stack" aria-label="Research results">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Research result</p>
          <h2>
            {result.findings.length} finding{result.findings.length === 1 ? '' : 's'} to review
          </h2>
        </div>
        <span className="result-count">
          {result.sources.length} source{result.sources.length === 1 ? '' : 's'} ·{' '}
          {result.evidence.length} evidence passage{result.evidence.length === 1 ? '' : 's'}
        </span>
      </div>

      {discovery ? (
        <>
          <p className="discovery-note" role="status">
            Search returned {discovery.candidateCount} candidate page
            {discovery.candidateCount === 1 ? '' : 's'}; Serena selected{' '}
            {discovery.selectedCount ?? discovery.attemptedCount} and attempted to read{' '}
            {discovery.attemptedCount}. This included{' '}
            {discovery.retrievalAttemptCount ?? discovery.attemptedCount} guarded page request
            {(discovery.retrievalAttemptCount ?? discovery.attemptedCount) === 1 ? '' : 's'}
            {discovery.retryCount
              ? ` (${discovery.retryCount} bounded timeout ${discovery.retryCount === 1 ? 'retry' : 'retries'})`
              : ''}
            . {discovery.usefulContentCount ?? coverage.evidenceSourceCount ?? 0} source page
            {(discovery.usefulContentCount ?? coverage.evidenceSourceCount ?? 0) === 1
              ? ''
              : 's'}{' '}
            provided evidence-eligible content. Search snippets identify candidate URLs only; they
            are not evidence.
          </p>
          {discovery.candidates && discovery.candidates.length > 0 ? (
            <details className="candidate-outcomes">
              <summary>Candidate processing ({discovery.candidates.length})</summary>
              <ol>
                {discovery.candidates.map((outcome) => (
                  <li key={`${outcome.rank}-${outcome.domain}-${outcome.status}`}>
                    <span className="candidate-outcome__domain">
                      {outcome.rank}. {outcome.domain}
                    </span>
                    <span className="candidate-outcome__status">
                      {candidateStatusLabel(outcome)}
                    </span>
                    <span className="candidate-outcome__scores">
                      relevance {outcome.relevanceScore}/100 · rank score {outcome.score}/100
                    </span>
                    {outcome.reason ? <span>{outcome.reason}</span> : null}
                    {outcome.responseSizeLimitScope ? (
                      <span>Size limit: {outcome.responseSizeLimitScope}-level</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      ) : null}

      {analysis ? (
        <div className={`analysis-status analysis-status--${analysis.status}`} role="status">
          <strong>Analysis: {analysis.status.replaceAll('-', ' ')}</strong>
          <span>{analysisMessage(analysis.status)}</span>
          {analysis.provider || analysis.model ? (
            <small>
              {analysis.provider ?? 'Provider'}
              {analysis.model ? ` · ${analysis.model}` : ''}
              {analysis.requestCount !== undefined
                ? ` · ${analysis.requestCount} model operation${analysis.requestCount === 1 ? '' : 's'}`
                : ''}
              {analysis.inputTokens !== undefined || analysis.outputTokens !== undefined
                ? ` · ${analysis.inputTokens ?? 0} input / ${analysis.outputTokens ?? 0} output tokens`
                : ''}
            </small>
          ) : null}
          {analysis.failure ? (
            <div className="analysis-failure" role="alert">
              <strong>Why analysis did not complete</strong>
              <span>{failureMessage(analysis.failure.kind)}</span>
              <small>
                {analysis.failure.provider} · {analysis.failure.operation.replaceAll('_', ' ')}
                {analysis.failure.statusCode !== undefined
                  ? ` · HTTP ${analysis.failure.statusCode}`
                  : ''}
                {analysis.failure.attemptCount !== undefined
                  ? ` · ${analysis.failure.attemptCount} attempt${analysis.failure.attemptCount === 1 ? '' : 's'}`
                  : ''}
                {analysis.failure.durationMs !== undefined
                  ? ` · ${analysis.failure.durationMs} ms`
                  : ''}
              </small>
            </div>
          ) : null}
          {analysis.potentialContradictions.length > 0 ? (
            <div>
              <strong>Potential conflicts to review</strong>
              <ul>
                {analysis.potentialContradictions.map((conflict, index) => (
                  <li key={`${conflict.evidenceIds.join('-')}-${index}`}>
                    {conflict.summary} (evidence: {conflict.evidenceIds.join(', ')})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {analysis.missingEvidence.length > 0 ? (
            <div>
              <strong>Evidence gaps noted</strong>
              <ul>
                {analysis.missingEvidence.map((gap, index) => (
                  <li key={`${index}-${gap}`}>{gap}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {coverage.status === 'incomplete' ? (
        <div className="coverage-notice" role="status">
          <strong>Research incomplete</strong>
          {blockedSourceCount > 0 ||
          unreadableSourceCount > 0 ||
          (coverage.lowQualitySourceCount ?? 0) > 0 ? (
            <span>
              {blockedSourceCount > 0 ? (
                <>
                  {blockedSourceCount} source page{blockedSourceCount === 1 ? '' : 's'} required a
                  security verification; Serena excluded their text from evidence.{' '}
                </>
              ) : null}
              {unreadableSourceCount > 0 ? (
                <>
                  {unreadableSourceCount} discovered page{unreadableSourceCount === 1 ? '' : 's'}{' '}
                  could not be read or returned an error page; Serena excluded them from
                  evidence.{' '}
                </>
              ) : null}
              {(coverage.lowQualitySourceCount ?? 0) > 0 ? (
                <>
                  {coverage.lowQualitySourceCount} page
                  {coverage.lowQualitySourceCount === 1 ? '' : 's'} were readable but lacked enough
                  usable content for evidence.{' '}
                </>
              ) : null}
              {result.findings.length > 0
                ? ' Any findings below are provisional and grounded only in evidence from pages Serena could read. This run cannot establish full coverage; Serena will not bypass security checks.'
                : ' This incomplete run cannot establish whether matching opportunities exist. Review excluded sites yourself or try accessible sources; Serena will not bypass security checks.'}
            </span>
          ) : (
            <span>
              Serena could not find enough usable page content for this run. This does not establish
              that no matching opportunities exist; try a more specific question or provide known
              public URLs.
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
              : 'No claim met the current evidence criteria.'}
          </strong>
          <span>
            {coverage.status === 'incomplete'
              ? 'This does not mean that no suitable opportunities exist; some source pages could not be read or did not yield enough evidence.'
              : result.evidence.length > 0
                ? 'Review the saved passages above or below. With no model provider enabled, Serena uses deterministic cross-source checks, which can miss paraphrased claims.'
                : 'No evidence passages were saved. Review the candidate outcomes and analysis status before drawing conclusions.'}
          </span>
        </div>
      )}

      <div className="subsection-heading">
        <p className="eyebrow">Retrieved material</p>
        <h2>Sources and quality signals</h2>
      </div>
      <div className="source-list">
        {result.sources.length > 0 ? (
          result.sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              assessment={sourceAssessments.get(source.id)}
            />
          ))
        ) : (
          <div className="empty-panel">
            <strong>No readable sources were saved for this run.</strong>
            <span>
              Review the coverage notice and candidate outcomes before drawing conclusions.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
