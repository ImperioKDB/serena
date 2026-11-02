import { describe, expect, it } from 'vitest';

import { selectSearchCandidates } from '../src/research/candidate-ranker.js';

describe('search candidate ranking', () => {
  it('rejects known unsupported-browser routes and prefers query-relevant pages', () => {
    const selection = selectSearchCandidates(
      'Find ongoing scholarships for Nigerian undergraduates',
      [
        { url: 'https://www.facebook.com/unsupportedbrowser', title: 'Scholarships for undergraduates', rank: 1 },
        { url: 'https://example.org/scholarships', title: 'Scholarships for Nigerian undergraduates', rank: 2 },
        { url: 'https://example.edu/programme', title: 'Programme for Nigerian undergraduates', rank: 3 },
      ],
      2,
    );

    expect(selection.rejected).toContainEqual({
      rank: 1,
      domain: 'facebook.com',
      reason: 'unsupported-browser-route',
    });
    expect(selection.selected).toHaveLength(2);
    expect(selection.selected[0]?.candidate.url).toBe('https://example.org/scholarships');
    expect(selection.selected[0]?.relevanceScore).toBeGreaterThan(0);
  });

  it('uses distinct hosts before selecting a second page from the same host', () => {
    const selection = selectSearchCandidates(
      'football statistics players',
      [
        { url: 'https://stats.example.com/player/a', title: 'Football player statistics', rank: 1 },
        { url: 'https://stats.example.com/player/b', title: 'Football player statistics', rank: 2 },
        { url: 'https://league.example.org/stats', title: 'Football player statistics', rank: 3 },
      ],
      2,
    );

    expect(selection.selected.map((item) => item.domain)).toEqual(['stats.example.com', 'league.example.org']);
  });

  it('rejects malformed destinations and de-duplicates URLs without exceeding the cap', () => {
    const selection = selectSearchCandidates(
      'scholarships',
      [
        { url: 'javascript:alert(1)', title: 'Scholarship', rank: 1 },
        { url: 'https://example.org/scholarship#top', title: 'Scholarship', rank: 2 },
        { url: 'https://example.org/scholarship', title: 'Scholarship duplicate', rank: 3 },
        { url: 'https://example.com/other', title: 'Scholarship', rank: 4 },
      ],
      1,
    );

    expect(selection.selected).toHaveLength(1);
    expect(selection.selected[0]?.candidate.url).toBe('https://example.org/scholarship');
    expect(selection.rejected.map((item) => item.reason)).toEqual(
      expect.arrayContaining(['invalid-url', 'duplicate-url', 'outside-selection-cap']),
    );
  });
});
