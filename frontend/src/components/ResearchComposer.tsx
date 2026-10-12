import { useState, type FormEvent, type ReactElement } from 'react';

export interface ResearchComposerValues {
  request: string;
  sources: string[];
  apiKey: string;
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
  const [apiKey, setApiKey] = useState('');
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
    if (sources.length === 0) {
      setError('Add at least one public HTTPS source URL.');
      return;
    }
    if (sources.some((source) => !/^https:\/\//u.test(source))) {
      setError('Sources must use HTTPS URLs.');
      return;
    }
    if (!apiKey.trim()) {
      setError('Enter your Serena API key for this browser session. It is not saved.');
      return;
    }

    setError(null);
    onSubmit({ request: request.trim(), sources, apiKey: apiKey.trim() });
  }

  return (
    <form className="composer-card" onSubmit={submit}>
      <div className="composer-card__intro">
        <p className="eyebrow">New investigation</p>
        <h2>What should Serena investigate?</h2>
        <p>Give Serena a focused question and the public sources you want compared.</p>
      </div>

      <label className="field">
        <span>Research question</span>
        <textarea
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Compare the eligibility requirements in these scholarship sources."
          rows={4}
          maxLength={2000}
          disabled={disabled}
        />
        <small>{request.length}/2000 characters</small>
      </label>

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

      <label className="field field--compact">
        <span>Serena API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Used in memory for this session only"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
        />
        <small>Never stored in localStorage, source code, or the URL.</small>
      </label>

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
