import { describe, expect, it } from 'vitest';

import type { BrowserReadResult } from '../src/core/result.js';
import { assessSourceQuality } from '../src/research/source-quality.js';

function page(finalUrl: string, text: string, title = 'Test page'): BrowserReadResult {
  return {
    url: finalUrl,
    finalUrl,
    title,
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
    expect(result.accessStatus).toBe('readable');
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

  it('recognizes the security verification interstitial shown in the user report', () => {
    const text =
      'Performing security verification. This website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot. Ray ID: a49f47792f3de006. Performance and Security by Cloudflare Privacy.';
    const result = assessSourceQuality(
      page('https://scholarshipair.com/scholarships', text, 'Performing security verification'),
      'blocked',
      [],
    );

    expect(result.accessStatus).toBe('security-challenge');
    expect(result.signals).toContain('security-challenge');
  });

  it('does not treat a normal article mentioning Cloudflare as a security challenge', () => {
    const result = assessSourceQuality(
      page(
        'https://example.com/article',
        'The article explains how Cloudflare protects websites from malicious traffic.',
      ),
      'article',
      [],
    );

    expect(result.accessStatus).toBe('readable');
    expect(result.signals).not.toContain('security-challenge');
  });
});
