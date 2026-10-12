import { describe, expect, it } from 'vitest';

import {
  assertProductionDatabaseUrl,
  assertProductionSupabaseAuth,
} from '../src/core/runtime-config.js';

describe('production runtime configuration', () => {
  it('allows missing credentials and storage for non-production development', () => {
    expect(() => assertProductionSupabaseAuth(undefined, undefined, 'development')).not.toThrow();
    expect(() => assertProductionSupabaseAuth(undefined, undefined, 'test')).not.toThrow();
    expect(() => assertProductionDatabaseUrl(undefined, 'development')).not.toThrow();
    expect(() => assertProductionDatabaseUrl(undefined, 'test')).not.toThrow();
  });

  it('requires a valid Supabase project URL and publishable key in production', () => {
    expect(() => assertProductionSupabaseAuth(undefined, undefined, 'production')).toThrowError(
      'SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured for production authentication.',
    );
    expect(() => assertProductionSupabaseAuth('http://supabase.test', 'key', 'production')).toThrow(
      'SUPABASE_URL must be a valid HTTPS Supabase project origin.',
    );
    expect(() =>
      assertProductionSupabaseAuth(
        'https://project.supabase.co',
        'sb_publishable_test',
        'production',
      ),
    ).not.toThrow();
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
