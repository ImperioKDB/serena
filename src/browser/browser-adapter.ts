import type { BrowserReadResult } from '../core/result.js';

export interface BrowserReadOptions {
  timeoutMs?: number;
  allowedDomains?: readonly string[];
  allowLocalHttp?: boolean;
}

export interface BrowserAdapter {
  readPage(target: string, options?: BrowserReadOptions): Promise<BrowserReadResult>;
}
