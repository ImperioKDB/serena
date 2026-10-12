import { describe, expect, it } from 'vitest';

import { assertProductionApiKey, assertProductionDatabaseUrl } from '../src/core/runtime-config.js';

describe('production runtime configuration', () => {
  it('allows missing credentials and storage for non-production development', () => {
    expect(() => assertProductionApiKey(undefined, 'development')).not.toThrow();
    expect(() => assertProductionApiKey(undefined, 'test')).not.toThrow();
    expect(() => assertProductionDatabaseUrl(undefined, 'development')).not.toThrow();
    expect(() => assertProductionDatabaseUrl(undefined, 'test')).not.toThrow();
  });

  it('requires a non-empty bearer key in production', () => {
    expect(() => assertProductionApiKey(undefined, 'production')).toThrowError(
      'SERENA_API_KEY must be configured before starting Serena in production.',
    );
    expect(() => assertProductionApiKey('  ', 'production')).toThrowError(
      'SERENA_API_KEY must be configured before starting Serena in production.',
    );
    expect(() => assertProductionApiKey('configured-key', 'production')).not.toThrow();
  });

  it('requires a PostgreSQL connection string for shared production admission state', () => {
    expect(() => assertProductionDatabaseUrl(undefined, 'production')).toThrowError(
      'DATABASE_URL must be configured for shared request admission in production.',
    );
    expect(() => assertProductionDatabaseUrl('https://example.test', 'production')).toThrowError(
      'DATABASE_URL must be configured for shared request admission in production.',
    );
    expect(() =>
      assertProductionDatabaseUrl('postgresql://user:secret@db.test/db', 'production'),
    ).not.toThrow();
  });
});
