import { describe, expect, it } from 'vitest';

import type { BrowserReadResult } from '../src/core/result.js';
import { assessSourceQuality } from '../src/research/source-quality.js';

function page(finalUrl: string, text: string): BrowserReadResult {
  return {
    url: finalUrl,
    finalUrl,
    title: 'Test page',
    text,
    retrievedAt: '2026-10-12T00:00:00.000Z',
    durationMs: 10,
  };
}

describe('source quality assessment', () => {
  it('reports domain signals without treating them as proof of authority', () => {
    const result = assessSourceQuality(
      page('https://research.gov.ng/a', 'Official text'),
      'one',
      [],
    );

    expect(result.domain).toBe('research.gov.ng');
    expect(result.kind).toBe('government');
    expect(result.signals).toContain('government-domain');
    expect(result.assessment).toBe('domain-signals-only');
  });

  it('does not classify an unfamiliar domain as authoritative', () => {
    const result = assessSourceQuality(page('https://example.test/a', 'Some text'), 'one', []);

    expect(result.kind).toBe('unknown');
    expect(result.signals).toEqual([]);
  });

  it('detects exact duplicate page content', () => {
    const first = assessSourceQuality(page('https://one.example/a', 'Same   content'), 'one', []);
    const second = assessSourceQuality(page('https://two.example/b', 'same content'), 'two', [
      { id: 'one', hash: first.contentHash },
    ]);

    expect(second.duplicateOfSourceId).toBe('one');
  });
});
