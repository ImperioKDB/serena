export function assertProductionDatabaseUrl(
  databaseUrl: string | undefined,
  nodeEnvironment = process.env.NODE_ENV,
): void {
  if (
    nodeEnvironment === 'production' &&
    (!databaseUrl?.trim() || !/^postgres(?:ql)?:\/\//iu.test(databaseUrl.trim()))
  ) {
    throw new Error('DATABASE_URL must be configured for shared request admission in production.');
  }
}

export function assertProductionSupabaseAuth(
  supabaseUrl: string | undefined,
  publishableKey: string | undefined,
  nodeEnvironment = process.env.NODE_ENV,
): void {
  if (nodeEnvironment !== 'production') return;
  if (!supabaseUrl?.trim() || !publishableKey?.trim()) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured for production authentication.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS Supabase project origin.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('SUPABASE_URL must be a valid HTTPS Supabase project origin.');
  }
}
