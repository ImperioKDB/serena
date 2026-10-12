import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { resolvePublicAddresses, validateTargetUrl } from '../core/policy.js';
import { BrowserReadError } from '../core/result.js';
import type { BrowserReadOptions } from './browser-adapter.js';

export interface SafeHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  setCookies: string[];
  body: Buffer;
}

export interface SafeHttpRequestOptions extends BrowserReadOptions {
  method: 'GET' | 'HEAD';
  headers: Record<string, string>;
  maxResponseBytes: number;
}

const REQUEST_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'origin',
  'user-agent',
]);
const RESPONSE_HEADER_BLOCKLIST = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const MAX_HEADER_BYTES = 16 * 1024;

function makeRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { 'accept-encoding': 'identity' };
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (REQUEST_HEADER_ALLOWLIST.has(normalizedName)) result[normalizedName] = value;
  }
  return result;
}

function makeResponseHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || RESPONSE_HEADER_BLOCKLIST.has(name.toLowerCase())) continue;
    result[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

function responseCookies(response: IncomingMessage): string[] {
  const values: string[] = [];
  const rawHeaders = response.rawHeaders;
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'set-cookie') {
      values.push(rawHeaders[index + 1] ?? '');
    }
  }
  return values;
}

function decoderFor(rawEncoding: string | undefined): Transform | undefined {
  const encoding = rawEncoding?.trim().toLowerCase();
  if (!encoding || encoding === 'identity') return undefined;
  if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip();
  if (encoding === 'deflate') return createInflate();
  if (encoding === 'br') return createBrotliDecompress();
  throw new BrowserReadError(
    'NAVIGATION_FAILED',
    'The server used an unsupported content encoding.',
  );
}

async function readBoundedBody(
  response: IncomingMessage,
  maxResponseBytes: number,
): Promise<Buffer> {
  const contentLength = Number(response.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    response.destroy();
    throw new BrowserReadError('RESPONSE_TOO_LARGE', 'The page exceeded its response-size budget.');
  }

  let receivedBytes = 0;
  const rawLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxResponseBytes) {
        callback(
          new BrowserReadError('RESPONSE_TOO_LARGE', 'The page exceeded its response-size budget.'),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  let decoder: Transform | undefined;
  try {
    decoder = decoderFor(response.headers['content-encoding']);
  } catch (error) {
    response.destroy();
    throw error;
  }
  const decoded: Readable = decoder ?? rawLimit;
  const streamDone = decoder ? pipeline(response, rawLimit, decoder) : pipeline(response, rawLimit);
  const chunks: Buffer[] = [];
  let decodedBytes = 0;
  try {
    for await (const chunk of decoded) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      decodedBytes += buffer.length;
      if (decodedBytes > maxResponseBytes) {
        throw new BrowserReadError(
          'RESPONSE_TOO_LARGE',
          'The page exceeded its response-size budget.',
        );
      }
      chunks.push(buffer);
    }
    await streamDone;
  } catch (error) {
    response.destroy();
    await streamDone.catch(() => undefined);
    if (error instanceof BrowserReadError) throw error;
    throw new BrowserReadError('NAVIGATION_FAILED', 'The server response could not be decoded.');
  }
  return Buffer.concat(chunks, decodedBytes);
}

export async function fetchPublicResponse(
  rawTarget: string,
  options: SafeHttpRequestOptions,
): Promise<SafeHttpResponse> {
  const target = validateTargetUrl(rawTarget, options);
  const addresses = await resolvePublicAddresses(target, options);
  const address = addresses[0];
  if (!address) {
    throw new BrowserReadError('INVALID_TARGET', 'Target hostname could not be safely resolved.');
  }

  const family = isIP(address);
  if (family === 0) {
    throw new BrowserReadError(
      'INVALID_TARGET',
      'Target hostname did not resolve to a valid IP address.',
    );
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = makeRequestHeaders(options.headers);
  const hostHeader = target.host;
  const requestOptions = {
    method: options.method,
    headers: { ...headers, host: hostHeader },
    hostname: address,
    host: address,
    port: target.port ? Number(target.port) : undefined,
    agent: false as const,
    maxHeaderSize: MAX_HEADER_BYTES,
    signal,
    ...(target.protocol === 'https:' && isIP(target.hostname.replace(/^\[|\]$/gu, '')) === 0
      ? { servername: target.hostname }
      : {}),
  };
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest;

  try {
    return await new Promise<SafeHttpResponse>((resolve, reject) => {
      const request = send(target, requestOptions, (response) => {
        void (async () => {
          let body: Buffer;
          if (options.method === 'HEAD') {
            response.resume();
            body = Buffer.alloc(0);
          } else {
            body = await readBoundedBody(response, options.maxResponseBytes);
          }
          resolve({
            statusCode: response.statusCode ?? 502,
            headers: makeResponseHeaders(response.headers),
            setCookies: responseCookies(response),
            body,
          });
        })().catch(reject);
      });
      request.once('error', reject);
      request.end();
    });
  } catch (error) {
    if (error instanceof BrowserReadError) throw error;
    if (signal.aborted) {
      throw new BrowserReadError(
        'NAVIGATION_TIMEOUT',
        `Navigation timed out after ${timeoutMs} ms.`,
        target.toString(),
      );
    }
    throw new BrowserReadError(
      'NAVIGATION_FAILED',
      'A safe page request could not be completed.',
      target.toString(),
    );
  }
}
