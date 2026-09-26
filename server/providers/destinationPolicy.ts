import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { ProviderProfile } from '../../src/providerProfiles.ts';
import { ProviderInputError } from './errors.ts';

type ParsedProviderUrl = {
  url: URL;
  identity: string;
};

type AddressPolicy = {
  loopback: boolean;
  linkLocal: boolean;
  privateNetwork: boolean;
  metadata: boolean;
};

const normalizeHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host.endsWith('.') ? host.slice(0, -1) : host;
};

const hostForUrl = (hostname: string) => hostname.includes(':') ? `[${hostname}]` : hostname;

const normalizedPath = (pathname: string) => pathname.replace(/\/+$/, '') || '/';

export const parseProviderUrl = (baseUrl: string): ParsedProviderUrl => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ProviderInputError('连接地址必须是有效 URL。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderInputError('连接地址只支持 http:// 或 https://。');
  }
  if (!url.hostname || url.username || url.password) {
    throw new ProviderInputError('连接地址不得包含用户名或密码。');
  }
  const hostname = normalizeHost(url.hostname);
  const effectivePort = url.port || (url.protocol === 'http:' ? '80' : '443');
  const pathname = normalizedPath(url.pathname);
  return {
    url,
    identity: `${url.protocol}//${hostForUrl(hostname)}:${effectivePort}${pathname}`,
  };
};

const providerIdentity = (profile: Pick<ProviderProfile, 'kind' | 'baseUrl'>) => (
  `${profile.kind}\u0000${parseProviderUrl(profile.baseUrl).identity}`
);

export const sameProviderIdentity = (
  first: Pick<ProviderProfile, 'kind' | 'baseUrl'> | undefined,
  second: Pick<ProviderProfile, 'kind' | 'baseUrl'>,
) => Boolean(first && providerIdentity(first) === providerIdentity(second));

export const endpoint = (baseUrl: URL, suffix: string) => {
  const url = new URL(baseUrl.toString());
  url.search = '';
  url.hash = '';
  const pathname = normalizedPath(url.pathname);
  url.pathname = `${pathname === '/' ? '' : pathname}/${suffix}`;
  return url.toString();
};

type AddressFamily = 'ipv4' | 'ipv6';

const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackAddresses.addAddress('::1', 'ipv6');
loopbackAddresses.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

const linkLocalAddresses = new BlockList();
linkLocalAddresses.addSubnet('169.254.0.0', 16, 'ipv4');
linkLocalAddresses.addSubnet('fe80::', 10, 'ipv6');
linkLocalAddresses.addSubnet('::ffff:169.254.0.0', 112, 'ipv6');

const metadataAddresses = new BlockList();
metadataAddresses.addAddress('169.254.169.254', 'ipv4');
metadataAddresses.addAddress('100.100.100.200', 'ipv4');
metadataAddresses.addAddress('192.0.0.192', 'ipv4');
metadataAddresses.addAddress('::ffff:169.254.169.254', 'ipv6');
metadataAddresses.addAddress('::ffff:100.100.100.200', 'ipv6');
metadataAddresses.addAddress('::ffff:192.0.0.192', 'ipv6');
metadataAddresses.addAddress('fd00:ec2::254', 'ipv6');

const privateNetworkAddresses = new BlockList();
const privateNetworkRules: ReadonlyArray<readonly [string, number, AddressFamily]> = [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fec0::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
  ['::ffff:0.0.0.0', 104, 'ipv6'],
  ['::ffff:10.0.0.0', 104, 'ipv6'],
  ['::ffff:100.64.0.0', 106, 'ipv6'],
  ['::ffff:127.0.0.0', 104, 'ipv6'],
  ['::ffff:169.254.0.0', 112, 'ipv6'],
  ['::ffff:172.16.0.0', 108, 'ipv6'],
  ['::ffff:192.0.0.0', 120, 'ipv6'],
  ['::ffff:192.168.0.0', 112, 'ipv6'],
  ['::ffff:198.18.0.0', 111, 'ipv6'],
  ['::ffff:224.0.0.0', 100, 'ipv6'],
  ['::ffff:240.0.0.0', 100, 'ipv6'],
];
for (const [address, prefix, family] of privateNetworkRules) {
  privateNetworkAddresses.addSubnet(address, prefix, family);
}

const addressPolicy = (address: string): AddressPolicy | null => {
  const version = isIP(address);
  if (version !== 4 && version !== 6) return null;
  const family: AddressFamily = version === 4 ? 'ipv4' : 'ipv6';
  return {
    loopback: loopbackAddresses.check(address, family),
    linkLocal: linkLocalAddresses.check(address, family),
    privateNetwork: privateNetworkAddresses.check(address, family),
    metadata: metadataAddresses.check(address, family),
  };
};

const resolvedAddresses = async (url: URL) => {
  const hostname = normalizeHost(url.hostname);
  if (isIP(hostname)) return [hostname];
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    const list = addresses.map((entry) => entry.address);
    if (!list.length || list.some((address) => !isIP(address))) throw new Error('invalid lookup result');
    return list;
  } catch {
    throw new ProviderInputError('连接地址无法解析。');
  }
};

export const assertAllowedDestination = async (parsed: ParsedProviderUrl) => {
  const policies = (await resolvedAddresses(parsed.url)).map(addressPolicy);
  if (policies.some((policy) => !policy)) throw new ProviderInputError('连接目标被本机安全策略拒绝。');
  const resolved = policies as AddressPolicy[];
  if (resolved.some((policy) => policy.linkLocal || policy.metadata)) {
    throw new ProviderInputError('连接目标被本机安全策略拒绝。');
  }
};
