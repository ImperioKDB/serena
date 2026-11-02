import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

import type {
  BrowserReadExtractionMetadata,
  BrowserReadExtractionMethod,
} from '../core/result.js';

export const MAX_ARTICLE_HTML_CHARS = 4 * 1024 * 1024;
export const MAX_ARTICLE_TEXT_CHARS = 50_000;
const MAX_ARTICLE_BLOCKS = 4_000;
const MIN_READABILITY_CHARS = 180;
const BOILERPLATE_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  'nav',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="contentinfo"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[class*="cookie" i]',
  '[id*="cookie" i]',
  '[class*="consent" i]',
  '[id*="consent" i]',
  '[class*="sidebar" i]',
  '[id*="sidebar" i]',
  '[class*="breadcrumb" i]',
  '[id*="breadcrumb" i]',
  '[class*="related-post" i]',
  '[class*="social-share" i]',
  '[class*="advert" i]',
  '[id*="advert" i]',
].join(',');

export type ArticleExtractionMethod = BrowserReadExtractionMethod;

export interface ArticleTextBlock {
  text: string;
  startOffset: number;
  endOffset: number;
  sectionHeading?: string;
}

export type ArticleExtractionMetadata = BrowserReadExtractionMetadata;

export interface ExtractedArticle {
  title: string;
  text: string;
  blocks: ArticleTextBlock[];
  metadata: ArticleExtractionMetadata;
}

export interface EvidencePassage {
  excerpt: string;
  locator: string;
  segmentIndex: number;
  startOffset: number;
  endOffset: number;
  sectionHeading?: string;
}

interface RawTextBlock {
  text: string;
  kind: 'heading' | 'paragraph';
  sectionHeading?: string;
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/gu, ' ')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function elementText(element: Element): string {
  return normalizeText(element.textContent ?? '');
}

function collectRawBlocks(root: Element): RawTextBlock[] {
  const result: RawTextBlock[] = [];
  let activeHeading: string | undefined;

  const addParagraph = (text: string, sectionHeading = activeHeading): void => {
    const cleaned = normalizeText(text);
    if (!cleaned || result.length >= MAX_ARTICLE_BLOCKS) return;
    result.push({ text: cleaned, kind: 'paragraph', ...(sectionHeading ? { sectionHeading } : {}) });
  };

  const visit = (node: Node): void => {
    if (result.length >= MAX_ARTICLE_BLOCKS) return;
    if (node.nodeType === node.TEXT_NODE) {
      const text = normalizeText(node.textContent ?? '');
      if (text.length >= 40) addParagraph(text);
      return;
    }
    if (!(node instanceof root.ownerDocument!.defaultView!.Element)) return;

    const element = node as Element;
    const tag = element.tagName.toLocaleLowerCase();
    if (/^h[1-6]$/u.test(tag)) {
      const heading = elementText(element);
      if (heading) {
        activeHeading = heading.slice(0, 240);
        result.push({ text: activeHeading, kind: 'heading' });
      }
      return;
    }
    if (tag === 'table') {
      for (const row of Array.from(element.querySelectorAll('tr'))) {
        const cells = Array.from(row.querySelectorAll('th, td'))
          .map(elementText)
          .filter(Boolean);
        if (cells.length > 0) addParagraph(cells.join(' | '));
      }
      return;
    }
    if (['p', 'li', 'blockquote', 'pre', 'dt', 'dd'].includes(tag)) {
      const text = elementText(element);
      if (text) addParagraph(tag === 'li' ? `• ${text}` : text);
      return;
    }

    const children = Array.from(element.childNodes);
    if (children.length === 0) {
      const text = elementText(element);
      if (text.length >= 40) addParagraph(text);
      return;
    }
    for (const child of children) visit(child);
  };

  visit(root);
  return result;
}

function chooseSemanticRoot(document: Document): Element | null {
  const candidates = Array.from(
    document.querySelectorAll('article, [itemprop="articleBody"], main, [role="main"]'),
  );
  const ranked = candidates
    .map((element) => ({ element, length: elementText(element).length }))
    .filter((candidate) => candidate.length >= MIN_READABILITY_CHARS)
    .sort((left, right) => right.length - left.length);
  return ranked[0]?.element ?? null;
}

function cleanSemanticRoot(root: Element): Element {
  const clone = root.cloneNode(true) as Element;
  for (const element of Array.from(clone.querySelectorAll(BOILERPLATE_SELECTOR))) {
    element.remove();
  }
  return clone;
}

function buildArticleText(rawBlocks: RawTextBlock[]): {
  text: string;
  blocks: ArticleTextBlock[];
  sectionCount: number;
} {
  const blocks: ArticleTextBlock[] = [];
  const textParts: string[] = [];
  const sectionHeadings = new Set<string>();
  let length = 0;

  for (const block of rawBlocks) {
    if (length >= MAX_ARTICLE_TEXT_CHARS) break;
    const prefix = length === 0 ? '' : block.kind === 'heading' ? '\n' : '\n\n';
    const remaining = MAX_ARTICLE_TEXT_CHARS - length - prefix.length;
    if (remaining <= 0) break;
    const value = block.text.slice(0, remaining);
    if (!value) continue;
    textParts.push(prefix, value);
    const startOffset = length + prefix.length;
    const endOffset = startOffset + value.length;
    length = endOffset;
    if (block.kind === 'paragraph') {
      blocks.push({
        text: value,
        startOffset,
        endOffset,
        ...(block.sectionHeading ? { sectionHeading: block.sectionHeading } : {}),
      });
    } else {
      sectionHeadings.add(value);
    }
  }

  return { text: textParts.join(''), blocks, sectionCount: sectionHeadings.size };
}

function scoreExtraction(text: string, blocks: ArticleTextBlock[], sectionCount: number): number {
  const wordCount = text.split(/\s+/u).filter(Boolean).length;
  const textScore = Math.min(40, Math.round((text.length / 2_000) * 40));
  const paragraphScore = Math.min(35, blocks.length * 4);
  const sectionScore = Math.min(25, sectionCount * 5);
  return Math.min(100, textScore + paragraphScore + sectionScore + (wordCount >= 80 ? 10 : 0));
}

function metadataString(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, 300) : undefined;
}

export function extractArticle(html: string, pageUrl: string, fallbackTitle = ''): ExtractedArticle {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    throw new Error('Article extraction requires a valid page URL.');
  }

  const boundedHtml = html.slice(0, MAX_ARTICLE_HTML_CHARS);
  const dom = new JSDOM(boundedHtml, { url: url.toString(), contentType: 'text/html' });
  try {
    const document = dom.window.document;
    let method: ArticleExtractionMethod = 'mozilla-readability';
    let title = fallbackTitle.trim();
    let rawBlocks: RawTextBlock[] = [];
    let byline: string | undefined;
    let siteName: string | undefined;
    let publishedTime: string | undefined;
    let language: string | undefined;

    try {
      const article = new Readability(document.cloneNode(true) as Document, {
        maxElemsToParse: 30_000,
        charThreshold: 180,
        keepClasses: false,
        disableJSONLD: true,
      }).parse();
      if (article?.content) {
        const content = document.createElement('div');
        content.innerHTML = article.content;
        for (const element of Array.from(content.querySelectorAll(BOILERPLATE_SELECTOR))) {
          element.remove();
        }
        const parsedBlocks = collectRawBlocks(content);
        const parsedProseLength = parsedBlocks
          .filter((block) => block.kind === 'paragraph')
          .reduce((total, block) => total + block.text.length, 0);
        if (parsedProseLength >= MIN_READABILITY_CHARS) rawBlocks = parsedBlocks;
        const pageHeading = document.querySelector('article h1, main h1, h1');
        title = elementText(pageHeading ?? document.createElement('span')) || article.title?.trim() || title;
        byline = metadataString(article.byline);
        siteName = metadataString(article.siteName);
        publishedTime = metadataString(article.publishedTime);
        language = metadataString(article.lang);
      }
    } catch {
      // The untrusted page may contain malformed markup; use the bounded semantic fallback.
    }

    if (rawBlocks.length === 0) {
      method = 'semantic-fallback';
      const semanticRoot = chooseSemanticRoot(document) ?? document.body;
      rawBlocks = collectRawBlocks(cleanSemanticRoot(semanticRoot));
    }

    const built = buildArticleText(rawBlocks);
    const text = built.text.trim();
    const wordCount = text.split(/\s+/u).filter(Boolean).length;
    const qualityScore = scoreExtraction(text, built.blocks, built.sectionCount);
    return {
      title: title.slice(0, 300),
      text,
      blocks: built.blocks,
      metadata: {
        method,
        qualityScore,
        characterCount: text.length,
        wordCount,
        sectionCount: built.sectionCount,
        ...(byline ? { byline } : {}),
        ...(siteName ? { siteName } : {}),
        ...(publishedTime ? { publishedTime } : {}),
        ...(language ? { language } : {}),
      },
    };
  } finally {
    dom.window.close();
  }
}

function splitLongBlock(block: ArticleTextBlock, maxChars: number): ArticleTextBlock[] {
  if (block.text.length <= maxChars) return [block];
  const sentences = block.text.match(/[^.!?]+(?:[.!?]+|$)/gu) ?? [block.text];
  const result: ArticleTextBlock[] = [];
  let current = '';
  let sourceOffset = 0;

  const flush = (): void => {
    const text = current.trim();
    if (!text) return;
    const localStart = block.text.indexOf(text, sourceOffset);
    const safeStart = localStart < 0 ? sourceOffset : localStart;
    const startOffset = block.startOffset + safeStart;
    const endOffset = startOffset + text.length;
    result.push({
      text,
      startOffset,
      endOffset,
      ...(block.sectionHeading ? { sectionHeading: block.sectionHeading } : {}),
    });
    sourceOffset = safeStart + text.length;
    current = '';
  };

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (current && candidate.length > maxChars) flush();
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    const words = next.split(/\s+/u);
    for (const word of words) {
      const wordCandidate = current ? `${current} ${word}` : word;
      if (current && wordCandidate.length > maxChars) flush();
      current = current ? `${current} ${word}` : word;
    }
    flush();
  }
  flush();
  return result;
}

export function segmentArticle(
  article: ExtractedArticle,
  options: { maxSegments?: number; maxCharsPerSegment?: number } = {},
): EvidencePassage[] {
  const maxSegments = Math.max(1, Math.min(options.maxSegments ?? 6, 12));
  const maxCharsPerSegment = Math.max(200, Math.min(options.maxCharsPerSegment ?? 1_000, 1_500));
  const candidates: ArticleTextBlock[] = [];
  let pending: ArticleTextBlock | undefined;

  for (const rawBlock of article.blocks) {
    for (const block of splitLongBlock(rawBlock, maxCharsPerSegment)) {
      if (block.text.length < 80 && pending) {
        const combined = `${pending.text}\n${block.text}`;
        if (
          combined.length <= maxCharsPerSegment &&
          pending.sectionHeading === block.sectionHeading
        ) {
          pending = {
            ...pending,
            text: combined,
            endOffset: block.endOffset,
          };
          continue;
        }
      }
      if (pending) candidates.push(pending);
      pending = block;
    }
  }
  if (pending) candidates.push(pending);

  const useful = candidates.filter((block) => block.text.trim().length >= 80);
  const selected = useful.length <= maxSegments
    ? useful
    : maxSegments === 1
      ? [useful[Math.floor((useful.length - 1) / 2)]!]
    : Array.from({ length: maxSegments }, (_, index) => {
        const selectedIndex = Math.round((index * (useful.length - 1)) / (maxSegments - 1));
        return useful[selectedIndex]!;
      });

  return selected.map((block, index) => ({
    excerpt: block.text,
    locator: [
      block.sectionHeading ? `Section: ${block.sectionHeading}` : undefined,
      `passage ${index + 1}`,
      `characters ${block.startOffset}-${block.endOffset}`,
    ]
      .filter(Boolean)
      .join(' · '),
    segmentIndex: index + 1,
    startOffset: block.startOffset,
    endOffset: block.endOffset,
    ...(block.sectionHeading ? { sectionHeading: block.sectionHeading } : {}),
  }));
}

export function segmentPlainText(
  text: string,
  options: { maxSegments?: number; maxCharsPerSegment?: number } = {},
): EvidencePassage[] {
  const normalized = text.replace(/\r\n?/gu, '\n');
  const blocks: ArticleTextBlock[] = [];
  let cursor = 0;
  for (const paragraph of normalized.split(/\n{2,}/u)) {
    const cleaned = paragraph.trim();
    if (!cleaned) {
      cursor += paragraph.length + 2;
      continue;
    }
    const localStart = normalized.indexOf(cleaned, cursor);
    const startOffset = localStart < 0 ? cursor : localStart;
    blocks.push({ text: cleaned, startOffset, endOffset: startOffset + cleaned.length });
    cursor = startOffset + cleaned.length;
  }
  const wordCount = normalized.split(/\s+/u).filter(Boolean).length;
  return segmentArticle(
    {
      title: '',
      text: normalized.slice(0, MAX_ARTICLE_TEXT_CHARS),
      blocks,
      metadata: {
        method: 'semantic-fallback',
        qualityScore: 0,
        characterCount: Math.min(normalized.length, MAX_ARTICLE_TEXT_CHARS),
        wordCount,
        sectionCount: 0,
      },
    },
    options,
  );
}

export function hasSufficientArticleContent(article: Pick<ExtractedArticle, 'text' | 'metadata'>): boolean {
  return article.text.length >= 80 && article.metadata.wordCount >= 12;
}
