export type BrowserReadErrorCode =
  | 'INVALID_TARGET'
  | 'NAVIGATION_TIMEOUT'
  | 'NAVIGATION_FAILED'
  | 'RESPONSE_TOO_LARGE'
  | 'REQUEST_BUDGET_EXCEEDED'
  | 'READ_FAILED';

export type ResponseSizeLimitScope = 'resource' | 'page';

export type BrowserReadExtractionMethod = 'mozilla-readability' | 'semantic-fallback';

export interface BrowserReadExtractionMetadata {
  method: BrowserReadExtractionMethod;
  qualityScore: number;
  characterCount: number;
  wordCount: number;
  sectionCount: number;
  byline?: string;
  siteName?: string;
  publishedTime?: string;
  language?: string;
}

export interface BrowserReadTextBlock {
  text: string;
  startOffset: number;
  endOffset: number;
  sectionHeading?: string;
}

export interface BrowserReadResult {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  retrievedAt: string;
  durationMs: number;
  extraction?: BrowserReadExtractionMetadata;
  articleBlocks?: BrowserReadTextBlock[];
  httpStatus?: number;
  contentType?: string;
}

export class BrowserReadError extends Error {
  public readonly code: BrowserReadErrorCode;
  public readonly target: string | undefined;
  public readonly responseSizeLimitScope: ResponseSizeLimitScope | undefined;

  public constructor(
    code: BrowserReadErrorCode,
    message: string,
    target?: string,
    responseSizeLimitScope?: ResponseSizeLimitScope,
  ) {
    super(message);
    this.name = 'BrowserReadError';
    this.code = code;
    this.target = target;
    this.responseSizeLimitScope = responseSizeLimitScope;
  }
}
