import { z } from 'zod';

export interface AuthenticatedUser {
  id: string;
}

export type AuthVerifier = (accessToken: string) => Promise<AuthenticatedUser | null>;

const userResponseSchema = z.object({ id: z.string().uuid() });

/** Validate the access token with Supabase Auth; never trust a browser-supplied user ID. */
export function createSupabaseAuthVerifier(
  supabaseUrl: string,
  publishableKey: string,
  fetchImplementation: typeof fetch = fetch,
): AuthVerifier {
  const baseUrl = new URL(supabaseUrl);
  if (baseUrl.protocol !== 'https:' || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS project origin.');
  }

  return async (accessToken: string): Promise<AuthenticatedUser | null> => {
    const response = await fetchImplementation(new URL('/auth/v1/user', baseUrl), {
      method: 'GET',
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) {
      throw new Error(`Supabase Auth user verification failed with HTTP ${response.status}.`);
    }
    const parsed = userResponseSchema.safeParse(await response.json());
    return parsed.success ? { id: parsed.data.id } : null;
  };
}
