export function assertProductionApiKey(
  apiKey: string | undefined,
  nodeEnvironment = process.env.NODE_ENV,
): void {
  if (nodeEnvironment === 'production' && !apiKey?.trim()) {
    throw new Error('SERENA_API_KEY must be configured before starting Serena in production.');
  }
}
