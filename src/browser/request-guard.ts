import type { BrowserContext, Route } from 'playwright';

import { validateTargetUrl } from '../core/policy.js';
import { BrowserReadError } from '../core/result.js';
import type { BrowserReadOptions } from './browser-adapter.js';
import { fetchPublicResponse } from './safe-http.js';

const MAX_PAGE_REQUESTS = 80;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const BLOCKED_RESOURCE_TYPES = new Set(['font', 'image', 'media']);
type BrowserCookie = Parameters<BrowserContext['addCookies']>[0][number];

export interface RequestGuard {
  getPolicyError(): BrowserReadError | undefined;
}

function parseSetCookie(rawCookie: string, requestUrl: string): BrowserCookie | undefined {
  const parts = rawCookie.split(';');
  const pair = parts.shift()?.trim();
  if (!pair) return undefined;
  const equals = pair.indexOf('=');
  if (equals <= 0) return undefined;

  let target: URL;
  try {
    target = new URL(requestUrl);
  } catch {
    return undefined;
  }
  const cookie: BrowserCookie = {
    name: pair.slice(0, equals).trim(),
    value: pair.slice(equals + 1).trim(),
    path: '/',
  };
  if (!cookie.name) return undefined;

  let domain: string | undefined;
  const defaultPath =
    target.pathname.slice(0, Math.max(1, target.pathname.lastIndexOf('/'))) || '/';
  cookie.path = defaultPath;
  cookie.url = target.origin;
  let maxAge: number | undefined;

  for (const part of parts) {
    const separator = part.indexOf('=');
    const name = (separator < 0 ? part : part.slice(0, separator)).trim().toLowerCase();
    const value = separator < 0 ? '' : part.slice(separator + 1).trim();
    if (name === 'domain') {
      domain = value.replace(/^\./u, '').toLowerCase();
    } else if (name === 'path') {
      cookie.path = value.startsWith('/') ? value : '/';
    } else if (name === 'secure') {
      cookie.secure = true;
    } else if (name === 'httponly') {
      cookie.httpOnly = true;
    } else if (name === 'samesite') {
      const normalized = value.toLowerCase();
      if (normalized === 'strict') cookie.sameSite = 'Strict';
      else if (normalized === 'lax') cookie.sameSite = 'Lax';
      else if (normalized === 'none') cookie.sameSite = 'None';
    } else if (name === 'expires') {
      const expiresAt = Date.parse(value);
      if (Number.isFinite(expiresAt)) cookie.expires = Math.floor(expiresAt / 1000);
    } else if (name === 'max-age' && /^-?\d+$/u.test(value)) {
      maxAge = Number(value);
    }
  }

  if (domain) {
    const host = target.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) return undefined;
    cookie.domain = domain;
    delete cookie.url;
  }
  if (maxAge !== undefined)
    cookie.expires = maxAge <= 0 ? -1 : Math.floor(Date.now() / 1000) + maxAge;
  return cookie;
}

export async function installRequestGuard(
  context: BrowserContext,
  options: BrowserReadOptions,
): Promise<RequestGuard> {
  let requestCount = 0;
  let reservedPageBytes = 0;
  let policyError: BrowserReadError | undefined;

  await context.route('**/*', async (route: Route) => {
    const request = route.request();
    requestCount += 1;
    let byteReservation = 0;
    let reservationConsumed = false;

    try {
      if (requestCount > MAX_PAGE_REQUESTS) {
        throw new BrowserReadError('REQUEST_BUDGET_EXCEEDED', 'Page exceeded its request budget.');
      }
      if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
        await route.abort('blockedbyclient');
        return;
      }
      const method = request.method().toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        await route.abort('blockedbyclient');
        return;
      }

      const target = validateTargetUrl(request.url(), options);
      const remainingPageBytes = MAX_PAGE_BYTES - reservedPageBytes;
      if (remainingPageBytes <= 0) {
        throw new BrowserReadError(
          'RESPONSE_TOO_LARGE',
          'Page exceeded its total response-size budget.',
        );
      }
      byteReservation = Math.min(MAX_RESPONSE_BYTES, remainingPageBytes);
      reservedPageBytes += byteReservation;

      const response = await fetchPublicResponse(target.toString(), {
        ...options,
        method,
        headers: await request.allHeaders(),
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxResponseBytes: byteReservation,
      });
      reservedPageBytes -= byteReservation - response.body.byteLength;
      byteReservation = response.body.byteLength;
      reservationConsumed = true;

      if (response.setCookies.length > 0) {
        const cookies = response.setCookies
          .map((cookie) => parseSetCookie(cookie, target.toString()))
          .filter((cookie): cookie is BrowserCookie => cookie !== undefined);
        if (cookies.length > 0) {
          try {
            await context.addCookies(cookies);
          } catch {
            // A server may return malformed, expired, or browser-incompatible cookies.
            // Keep the fetched response usable without accepting unsafe cookie domains.
          }
        }
      }

      await route.fulfill({
        status: response.statusCode,
        headers: {
          ...response.headers,
          'content-length': String(response.body.byteLength),
        },
        body: response.body,
      });
    } catch (error) {
      if (
        error instanceof BrowserReadError &&
        (error.code === 'INVALID_TARGET' || error.code === 'RESPONSE_TOO_LARGE') &&
        policyError === undefined
      ) {
        policyError = error;
      }
      if (byteReservation > 0 && !reservationConsumed) {
        // A response that exceeded the cap consumed at least its full allowance;
        // preserve that reservation to keep the page-wide byte ceiling strict.
        if (error instanceof BrowserReadError && error.code === 'RESPONSE_TOO_LARGE') {
          reservedPageBytes -= byteReservation;
        } else {
          reservedPageBytes -= byteReservation;
        }
      }
      await route.abort('blockedbyclient').catch(() => undefined);
    }
  });

  return { getPolicyError: () => policyError };
}
