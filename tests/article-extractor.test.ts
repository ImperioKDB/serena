import { describe, expect, it } from 'vitest';

import {
  extractArticle,
  hasSufficientArticleContent,
  segmentArticle,
} from '../src/browser/article-extractor.js';

describe('article extraction', () => {
  it('extracts the article instead of navigation, cookie UI, and boilerplate', () => {
    const html = `
      <!doctype html>
      <html lang="en">
        <head><title>Page title</title><meta property="og:site_name" content="Example Foundation"></head>
        <body>
          <nav><a href="/">Home</a><a href="/menu">Scholarship menu</a></nav>
          <div class="cookie-banner">Accept all cookies to continue.</div>
          <main>
            <article>
              <h1>Undergraduate opportunity</h1>
              <p>The foundation offers a renewable undergraduate scholarship for students admitted to accredited universities. Applicants must demonstrate financial need and maintain satisfactory academic progress during each funded term. The programme supports tuition and required academic materials.</p>
              <h2>Eligibility</h2>
              <p>Applicants must be citizens or permanent residents of the country and enrolled full-time in an eligible bachelor's degree. The application must include proof of admission, an academic transcript, and a short statement explaining the student's goals.</p>
              <h2>Deadline and award</h2>
              <p>Applications close on 30 September 2026. Selected students receive a grant of 250,000 naira per academic year, subject to annual review. The award is paid directly to the institution after enrolment is confirmed.</p>
            </article>
          </main>
          <footer>Privacy policy · Contact us · Terms</footer>
        </body>
      </html>`;

    const article = extractArticle(html, 'https://example.org/scholarship/undergraduate');

    expect(article.title).toContain('Undergraduate opportunity');
    expect(article.metadata.method).toBe('mozilla-readability');
    expect(article.metadata.siteName).toBe('Example Foundation');
    expect(article.text).toContain('The foundation offers a renewable undergraduate scholarship');
    expect(article.text).toContain('Eligibility');
    expect(article.text).not.toContain('Scholarship menu');
    expect(article.text).not.toContain('Accept all cookies');
    expect(article.text).not.toContain('Privacy policy');
    expect(hasSufficientArticleContent(article)).toBe(true);
  });

  it('uses semantic main/article fallback when Readability has too little prose', () => {
    const html = `
      <html><body>
        <nav><a href="/">Home</a><a href="/apply">Apply</a></nav>
        <main>
          <h1>Current award</h1>
          <h2>Funding</h2>
          <p>Eligible students can receive a tuition grant of 100,000 naira. Applications close 15 August 2026.</p>
        </main>
      </body></html>`;

    const article = extractArticle(html, 'https://example.org/award');

    expect(article.metadata.method).toBe('semantic-fallback');
    expect(article.text).toContain('Funding');
    expect(article.text).toContain('Applications close 15 August 2026');
    expect(article.text).not.toContain('Apply');
  });

  it('does not execute scripts or fetch remote resources while parsing untrusted HTML', () => {
    const html = `
      <html><body>
        <script>globalThis.__serenaInjected = true;</script>
        <img src="https://invalid.example/tracker.gif" alt="">
        <main><p>Useful public information. The application closes in October and eligibility requires current university enrolment.</p></main>
      </body></html>`;

    const article = extractArticle(html, 'https://example.org/page');

    expect(article.text).toContain('Useful public information');
    expect(article.text).not.toContain('__serenaInjected');
  });

  it('segments content across a long article and records exact offsets and section locators', () => {
    const html = `
      <html><body><main><article>
        <h1>Scholarship details</h1>
        <h2>Eligibility</h2>
        ${Array.from({ length: 12 }, (_, index) => `<p>Section detail ${index + 1}: eligible applicants must enrol full-time at an accredited university and submit verified transcripts and an application statement before the published deadline.</p>`).join('')}
        <h2>Application steps</h2>
        <p>Submit the form online, attach the required documents, and wait for confirmation from the scholarship office. Successful applicants receive a written award notice.</p>
      </article></main></body></html>`;
    const article = extractArticle(html, 'https://example.org/scholarship');
    const passages = segmentArticle(article, { maxSegments: 4, maxCharsPerSegment: 500 });

    expect(passages).toHaveLength(4);
    expect(passages[0]?.sectionHeading).toBe('Eligibility');
    expect(passages.some((passage) => passage.sectionHeading === 'Application steps')).toBe(true);
    for (const passage of passages) {
      expect(article.text.slice(passage.startOffset, passage.endOffset)).toBe(passage.excerpt);
      expect(passage.locator).toContain(`passage ${passage.segmentIndex}`);
      expect(passage.locator).toContain('characters');
    }
    expect(passages.at(-1)?.excerpt).toContain('Submit the form online');
  });
});
