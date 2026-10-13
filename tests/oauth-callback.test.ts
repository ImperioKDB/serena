import { describe, expect, it } from 'vitest';

import {
  formatOAuthCallbackError,
  readOAuthCallbackState,
} from '../frontend/src/app/oauth-callback.js';

describe('OAuth callback diagnostics', () => {
  it('reads only the error details from query parameters', () => {
    const state = readOAuthCallbackState(
      '?error=access_denied&error_description=Google%20sign-in%20was%20cancelled',
      '',
    );

    expect(state).toEqual({
      hasAuthorizationCode: false,
      errorCode: 'access_denied',
      errorDescription: 'Google sign-in was cancelled',
    });
    expect(formatOAuthCallbackError(state)).toBe(
      'Google sign-in did not complete (access_denied). Google sign-in was cancelled',
    );
  });

  it('reads Supabase callback errors from the URL fragment', () => {
    const state = readOAuthCallbackState(
      '',
      '#error_code=redirect_to_not_allowed&error_description=Return%20URL%20not%20allowed',
    );

    expect(state.errorCode).toBe('redirect_to_not_allowed');
    expect(state.errorDescription).toBe('Return URL not allowed');
  });

  it('records the presence, but never returns, an authorization code', () => {
    const state = readOAuthCallbackState('?code=secret-auth-code', '');

    expect(state).toEqual({
      hasAuthorizationCode: true,
      errorCode: null,
      errorDescription: null,
    });
    expect(JSON.stringify(state)).not.toContain('secret-auth-code');
  });

  it('does not return access or refresh tokens from a hash fragment', () => {
    const state = readOAuthCallbackState(
      '',
      '#access_token=secret-access&refresh_token=secret-refresh&token_type=bearer',
    );

    expect(state).toEqual({
      hasAuthorizationCode: false,
      errorCode: null,
      errorDescription: null,
    });
    expect(JSON.stringify(state)).not.toContain('secret-');
  });

  it('bounds and strips control characters from provider error descriptions', () => {
    const description = `${'x'.repeat(250)}%0Ahidden`;
    const state = readOAuthCallbackState(`?error_description=${description}`, '');

    expect(state.errorDescription).toHaveLength(240);
    expect(state.errorDescription).not.toContain('\n');
  });

  it('returns no error when the callback has no error fields', () => {
    const state = readOAuthCallbackState('?code=temporary-code', '');

    expect(formatOAuthCallbackError(state)).toBeNull();
  });
});
