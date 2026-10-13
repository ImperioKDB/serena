import { useState, type FormEvent, type ReactElement } from 'react';

export interface ResearchComposerValues {
  request: string;
  sources: string[];
  sourceMode: 'provided' | 'discover';
}

export function ResearchComposer({
  apiUrl,
  disabled,
  onSubmit,
}: {
  apiUrl: string;
  disabled: boolean;
  onSubmit: (values: ResearchComposerValues) => void;
}): ReactElement {
  const [request, setRequest] = useState('');
  const [sourcesText, setSourcesText] = useState('');
  const [sourceMode, setSourceMode] = useState<'provided' | 'discover'>('discover');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const sources = sourcesText
      .split(/\r?\n|,/u)
      .map((value) => value.trim())
      .filter(Boolean);

    if (!request.trim()) {
      setError('Write a research question before submitting.');
      return;
    }
    if (sourceMode === 'provided' && sources.length === 0) {
      setError('Add at least one public HTTPS source URL.');
      return;
    }
    if (sourceMode === 'provided' && sources.some((source) => !/^https:\/\/\S+$/u.test(source))) {
      setError('Sources must use HTTPS URLs.');
      return;
    }
    setError(null);
    onSubmit({ request: request.trim(), sources, sourceMode });
  }

  return (
    <form className="composer-card" onSubmit={submit}>
      <div className="composer-card__intro">
        <p className="eyebrow">New investigation</p>
        <h2>What should Serena investigate?</h2>
        <p>
          Give Serena a focused question. Search automatically or provide public sources yourself.
        </p>
      </div>

      <label className="field">
        <span>Research question</span>
        <textarea
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Find current scholarships for Nigerian undergraduates."
          rows={4}
          maxLength={2000}
          disabled={disabled}
        />
        <small>{request.length}/2000 characters</small>
      </label>

      <fieldset className="source-mode">
        <legend>How should Serena find sources?</legend>
        <label>
          <input
            type="radio"
            name="sourceMode"
            checked={sourceMode === 'discover'}
            onChange={() => setSourceMode('discover')}
            disabled={disabled}
          />
          <span>Search automatically</span>
        </label>
        <label>
          <input
            type="radio"
            name="sourceMode"
            checked={sourceMode === 'provided'}
            onChange={() => setSourceMode('provided')}
            disabled={disabled}
          />
          <span>Use URLs I provide</span>
        </label>
        {sourceMode === 'discover' ? (
          <small>Serena searches the web, then checks up to five public pages it can read.</small>
        ) : null}
      </fieldset>

      {sourceMode === 'provided' ? (
        <label className="field">
          <span>Public source URLs</span>
          <textarea
            value={sourcesText}
            onChange={(event) => setSourcesText(event.target.value)}
            placeholder={'https://example.org/source-one\nhttps://example.org/source-two'}
            rows={4}
            disabled={disabled}
          />
          <small>One HTTPS URL per line, up to five sources.</small>
        </label>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="composer-card__footer">
        <span className="api-note">API: {apiUrl}</span>
        <button className="primary-button" type="submit" disabled={disabled}>
          {disabled ? 'Researching…' : 'Run research'}
        </button>
      </div>
    </form>
  );
}
