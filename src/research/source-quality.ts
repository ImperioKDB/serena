import { createHash } from 'node:crypto';

import type { BrowserReadResult } from '../core/result.js';

export type SourceKind =
  'government' | 'education' | 'organization-domain' | 'commercial' | 'unknown';

export interface SourceQualityMetadata {
  domain: string;
  kind: SourceKind;
  signals: string[];
  contentHash: string;
  duplicateOfSourceId?: string;
  assessment: 'domain-signals-only';
}

function normalizeHostname(hostname: string): string {
  return hostname.toLocaleLowerCase().replace(/^www\./u, '');
}

function domainMatches(hostname: string, pattern: RegExp): boolean {
  return pattern.test(hostname) || pattern.test(hostname.split('.').slice(-2).join('.'));
}

function classifyKind(hostname: string): { kind: SourceKind; signal?: string } {
  if (domainMatches(hostname, /(?:^|\.)gov(?:\.|$)/u)) {
    return { kind: 'government', signal: 'government-domain' };
  }
  if (domainMatches(hostname, /(?:^|\.)edu(?:\.|$)|(?:^|\.)ac\.[a-z]{2}$/u)) {
    return { kind: 'education', signal: 'education-domain' };
  }
  if (hostname.endsWith('.org')) {
    return { kind: 'organization-domain', signal: 'organization-domain' };
  }
  if (hostname.endsWith('.com')) {
    return { kind: 'commercial', signal: 'commercial-domain' };
  }
  return { kind: 'unknown' };
}

function contentHash(text: string): string {
  return createHash('sha256')
    .update(text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase())
    .digest('hex');
}

export function assessSourceQuality(
  source: BrowserReadResult,
  sourceId: string,
  previous: Array<{ id: string; hash: string }>,
): SourceQualityMetadata {
  const url = new URL(source.finalUrl);
  const domain = normalizeHostname(url.hostname);
  const classification = classifyKind(domain);
  const hash = contentHash(source.text);
  const duplicate = previous.find((item) => item.hash === hash);

  return {
    domain,
    kind: classification.kind,
    signals: classification.signal === undefined ? [] : [classification.signal],
    contentHash: hash,
    ...(duplicate === undefined ? {} : { duplicateOfSourceId: duplicate.id }),
    assessment: 'domain-signals-only',
  };
}
