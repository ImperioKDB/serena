import { createHash } from 'node:crypto';

import type { BrowserReadResult } from '../core/result.js';

export type SourceKind =
  'government' | 'education' | 'organization-domain' | 'commercial' | 'unknown';

export interface SourceQualityMetadata {
  domain: string;
  kind: SourceKind;
  accessStatus: 'readable' | 'security-challenge' | 'unavailable';
  evidenceStatus: 'eligible' | 'excluded';
  qualityScore: number;
  relevanceScore: number;
  signals: string[];
  contentHash: string;
  exclusionReason?:
    | 'security-challenge'
    | 'unsupported-browser'
    | 'authentication-required'
    | 'consent-required'
    | 'http-error'
    | 'unsupported-content'
    | 'insufficient-content'
    | 'duplicate-content'
    | 'no-query-overlap';
  duplicateOfSourceId?: string;
  assessment: 'domain-and-content-signals-only';
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

const STOP_WORDS = new Set([
  'about', 'after', 'all', 'and', 'are', 'can', 'for', 'from', 'find', 'how', 'into', 'that',
  'the', 'their', 'this', 'what', 'when', 'where', 'which', 'with', 'would', 'your',
]);

function tokens(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter((token) => !STOP_WORDS.has(token));
}

export function calculateRelevanceScore(request: string, title: string, text: string): number {
  const queryTokens = [...new Set(tokens(request))];
  if (queryTokens.length === 0) return 50;
  const titleTokens = new Set(tokens(title));
  const contentTokens = new Set(tokens(text.slice(0, 20_000)));
  const weightedMatches = queryTokens.reduce(
    (total, token) => total + (titleTokens.has(token) ? 1.5 : contentTokens.has(token) ? 1 : 0),
    0,
  );
  return Math.min(100, Math.round((weightedMatches / (queryTokens.length * 1.5)) * 100));
}

function textSimilarity(left: string, right: string): number {
  const makeShingles = (value: string): Set<string> => {
    const words = tokens(value);
    const shingles = new Set<string>();
    for (let index = 0; index + 4 < words.length; index += 1) {
      shingles.add(words.slice(index, index + 5).join(' '));
    }
    return shingles;
  };
  const leftShingles = makeShingles(left);
  const rightShingles = makeShingles(right);
  if (leftShingles.size === 0 || rightShingles.size === 0) return 0;
  let intersection = 0;
  for (const shingle of leftShingles) {
    if (rightShingles.has(shingle)) intersection += 1;
  }
  return intersection / (leftShingles.size + rightShingles.size - intersection);
}

function lowInformationReason(source: BrowserReadResult): SourceQualityMetadata['exclusionReason'] {
  const content = `${source.title}\n${source.text}`;
  const normalizedTitle = source.title.trim().toLocaleLowerCase();
  const wordCount = source.extraction?.wordCount ?? source.text.split(/\s+/u).filter(Boolean).length;
  if (
    /\b(?:log in|sign in|create an account|register to continue|members only)\b/iu.test(content) &&
    source.text.length < 1_000
  ) {
    return 'authentication-required';
  }
  if (
    /\b(?:accept all cookies|cookie consent|consent required|manage your consent)\b/iu.test(content) &&
    source.text.length < 500
  ) {
    return 'consent-required';
  }
  if (
    (source.httpStatus !== undefined && source.httpStatus >= 400) ||
    (/^(?:404|403|500|error|page not found|access denied)(?:\b|$)/iu.test(normalizedTitle) &&
      source.text.length < 500)
  ) {
    return 'http-error';
  }
  if (source.contentType && !/^(?:text\/html|application\/xhtml\+xml|text\/plain)$/iu.test(source.contentType)) {
    return source.text.length < 80 ? 'unsupported-content' : undefined;
  }
  if (source.text.trim().length < 80 || wordCount < 12) return 'insufficient-content';
  return undefined;
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

function hasUnsupportedBrowserInterstitial(source: BrowserReadResult): boolean {
  const pathSegments = new URL(source.finalUrl).pathname
    .toLocaleLowerCase()
    .split('/')
    .filter(Boolean);
  if (pathSegments.at(-1) === 'unsupportedbrowser') return true;

  const errorTitle = /^(?:error|unsupported browser)$/iu.test(source.title.trim());
  const unsupportedBrowserMessage =
    /\b(?:unsupported browser|(?:your|this) browser is not supported|switch to a supported browser)\b/iu;
  return errorTitle && unsupportedBrowserMessage.test(source.text);
}

export function assessSourceQuality(
  source: BrowserReadResult,
  sourceId: string,
  previous: Array<{ id: string; hash: string; text?: string }>,
  request = '',
): SourceQualityMetadata {
  const url = new URL(source.finalUrl);
  const domain = normalizeHostname(url.hostname);
  const classification = classifyKind(domain);
  const challenge = hasSecurityChallenge(source.title, source.text);
  const unsupportedBrowser = hasUnsupportedBrowserInterstitial(source);
  const lowInformation = lowInformationReason(source);
  const accessStatus = challenge ? 'security-challenge' : unsupportedBrowser || lowInformation ? 'unavailable' : 'readable';
  const hash = contentHash(source.text);
  const duplicate = previous.find(
    (item) => item.hash === hash || (item.text !== undefined && textSimilarity(item.text, source.text) >= 0.82),
  );
  const relevanceScore = calculateRelevanceScore(request, source.title, source.text);
  const qualityScore = source.extraction?.qualityScore ?? Math.min(100, Math.round(source.text.length / 50));
  const exclusionReason = challenge
    ? 'security-challenge'
    : unsupportedBrowser
      ? 'unsupported-browser'
      : lowInformation
        ? lowInformation
        : duplicate
          ? 'duplicate-content'
          : undefined;
  const evidenceStatus = exclusionReason === undefined ? 'eligible' : 'excluded';

  return {
    domain,
    kind: classification.kind,
    accessStatus,
    evidenceStatus,
    qualityScore,
    relevanceScore,
    signals: [
      ...(classification.signal === undefined ? [] : [classification.signal]),
      ...(source.extraction?.method === 'mozilla-readability' ? ['readability-extracted'] : []),
      ...(source.extraction?.method === 'semantic-fallback' ? ['semantic-fallback-extracted'] : []),
      ...(relevanceScore > 0 && relevanceScore < 20 ? ['low-query-overlap'] : []),
      ...(relevanceScore === 0 && request.trim().length > 0 ? ['no-query-overlap'] : []),
      ...(accessStatus === 'security-challenge' ? ['security-challenge'] : []),
      ...(unsupportedBrowser ? ['unsupported-browser'] : []),
      ...(accessStatus === 'unavailable' && !unsupportedBrowser ? ['unavailable-content'] : []),
      ...(duplicate === undefined ? [] : ['near-duplicate-content']),
      ...(lowInformation === 'authentication-required' ? ['authentication-required'] : []),
      ...(lowInformation === 'consent-required' ? ['consent-required'] : []),
      ...(lowInformation === 'http-error' ? ['http-error-page'] : []),
      ...(lowInformation === 'unsupported-content' ? ['unsupported-content-type'] : []),
      ...(lowInformation === 'insufficient-content' ? ['insufficient-extracted-content'] : []),
    ],
    contentHash: hash,
    ...(exclusionReason === undefined ? {} : { exclusionReason }),
    ...(duplicate === undefined ? {} : { duplicateOfSourceId: duplicate.id }),
    assessment: 'domain-and-content-signals-only',
  };
}
