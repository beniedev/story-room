import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

type HostAuthority = {
  hostname: string;
  port?: string;
};

const normalizeHost = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
};

const parseHostAuthority = (value: string): HostAuthority | null => {
  const raw = value.trim();
  if (!raw || raw !== value || raw.includes('\\')) return null;
  const authority = isIP(raw) === 6 ? `[${raw}]` : raw;
  let parsed: URL;
  try {
    parsed = new URL(`http://${authority}`);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  const hostname = normalizeHost(parsed.hostname);
  if (!hostname) return null;
  return { hostname, port: parsed.port || undefined };
};

export const requestHost = (request: IncomingMessage) => {
  const value = request.headers.host;
  return typeof value === 'string' ? parseHostAuthority(value) : null;
};

export const sameOrigin = (request: IncomingMessage, actualHost: HostAuthority) => {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (origin.trim() !== origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return false;
  }
  const host = actualHost.hostname.includes(':') ? `[${actualHost.hostname}]` : actualHost.hostname;
  const expected = new URL(`http://${host}${actualHost.port ? `:${actualHost.port}` : ''}`);
  return parsed.origin === expected.origin;
};

export const formatUrlHost = (value: string) => value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
