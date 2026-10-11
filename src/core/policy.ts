import { BrowserReadError } from './result.js';

export interface TargetPolicyOptions {
  allowedDomains?: readonly string[];
  allowLocalHttp?: boolean;
}

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
]);

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isAllowedDomain(hostname: string, allowedDomains: readonly string[]): boolean {
  return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function validateTargetUrl(rawTarget: string, options: TargetPolicyOptions = {}): URL {
  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new BrowserReadError('INVALID_TARGET', 'Target must be an absolute URL.', rawTarget);
  }

  if (target.username || target.password) {
    throw new BrowserReadError(
      'INVALID_TARGET',
      'URLs containing credentials are not allowed.',
      rawTarget,
    );
  }

  const isLocalHttp =
    options.allowLocalHttp === true &&
    target.protocol === 'http:' &&
    (target.hostname === '127.0.0.1' || target.hostname === '[::1]');

  if (target.protocol !== 'https:' && !isLocalHttp) {
    throw new BrowserReadError('INVALID_TARGET', 'Only HTTPS URLs are allowed.', rawTarget);
  }

  const isPrivateHost = PRIVATE_HOSTNAMES.has(target.hostname) || isPrivateIpv4(target.hostname);
  if (isPrivateHost && !isLocalHttp) {
    throw new BrowserReadError(
      'INVALID_TARGET',
      'Private and metadata hosts are not allowed.',
      rawTarget,
    );
  }

  if (options.allowedDomains && !isAllowedDomain(target.hostname, options.allowedDomains)) {
    throw new BrowserReadError(
      'INVALID_TARGET',
      'Target is outside the allowed domain policy.',
      rawTarget,
    );
  }

  return target;
}
