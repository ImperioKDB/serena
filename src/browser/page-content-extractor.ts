import {
  extractArticle,
  hasSufficientArticleContent,
  type ExtractedArticle,
} from './article-extractor.js';

export interface RenderedPageLike {
  url(): string;
  title(): Promise<string>;
  content(): Promise<string>;
  waitForTimeout(timeout: number): Promise<void>;
}

const MAX_DYNAMIC_CONTENT_SETTLE_MS = 500;

export async function extractRenderedArticle(
  page: RenderedPageLike,
  timeoutMs: number,
): Promise<ExtractedArticle> {
  const fallbackTitle = await page.title();
  const first = extractArticle(await page.content(), page.url(), fallbackTitle);
  if (hasSufficientArticleContent(first) || timeoutMs < 200) return first;

  await page.waitForTimeout(Math.min(MAX_DYNAMIC_CONTENT_SETTLE_MS, Math.floor(timeoutMs / 8)));
  const second = extractArticle(await page.content(), page.url(), fallbackTitle);
  return second.text.length > first.text.length || second.metadata.qualityScore > first.metadata.qualityScore
    ? second
    : first;
}
