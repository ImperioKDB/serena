import { useState, type FormEvent, type ReactElement } from 'react';

export interface ResearchComposerValues {
  request: string;
  sources: string[];
  sourceMode: 'provided' | 'discover';
}

export function ResearchComposer({
  disabled,
  isSubmitting,
  onSubmit,
}: {
  disabled: boolean;
  isSubmitting: boolean;
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
    if (sourceMode === 'provided' && sources.length > 5) {
      setError('Provide no more than five source URLs.');
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
    <form
      className="composer-card"
      onSubmit={submit}
      aria-busy={isSubmitting}
      aria-labelledby="research-heading"
    >
      <label className="field">
        <span>Research question</span>
        <textarea
          id="research-question"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Find current scholarships for Nigerian undergraduates."
          rows={3}
          maxLength={2000}
          disabled={disabled}
          aria-invalid={Boolean(error && !request.trim())}
        />
        <small>{request.length}/2000 characters</small>
      </label>

      <fieldset className="source-mode" disabled={disabled}>
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
            rows={3}
            disabled={disabled}
            aria-invalid={Boolean(error && sourceMode === 'provided')}
          />
          <small>One HTTPS URL per line, up to five sources.</small>
        </label>
      ) : null}

      {error ? (
        <p className="form-error" id="research-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="composer-card__footer">
        <button
          className="primary-button"
          type="submit"
          disabled={disabled}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? 'Researching…' : 'Run research'}
        </button>
      </div>
    </form>
  );
}
