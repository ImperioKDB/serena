import { createHash } from 'node:crypto';

import type { BrowserReadResult } from '../core/result.js';

export type SourceKind =
  'government' | 'education' | 'organization-domain' | 'commercial' | 'unknown';

export interface SourceQualityMetadata {
  domain: string;
  kind: SourceKind;
  accessStatus: 'readable' | 'security-challenge';
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

function hasSecurityChallenge(title: string, text: string): boolean {
  const content = `${title}\n${text}`;
  const strongChallengeIndicators = [
    /\bperforming security verification\b/iu,
    /\bthis page is displayed while the website verifies you are not a bot\b/iu,
    /\bverify (?:that )?you are (?:a )?human\b/iu,
    /\bchecking your browser before accessing\b/iu,
    /\bcomplete the (?:security|captcha) challenge\b/iu,
    /\benable javascript and cookies to continue\b/iu,
    /\bcf-chl-|challenge-platform/iu,
  ];

  return strongChallengeIndicators.some((indicator) => indicator.test(content));
}

export function assessSourceQuality(
  source: BrowserReadResult,
  sourceId: string,
  previous: Array<{ id: string; hash: string }>,
): SourceQualityMetadata {
  const url = new URL(source.finalUrl);
  const domain = normalizeHostname(url.hostname);
  const classification = classifyKind(domain);
  const accessStatus = hasSecurityChallenge(source.title, source.text)
    ? 'security-challenge'
    : 'readable';
  const hash = contentHash(source.text);
  const duplicate = previous.find((item) => item.hash === hash);

  return {
    domain,
    kind: classification.kind,
    accessStatus,
    signals: [
      ...(classification.signal === undefined ? [] : [classification.signal]),
      ...(accessStatus === 'security-challenge' ? ['security-challenge'] : []),
    ],
    contentHash: hash,
    ...(duplicate === undefined ? {} : { duplicateOfSourceId: duplicate.id }),
    assessment: 'domain-signals-only',
  };
}
