export type BrowserReadErrorCode =
  | 'INVALID_TARGET'
  | 'NAVIGATION_TIMEOUT'
  | 'NAVIGATION_FAILED'
  | 'RESPONSE_TOO_LARGE'
  | 'REQUEST_BUDGET_EXCEEDED'
  | 'READ_FAILED';

export interface BrowserReadResult {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  retrievedAt: string;
  durationMs: number;
}

export class BrowserReadError extends Error {
  public readonly code: BrowserReadErrorCode;
  public readonly target: string | undefined;

  public constructor(code: BrowserReadErrorCode, message: string, target?: string) {
    super(message);
    this.name = 'BrowserReadError';
    this.code = code;
    this.target = target;
  }
}
