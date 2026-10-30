import { useEffect, useState, type ReactElement } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getDefaultApiUrl, SerenaApiError, submitResearch } from './api';
import { formatOAuthCallbackError, readOAuthCallbackState } from './oauth-callback.js';
import { getSupabaseClient } from './supabase';
import type { ResearchResult } from './types';
import { ResearchComposer, type ResearchComposerValues } from '../components/ResearchComposer';
import { ResearchHistory } from '../components/ResearchHistory';
import { ResearchResultsScreen } from '../components/ResearchResultsScreen';

type Theme = 'light' | 'dark';
type ScreenName = 'Research' | 'Results' | 'History';
type NavigationName = 'Research' | 'History';
const sections: { name: NavigationName; icon: string }[] = [
  { name: 'Research', icon: '⌕' },
  { name: 'History', icon: '◷' },
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
  const [activeScreen, setActiveScreen] = useState<ScreenName>('Research');
  const [composerInstance, setComposerInstance] = useState(0);
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
    setActiveScreen('Research');
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
    setActiveScreen('Results');
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
    const isActive =
      (activeScreen === 'History' && section.name === 'History') ||
      (activeScreen !== 'History' && section.name === 'Research');
    return (
      <button
        className={`${mobile ? 'mobile-nav__item' : 'nav-item'}${isActive ? (mobile ? ' mobile-nav__item--active' : ' nav-item--active') : ''}`}
        type="button"
        key={section.name}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => setActiveScreen(section.name)}
      >
        <span className={mobile ? undefined : 'nav-item__icon'} aria-hidden="true">
          {section.icon}
        </span>
        {section.name}
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
              aria-pressed={theme === 'dark'}
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

        <main className="research-rail" id="main-content">
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
            <div className="screen-host">
              <section
                className="research-screen"
                aria-labelledby="research-heading"
                hidden={activeScreen !== 'Research'}
              >
                <header className="page-heading">
                  <p className="eyebrow">Research</p>
                  <h1 id="research-heading">Research a question.</h1>
                  <p>
                    Serena researches public sources, connects findings to evidence, and makes
                    uncertainty visible.
                  </p>
                </header>
                <ResearchComposer
                  key={composerInstance}
                  disabled={isSubmitting || authBusy}
                  isSubmitting={isSubmitting}
                  onSubmit={handleSubmit}
                />
                {isSubmitting ? (
                  <section className="loading-panel research-screen__loading" aria-live="polite">
                    <span className="loading-mark" aria-hidden="true" />
                    <div>
                      <strong>Research in progress</strong>
                      <span>Serena is reading accessible pages and preparing evidence.</span>
                    </div>
                  </section>
                ) : null}
              </section>

              {activeScreen === 'Results' ? (
                <ResearchResultsScreen
                  request={lastRequest ?? ''}
                  result={result}
                  isLoading={isSubmitting}
                  error={error}
                  onEditQuestion={() => setActiveScreen('Research')}
                  onNewResearch={() => {
                    setResult(null);
                    setError(null);
                    setLastRequest(null);
                    setComposerInstance((current) => current + 1);
                    setActiveScreen('Research');
                  }}
                />
              ) : null}

              {activeScreen === 'History' ? (
                <ResearchHistory
                  apiUrl={apiUrl}
                  accessToken={session.access_token}
                  refreshKey={historyRefreshKey}
                />
              ) : null}
            </div>
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
