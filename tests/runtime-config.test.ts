import { describe, expect, it } from 'vitest';

import { assertProductionApiKey } from '../src/core/runtime-config.js';

describe('production runtime configuration', () => {
  it('allows missing credentials for non-production development', () => {
    expect(() => assertProductionApiKey(undefined, 'development')).not.toThrow();
    expect(() => assertProductionApiKey(undefined, 'test')).not.toThrow();
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
});
