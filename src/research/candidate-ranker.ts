import type { SearchCandidate } from '../search/search-provider.js';
import { calculateRelevanceScore } from './source-quality.js';

const MAX_CANDIDATES = 10;
const SOCIAL_HOSTS = new Set([
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'pinterest.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'youtube.com',
]);

export type CandidateRejectionReason =
  | 'invalid-url'
  | 'duplicate-url'
  | 'unsupported-browser-route'
  | 'outside-selection-cap';

export interface RankedSearchCandidate {
  candidate: SearchCandidate;
  domain: string;
  score: number;
  relevanceScore: number;
  signals: string[];
}

export interface CandidateSelection {
  selected: RankedSearchCandidate[];
  ranked: RankedSearchCandidate[];
  rejected: Array<{
    rank: number;
    domain?: string;
    reason: CandidateRejectionReason;
  }>;
}

function normalizedHost(hostname: string): string {
  return hostname.toLocaleLowerCase().replace(/^www\./u, '');
}

function isSocialHost(hostname: string): boolean {
  const host = normalizedHost(hostname);
  return [...SOCIAL_HOSTS].some((socialHost) => host === socialHost || host.endsWith(`.${socialHost}`));
}

export function selectSearchCandidates(
  request: string,
  candidates: SearchCandidate[],
  maxCandidates = MAX_CANDIDATES,
  modelRelevanceScores?: ReadonlyMap<number, number>,
): CandidateSelection {
  const cap = Math.max(1, Math.min(maxCandidates, MAX_CANDIDATES));
  const rejected: CandidateSelection['rejected'] = [];
  const valid: RankedSearchCandidate[] = [];
  const seenUrls = new Set<string>();
  const unsupportedRoute = /\/(?:unsupportedbrowser|unsupported-browser|unsupported_browser)\/?$/iu;

  for (const candidate of candidates) {
    let url: URL;
    try {
      url = new URL(candidate.url);
    } catch {
      rejected.push({ rank: candidate.rank, reason: 'invalid-url' });
      continue;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
      rejected.push({ rank: candidate.rank, reason: 'invalid-url' });
      continue;
    }
    url.hash = '';
    const canonicalUrl = url.toString();
    if (seenUrls.has(canonicalUrl)) {
      rejected.push({ rank: candidate.rank, domain: normalizedHost(url.hostname), reason: 'duplicate-url' });
      continue;
    }
    seenUrls.add(canonicalUrl);
    const domain = normalizedHost(url.hostname);
    if (unsupportedRoute.test(url.pathname)) {
      rejected.push({ rank: candidate.rank, domain, reason: 'unsupported-browser-route' });
      continue;
    }

    const relevanceScore = calculateRelevanceScore(request, candidate.title, `${url.pathname} ${url.search}`);
    const providerRankScore = Math.max(0, 100 - (Math.max(1, candidate.rank) - 1) * 5);
    const homePagePenalty = url.pathname === '/' ? 25 : 0;
    const socialPenalty = isSocialHost(url.hostname) ? 35 : 0;
    const filePathPenalty = /\.(?:zip|exe|dmg|iso|mp4|mp3|jpg|jpeg|png|webp)$/iu.test(url.pathname)
      ? 45
      : 0;
    const deterministicScore = Math.max(
      0,
      Math.min(100, Math.round(providerRankScore * 0.35 + relevanceScore * 0.65 - homePagePenalty - socialPenalty - filePathPenalty)),
    );
    const modelScore = modelRelevanceScores?.get(candidate.rank);
    const modelAdjustment = modelScore === undefined ? 0 : Math.round((modelScore - 50) * 0.2);
    const score = Math.max(0, Math.min(100, deterministicScore + modelAdjustment));
    const signals = [
      ...(relevanceScore > 0 ? ['query-term-overlap'] : ['no-query-term-overlap']),
      ...(modelScore === undefined ? [] : ['model-relevance-advisory']),
      ...(homePagePenalty > 0 ? ['homepage'] : []),
      ...(socialPenalty > 0 ? ['social-platform'] : []),
      ...(filePathPenalty > 0 ? ['non-text-file-path'] : []),
    ];
    valid.push({
      candidate: { ...candidate, url: canonicalUrl },
      domain,
      score,
      relevanceScore,
      signals,
    });
  }

  const ranked = [...valid].sort(
    (left, right) => right.score - left.score || left.candidate.rank - right.candidate.rank,
  );
  const selected: RankedSearchCandidate[] = [];
  const selectedDomains = new Set<string>();
  const leftovers: RankedSearchCandidate[] = [];
  for (const candidate of ranked) {
    if (selected.length >= cap) break;
    if (selectedDomains.has(candidate.domain)) {
      leftovers.push(candidate);
      continue;
    }
    selected.push(candidate);
    selectedDomains.add(candidate.domain);
  }
  for (const candidate of leftovers) {
    if (selected.length >= cap) break;
    selected.push(candidate);
  }

  const selectedUrls = new Set(selected.map((item) => item.candidate.url));
  for (const item of ranked) {
    if (!selectedUrls.has(item.candidate.url)) {
      rejected.push({ rank: item.candidate.rank, domain: item.domain, reason: 'outside-selection-cap' });
    }
  }
  return { selected, ranked, rejected };
}
