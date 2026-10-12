import { useState, type ReactElement } from 'react';

import { getDefaultApiUrl, SerenaApiError, submitResearch } from './api';
import type { ResearchResult } from './types';
import { ResearchComposer, type ResearchComposerValues } from '../components/ResearchComposer';
import { ResearchResult as ResearchResultView } from '../components/ResearchResult';

export function App(): ReactElement {
  const apiUrl = getDefaultApiUrl();
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<string | null>(null);

  async function handleSubmit(values: ResearchComposerValues): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    setLastRequest(values.request);

    try {
      const response = await submitResearch({ apiUrl, ...values });
      setResult(response.data);
    } catch (submissionError) {
      setError(
        submissionError instanceof SerenaApiError
          ? submissionError.message
          : 'Serena could not complete the request. Check your connection and try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Serena home">
          <span className="wordmark__mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Serena</span>
        </a>
        <div className="topbar__status">
          <span className="status-dot" /> Evidence-first research
        </div>
      </header>

      <main className="research-rail">
        <section className="hero-copy">
          <p className="eyebrow">Personal intelligence layer</p>
          <h1>Turn public sources into findings you can trace.</h1>
          <p className="hero-copy__body">
            Serena reads the sources you provide, preserves the excerpts it used, and keeps
            uncertainty visible.
          </p>
        </section>

        <ResearchComposer apiUrl={apiUrl} disabled={isSubmitting} onSubmit={handleSubmit} />

        {isSubmitting ? (
          <section className="loading-panel" aria-live="polite">
            <div className="loading-orbit" aria-hidden="true">
              <span />
            </div>
            <div>
              <strong>Reading your sources…</strong>
              <span>Serena is collecting evidence before making a finding.</span>
            </div>
          </section>
        ) : null}

        {error ? (
          <section className="error-panel" role="alert">
            <div>
              <strong>Research did not complete.</strong>
              <span>{error}</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </section>
        ) : null}

        {result ? (
          <>
            <div className="request-summary">
              <span>Last request</span>
              <strong>{lastRequest}</strong>
            </div>
            <ResearchResultView result={result} />
          </>
        ) : null}
      </main>

      <footer className="site-footer">
        <span>Serena keeps every finding connected to evidence.</span>
        <span>Private prototype</span>
      </footer>
    </div>
  );
}
