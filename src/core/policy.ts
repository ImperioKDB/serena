import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { BrowserReadError } from './result.js';

export interface TargetPolicyOptions {
  allowedDomains?: readonly string[];
  allowLocalHttp?: boolean;
}

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.azure.internal',
]);

function normalizedHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
    .toLowerCase();
}

function isLoopbackAddress(address: string): boolean {
  const normalized = normalizedHostname(address);
  if (isIP(normalized) === 4) {
    return normalized.startsWith('127.');
  }
  return normalized === '::1';
}

function isForbiddenIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }

  const [first = 0, second = 0, third = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function ipv6Value(address: string): bigint | undefined {
  let value = normalizedHostname(address);
  if (value.includes('%')) return undefined;

  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const ipv4 = value.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return undefined;
    const octets = ipv4.split('.').map(Number);
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    value = `${value.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return undefined;
  }
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) {
    return undefined;
  }
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function isIpv6Prefix(value: bigint, base: bigint, prefixLength: number): boolean {
  const shift = BigInt(128 - prefixLength);
  return value >> shift === base >> shift;
}

function isForbiddenIpv6(address: string): boolean {
  const value = ipv6Value(address);
  if (value === undefined) return true;

  // Block unspecified/loopback, IPv4-compatible and mapped forms, unique-local,
  // link-local, multicast, documentation, transition, and special-use ranges.
  const forbiddenPrefixes: Array<[bigint, number]> = [
    [0n, 96], // ::/96, including unspecified/loopback and IPv4-compatible forms
    [0x0000_0000_0000_0000_0000_ffff_0000_0000n, 96], // IPv4-mapped addresses
    [0x0064_ff9b_0001_0000_0000_0000_0000_0000n, 48], // local-use NAT64
    [0x0100_0000_0000_0000_0000_0000_0000n, 64], // discard-only
    [0x2001_0000_0000_0000_0000_0000_0000_0000n, 23], // IETF special-purpose
    [0x2001_0db8_0000_0000_0000_0000_0000_0000n, 32], // documentation
    [0x2002_0000_0000_0000_0000_0000_0000_0000n, 16], // 6to4
    [0xfc00_0000_0000_0000_0000_0000_0000_0000n, 7], // unique-local
    [0xfe80_0000_0000_0000_0000_0000_0000_0000n, 10], // link-local
    [0xff00_0000_0000_0000_0000_0000_0000_0000n, 8], // multicast
  ];
  return forbiddenPrefixes.some(([base, prefix]) => isIpv6Prefix(value, base, prefix));
}

function isForbiddenAddress(address: string): boolean {
  const normalized = normalizedHostname(address);
  const family = isIP(normalized);
  if (family === 4) return isForbiddenIpv4(normalized);
  if (family === 6) return isForbiddenIpv6(normalized);
  return true;
}

function isAllowedDomain(hostname: string, allowedDomains: readonly string[]): boolean {
  const normalizedHost = normalizedHostname(hostname);
  return allowedDomains.some((domain) => {
    const normalizedDomain = normalizedHostname(domain.trim());
    return (
      normalizedDomain.length > 0 &&
      !normalizedDomain.includes('/') &&
      !normalizedDomain.includes(':') &&
      (normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`))
    );
  });
}

export function validateTargetUrl(rawTarget: string, options: TargetPolicyOptions = {}): URL {
  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new BrowserReadError('INVALID_TARGET', 'Target must be an absolute URL.', rawTarget);
  }

  if (target.username || target.password) {
    throw new BrowserReadError('INVALID_TARGET', 'URLs containing credentials are not allowed.');
  }

  const hostname = normalizedHostname(target.hostname);
  const isLocalHttp =
    options.allowLocalHttp === true &&
    target.protocol === 'http:' &&
    (hostname === '127.0.0.1' || hostname === '::1');

  if (target.protocol !== 'https:' && !isLocalHttp) {
    throw new BrowserReadError('INVALID_TARGET', 'Only HTTPS URLs are allowed.');
  }
  if (target.port && !(isLocalHttp && Number(target.port) > 0 && Number(target.port) <= 65_535)) {
    throw new BrowserReadError('INVALID_TARGET', 'Only the default HTTPS port is allowed.');
  }
  if (
    PRIVATE_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new BrowserReadError('INVALID_TARGET', 'Private and metadata hosts are not allowed.');
  }
  if (isIP(hostname) !== 0 && isForbiddenAddress(hostname) && !isLocalHttp) {
    throw new BrowserReadError(
      'INVALID_TARGET',
      'Private and reserved IP addresses are not allowed.',
    );
  }
  if (options.allowedDomains && !isAllowedDomain(hostname, options.allowedDomains)) {
    throw new BrowserReadError('INVALID_TARGET', 'Target is outside the allowed domain policy.');
  }

  return target;
}

export async function resolvePublicAddresses(
  target: URL,
  options: TargetPolicyOptions = {},
  resolveAddresses: (hostname: string) => Promise<string[]> = async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map((record) => record.address),
): Promise<string[]> {
  const hostname = normalizedHostname(target.hostname);
  if (
    options.allowLocalHttp === true &&
    target.protocol === 'http:' &&
    isLoopbackAddress(hostname)
  ) {
    return [hostname];
  }
  if (isIP(hostname) !== 0) {
    if (isForbiddenAddress(hostname)) {
      throw new BrowserReadError(
        'INVALID_TARGET',
        'Private and reserved IP addresses are not allowed.',
      );
    }
    return [hostname];
  }

  let addresses: string[];
  try {
    addresses = await resolveAddresses(hostname);
  } catch {
    throw new BrowserReadError('INVALID_TARGET', 'Target hostname could not be safely resolved.');
  }
  if (addresses.length === 0 || addresses.some(isForbiddenAddress)) {
    throw new BrowserReadError(
      'INVALID_TARGET',
      'Target resolves to a private or reserved IP address.',
    );
  }
  return addresses;
}

export async function validatePublicDestination(
  target: URL,
  options: TargetPolicyOptions = {},
  resolveAddresses?: (hostname: string) => Promise<string[]>,
): Promise<void> {
  await resolvePublicAddresses(target, options, resolveAddresses);
}
