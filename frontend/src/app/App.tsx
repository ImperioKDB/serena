import { useEffect, useState, type ReactElement } from 'react';
import type { Session } from '@supabase/supabase-js';

import { getDefaultApiUrl, SerenaApiError, submitResearch } from './api';
import { getSupabaseClient } from './supabase';
import type { ResearchResult } from './types';
import { ResearchComposer, type ResearchComposerValues } from '../components/ResearchComposer';
import { ResearchResult as ResearchResultView } from '../components/ResearchResult';

export function App(): ReactElement {
  const apiUrl = getDefaultApiUrl();
  const supabase = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setAuthError('Could not restore your sign-in session. Sign in again.');
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  async function signInWithGoogle(): Promise<void> {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError(null);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (signInError) {
      setAuthError('Google sign-in could not start. Check the Supabase Google provider settings.');
      setAuthBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    if (!supabase) return;
    setAuthBusy(true);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setAuthError('Sign-out failed. Please try again.');
    setResult(null);
    setLastRequest(null);
    setAuthBusy(false);
  }

  async function handleSubmit(values: ResearchComposerValues): Promise<void> {
    if (!session?.access_token) {
      setError('Your sign-in session expired. Sign in again to continue.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    setLastRequest(values.request);

    try {
      const response = await submitResearch({
        apiUrl,
        ...values,
        accessToken: session.access_token,
      });
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
        <div className="topbar__actions">
          <div className="topbar__status">
            <span className="status-dot" /> Evidence-first research
          </div>
          {session ? (
            <button
              className="secondary-button topbar__signout"
              type="button"
              onClick={signOut}
              disabled={authBusy}
            >
              Sign out
            </button>
          ) : null}
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

        {authLoading ? (
          <section className="loading-panel" aria-live="polite">
            Checking your sign-in session…
          </section>
        ) : !supabase ? (
          <section className="composer-card auth-card" role="status">
            <p className="eyebrow">Sign-in setup required</p>
            <h2>Serena authentication is not configured.</h2>
            <p>
              Set the public Supabase project URL and publishable key in the frontend deployment.
            </p>
          </section>
        ) : !session ? (
          <section className="composer-card auth-card">
            <p className="eyebrow">Private access</p>
            <h2>Sign in to Serena</h2>
            <p>Use your Google account. Serena keeps the sign-in session in this browser tab.</p>
            {authError ? (
              <p className="form-error" role="alert">
                {authError}
              </p>
            ) : null}
            <button
              className="primary-button auth-card__button"
              type="button"
              onClick={signInWithGoogle}
              disabled={authBusy}
            >
              {authBusy ? 'Opening Google…' : 'Continue with Google'}
            </button>
          </section>
        ) : (
          <>
            <p className="signed-in-note">Signed in as {session.user.email ?? 'Google account'}</p>
            <ResearchComposer
              apiUrl={apiUrl}
              disabled={isSubmitting || authBusy}
              onSubmit={handleSubmit}
            />
          </>
        )}

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
