export interface OAuthCallbackState {
  hasAuthorizationCode: boolean;
  errorCode: string | null;
  errorDescription: string | null;
}

function firstParameterValue(
  parameterSets: URLSearchParams[],
  names: readonly string[],
): string | null {
  for (const params of parameterSets) {
    for (const name of names) {
      const value = params.get(name)?.trim();
      if (value) return value;
    }
  }
  return null;
}

function sanitizeErrorText(value: string | null): string | null {
  if (!value) return null;
  const withoutControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : character;
  }).join('');
  const sanitized = withoutControls.replace(/\s+/gu, ' ').trim();
  return sanitized ? sanitized.slice(0, 240) : null;
}

export function readOAuthCallbackState(search: string, hash: string): OAuthCallbackState {
  const queryParams = new URLSearchParams(search);
  const fragmentParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const parameterSets = [queryParams, fragmentParams];

  return {
    hasAuthorizationCode: parameterSets.some((params) => params.has('code')),
    errorCode: sanitizeErrorText(firstParameterValue(parameterSets, ['error_code', 'error'])),
    errorDescription: sanitizeErrorText(firstParameterValue(parameterSets, ['error_description'])),
  };
}

export function formatOAuthCallbackError(state: OAuthCallbackState): string | null {
  if (!state.errorCode && !state.errorDescription) return null;
  const code = state.errorCode ? ` (${state.errorCode})` : '';
  const description = state.errorDescription ? ` ${state.errorDescription}` : '';
  return `Google sign-in did not complete${code}.${description}`;
}
