import { useEffect, useState, type ReactElement } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getDefaultApiUrl, SerenaApiError, submitResearch } from './api';
import { formatOAuthCallbackError, readOAuthCallbackState } from './oauth-callback.js';
import { getSupabaseClient } from './supabase';
import type { ResearchResult } from './types';
import { ResearchComposer, type ResearchComposerValues } from '../components/ResearchComposer';
import { ResearchHistory } from '../components/ResearchHistory';
import { ResearchResult as ResearchResultView } from '../components/ResearchResult';

type Theme = 'light' | 'dark';
type SectionName = 'Research' | 'History' | 'Knowledge' | 'Memory' | 'Connections';
const sections: { name: SectionName; icon: string; available: boolean }[] = [
  { name: 'Research', icon: '⌕', available: true },
  { name: 'History', icon: '◷', available: true },
  { name: 'Knowledge', icon: '▤', available: false },
  { name: 'Memory', icon: '⌘', available: false },
  { name: 'Connections', icon: '↗', available: false },
];

export function App(): ReactElement {
  const [oauthCallbackState] = useState(() =>
    readOAuthCallbackState(window.location.search, window.location.hash),
  );
  const apiUrl = getDefaultApiUrl();
  const supabase = getSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(() =>
    formatOAuthCallbackError(oauthCallbackState),
  );
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [activeSection, setActiveSection] = useState<SectionName>('Research');
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      if (nextSession) setAuthError(null);
    });
    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;
        if (sessionError && !formatOAuthCallbackError(oauthCallbackState)) {
          setAuthError('Could not restore your sign-in session. Sign in again.');
        }
        setSession(data.session);
        setAuthLoading(false);
        if (oauthCallbackState.hasAuthorizationCode && !data.session && !sessionError) {
          setAuthError(
            'Google returned to Serena, but no sign-in session was established. Start again from https://serena-frontend.vercel.app in the same browser tab. If it repeats, check the Supabase allowed return URL and Google OAuth callback settings.',
          );
        }
      })
      .catch(() => {
        if (!active) return;
        if (!formatOAuthCallbackError(oauthCallbackState)) {
          setAuthError('Serena could not finish checking your sign-in session. Please try again.');
        }
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
    setActiveSection('Research');
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
      setHistoryRefreshKey((current) => current + 1);
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

  function renderNavigationItem(section: (typeof sections)[number], mobile = false): ReactElement {
    const isActive = activeSection === section.name;
    return (
      <button
        className={`${mobile ? 'mobile-nav__item' : 'nav-item'}${isActive ? (mobile ? ' mobile-nav__item--active' : ' nav-item--active') : ''}`}
        type="button"
        key={section.name}
        disabled={!section.available}
        aria-current={isActive ? 'page' : undefined}
        aria-label={section.available ? section.name : `${section.name}, planned and unavailable`}
        title={section.available ? section.name : `${section.name} is planned, not available yet`}
        onClick={() => {
          if (section.available) setActiveSection(section.name);
        }}
      >
        <span className={mobile ? undefined : 'nav-item__icon'} aria-hidden="true">
          {section.icon}
        </span>
        {mobile && section.name === 'Connections' ? 'Connect' : section.name}
        {!mobile && !section.available ? <span className="nav-item__soon">Planned</span> : null}
      </button>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="wordmark" href="/" aria-label="Serena home">
          <span className="wordmark__mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Serena</span>
        </a>
        <nav className="sidebar__nav">
          {sections.map((section) => renderNavigationItem(section))}
        </nav>
        <div className="sidebar__account">
          {session ? (
            <>
              <div className="account-label">
                <span className="account-avatar" aria-hidden="true">
                  {(session.user.email ?? 'S')[0]?.toUpperCase()}
                </span>
                <span className="account-label__text">
                  <strong>{session.user.email ?? 'Google account'}</strong>
                  <small>Signed in</small>
                </span>
              </div>
              <button
                className="secondary-button sidebar__signout"
                type="button"
                onClick={signOut}
                disabled={authBusy}
              >
                Sign out
              </button>
            </>
          ) : (
            <span className="account-label__text">
              <strong>Private workspace</strong>
              <small>Sign in to research</small>
            </span>
          )}
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <a className="wordmark wordmark--mobile" href="/" aria-label="Serena home">
            <span className="wordmark__mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>Serena</span>
          </a>
          <div className="topbar__actions">
            <span className="topbar__status">Evidence-first research</span>
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            >
              <span aria-hidden="true">{theme === 'light' ? '☾' : '☼'}</span>
            </button>
            {session ? (
              <>
                <span className="topbar__identity">{session.user.email ?? 'Signed in'}</span>
                <button
                  className="secondary-button topbar__signout"
                  type="button"
                  onClick={signOut}
                  disabled={authBusy}
                >
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </header>

        <nav className="mobile-nav" aria-label="Workspace sections">
          {sections.map((section) => renderNavigationItem(section, true))}
        </nav>

        <main className="research-rail">
          <section className="page-heading">
            <p className="eyebrow">{activeSection}</p>
            <h1>
              {activeSection === 'History'
                ? 'Return to your saved research.'
                : 'Investigate a question. Trace the evidence.'}
            </h1>
            <p>
              {activeSection === 'History'
                ? 'Review previous tasks, reopen their evidence, and remove records you no longer need.'
                : 'Research public sources, review what supports each finding, and keep uncertainty visible.'}
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
          ) : activeSection === 'History' ? (
            <ResearchHistory
              apiUrl={apiUrl}
              accessToken={session.access_token}
              refreshKey={historyRefreshKey}
            />
          ) : (
            <>
              <ResearchComposer disabled={isSubmitting || authBusy} onSubmit={handleSubmit} />
              {isSubmitting ? (
                <section className="loading-panel" aria-live="polite">
                  <span className="loading-mark" aria-hidden="true" />
                  <div>
                    <strong>Research in progress</strong>
                    <span>
                      Serena is reading accessible pages and preparing evidence. This can take a
                      little while.
                    </span>
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
                    <span>Research question</span>
                    <strong>{lastRequest}</strong>
                  </div>
                  <ResearchResultView result={result} />
                </>
              ) : null}
              {!result && !isSubmitting ? (
                <p className="research-guidance">
                  Findings are not always verified facts. Check the evidence, source context, and
                  review status before relying on them.
                </p>
              ) : null}
            </>
          )}
        </main>
        <footer className="site-footer">
          <span>Serena keeps findings connected to their evidence.</span>
          <span>Research workspace</span>
        </footer>
      </div>
    </div>
  );
}
