export function assertProductionApiKey(
  apiKey: string | undefined,
  nodeEnvironment = process.env.NODE_ENV,
): void {
  if (nodeEnvironment === 'production' && !apiKey?.trim()) {
    throw new Error('SERENA_API_KEY must be configured before starting Serena in production.');
  }
}

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
