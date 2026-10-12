import { describe, expect, it, vi } from 'vitest';

import { createSupabaseAuthVerifier } from '../src/api/supabase-auth.js';

const validUserId = '6bffb79d-9f1d-41aa-91b9-75edb31ae70f';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Supabase Auth verifier', () => {
  it('sends the bearer token to Supabase Auth and returns its verified UUID', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://serena.supabase.co/auth/v1/user');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer user-access-token');
      expect(new Headers(init?.headers).get('apikey')).toBe('sb_publishable_test');
      return jsonResponse({ id: validUserId, email: 'user@example.test' });
    });
    const verifier = createSupabaseAuthVerifier(
      'https://serena.supabase.co',
      'sb_publishable_test',
      fetchMock,
    );

    await expect(verifier('user-access-token')).resolves.toEqual({ id: validUserId });
  });

  it('returns null for expired or malformed user sessions', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'Invalid JWT' }, 401))
      .mockResolvedValueOnce(jsonResponse({ id: 'not-a-uuid' }));
    const verifier = createSupabaseAuthVerifier(
      'https://serena.supabase.co',
      'sb_publishable_test',
      fetchMock,
    );

    await expect(verifier('expired-token')).resolves.toBeNull();
    await expect(verifier('malformed-user-token')).resolves.toBeNull();
  });

  it('surfaces provider errors so the API can fail closed', async () => {
    const verifier = createSupabaseAuthVerifier(
      'https://serena.supabase.co',
      'sb_publishable_test',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'Unavailable' }, 503)),
    );

    await expect(verifier('user-access-token')).rejects.toThrow(
      'Supabase Auth user verification failed with HTTP 503.',
    );
  });

  it('rejects non-HTTPS or non-origin Supabase URLs', () => {
    expect(() => createSupabaseAuthVerifier('http://serena.supabase.co', 'key')).toThrow(
      'SUPABASE_URL must be an HTTPS project origin.',
    );
    expect(() => createSupabaseAuthVerifier('https://serena.supabase.co/path', 'key')).toThrow(
      'SUPABASE_URL must be an HTTPS project origin.',
    );
  });
});
