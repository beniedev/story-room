import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { defaultProviderProfiles, type ProviderProfile } from '../src/providerProfiles.ts';
import type { PromptMessage, ProviderLimits } from '../src/types.ts';

type StoredProviderProfile = ProviderProfile & {
  apiKey?: string;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  reasoningEffort?: string;
  verbosity?: string;
};

type ProviderConfig = { profiles: StoredProviderProfile[] };

export type ProviderStoreOptions = {
  allowPrivateNetwork?: boolean;
};

export class ProviderInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderInputError';
  }
}

export class ProviderConnectionError extends Error {
  readonly statusCode: number = 502;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderConnectionError';
  }
}

/** The caller stopped waiting before the Provider finished. */
export class ProviderCancelledError extends ProviderConnectionError {
  readonly statusCode = 499;

  constructor() {
    super('生成已取消。');
    this.name = 'ProviderCancelledError';
  }
}

/** The Provider did not finish within the generation timeout. */
export class ProviderTimeoutError extends ProviderConnectionError {
  readonly statusCode = 504;

  constructor() {
    super('本机 Provider 调用超时。');
    this.name = 'ProviderTimeoutError';
  }
}

export const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

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

const normalizeApiKey = (apiKey?: string) => typeof apiKey === 'string' ? apiKey.trim() : '';

const normalizeHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host.endsWith('.') ? host.slice(0, -1) : host;
};

const hostForUrl = (hostname: string) => hostname.includes(':') ? `[${hostname}]` : hostname;

const normalizedPath = (pathname: string) => pathname.replace(/\/+$/, '') || '/';

const parseProviderUrl = (baseUrl: string): ParsedProviderUrl => {
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

const sameProviderIdentity = (
  first: Pick<ProviderProfile, 'kind' | 'baseUrl'> | undefined,
  second: Pick<ProviderProfile, 'kind' | 'baseUrl'>,
) => Boolean(first && providerIdentity(first) === providerIdentity(second));

const safeProfile = (profile: StoredProviderProfile): ProviderProfile => ({
  id: profile.id,
  name: profile.name,
  kind: profile.kind,
  baseUrl: profile.baseUrl,
  modelId: profile.modelId,
  maxContext: profile.maxContext,
  maxOutput: profile.maxOutput,
});

const validateProfile = (profile: ProviderProfile) => {
  if (!profile || typeof profile !== 'object') throw new ProviderInputError('连接方案数据无效。');
  if (typeof profile.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(profile.id)) {
    throw new ProviderInputError('连接方案 ID 无效。');
  }
  if (typeof profile.name !== 'string' || typeof profile.modelId !== 'string'
    || !profile.name.trim() || !profile.modelId.trim()) {
    throw new ProviderInputError('连接方案名称和模型 ID 不能为空。');
  }
  if (profile.kind !== 'fake' && profile.kind !== 'openai-compatible') throw new ProviderInputError('连接方案类型无效。');
  if (!Number.isFinite(profile.maxContext) || profile.maxContext <= 0
    || !Number.isFinite(profile.maxOutput) || profile.maxOutput <= 0) {
    throw new ProviderInputError('上下文与输出上限必须是正数。');
  }
  if (typeof profile.baseUrl !== 'string') throw new ProviderInputError('连接地址必须是有效 URL。');
  parseProviderUrl(profile.baseUrl);
};

const endpoint = (baseUrl: URL, suffix: string) => {
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

const assertAllowedDestination = async (parsed: ParsedProviderUrl, allowPrivateNetwork: boolean) => {
  const policies = (await resolvedAddresses(parsed.url)).map(addressPolicy);
  if (policies.some((policy) => !policy)) throw new ProviderInputError('连接目标被本机安全策略拒绝。');
  const resolved = policies as AddressPolicy[];
  if (resolved.some((policy) => policy.linkLocal || policy.metadata)) {
    throw new ProviderInputError('连接目标被本机安全策略拒绝。');
  }
  const allLoopback = resolved.every((policy) => policy.loopback);
  if (parsed.url.protocol === 'http:') {
    if (!allLoopback) throw new ProviderInputError('非回环 Provider 只允许使用 HTTPS。');
    return;
  }
  const hasPrivateNetwork = resolved.some((policy) => policy.privateNetwork || policy.loopback);
  if (hasPrivateNetwork && !allowPrivateNetwork) {
    throw new ProviderInputError('私有网络 Provider 需要显式启用。');
  }
};

const responseContentLength = (response: Response) => {
  try {
    const value = response.headers?.get('content-length');
    if (!value) return null;
    const length = Number(value);
    return Number.isSafeInteger(length) && length >= 0 ? length : null;
  } catch {
    return null;
  }
};

const oversizedResponse = () => new ProviderConnectionError('Provider 响应过大。');

const readJsonWithinLimit = async (response: Response): Promise<unknown> => {
  const contentLength = responseContentLength(response);
  if (contentLength !== null && contentLength > MAX_PROVIDER_RESPONSE_BYTES) throw oversizedResponse();

  let payloadText: string;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > MAX_PROVIDER_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw oversizedResponse();
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof ProviderConnectionError) throw error;
      throw new ProviderConnectionError('Provider 响应读取失败。');
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    payloadText = new TextDecoder().decode(bytes);
  } else if (typeof response.arrayBuffer === 'function') {
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_PROVIDER_RESPONSE_BYTES) throw oversizedResponse();
      payloadText = new TextDecoder().decode(bytes);
    } catch (error) {
      if (error instanceof ProviderConnectionError) throw error;
      throw new ProviderConnectionError('Provider 响应读取失败。');
    }
  } else {
    try {
      const payload = await response.json();
      const serialized = JSON.stringify(payload);
      if (serialized && new TextEncoder().encode(serialized).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
        throw oversizedResponse();
      }
      return payload;
    } catch (error) {
      if (error instanceof ProviderConnectionError) throw error;
      throw new ProviderConnectionError('Provider 响应读取失败。');
    }
  }

  try {
    return JSON.parse(payloadText) as unknown;
  } catch {
    throw new ProviderConnectionError('Provider 返回的数据无效。');
  }
};

const atomicWrite = async (file: string, content: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
    if (process.platform !== 'win32') await chmod(file, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

const readErrorStatus = (status: number) => status === 401 || status === 403
  ? 'Provider 拒绝了本机凭据。'
  : `Provider 返回 HTTP ${status}。`;

const GENERATION_TIMEOUT_MS = 180_000;

type ProviderAbortCause = 'external' | 'timeout';

type LinkedProviderAbort = {
  signal: AbortSignal;
  cause: () => ProviderAbortCause | undefined;
  cleanup: () => void;
};

/**
 * Combine the request lifetime with the existing Provider timeout while
 * retaining which one won the race. The listener and timer are always
 * removed by the generation finally block.
 */
const linkProviderAbort = (externalSignal?: AbortSignal): LinkedProviderAbort => {
  const controller = new AbortController();
  let abortCause: ProviderAbortCause | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const abortFromExternal = () => {
    if (abortCause) return;
    abortCause = 'external';
    controller.abort();
  };

  if (externalSignal?.aborted) {
    abortFromExternal();
  } else if (externalSignal) {
    externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }

  if (!abortCause) {
    timeout = setTimeout(() => {
      if (abortCause) return;
      abortCause = 'timeout';
      controller.abort();
    }, GENERATION_TIMEOUT_MS);
  }

  return {
    signal: controller.signal,
    cause: () => abortCause,
    cleanup: () => {
      if (timeout !== undefined) clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
};

const errorForAbortCause = (cause: ProviderAbortCause) => (
  cause === 'external' ? new ProviderCancelledError() : new ProviderTimeoutError()
);

export class ProviderStore {
  readonly file: string;
  readonly allowPrivateNetwork: boolean;

  constructor(
    file = process.env.STORY_PROVIDER_CONFIG ?? path.resolve('.data/private/providers.json'),
    options: ProviderStoreOptions = {},
  ) {
    this.file = file;
    this.allowPrivateNetwork = options.allowPrivateNetwork === true;
  }

  private async readConfig(): Promise<ProviderConfig> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as ProviderConfig;
      if (!parsed || !Array.isArray(parsed.profiles)) throw new Error('invalid config');
      for (const profile of parsed.profiles) validateProfile(profile);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { profiles: defaultProviderProfiles.map((profile) => ({ ...profile })) };
      }
      throw new ProviderInputError('本机 Provider 配置无效。');
    }
  }

  async list(): Promise<ProviderProfile[]> {
    return (await this.readConfig()).profiles.map(safeProfile);
  }

  async getContextLimits(profileId?: string): Promise<ProviderLimits> {
    const profiles = (await this.readConfig()).profiles;
    const profile = profileId ? profiles.find((item) => item.id === profileId) : profiles[0];
    if (!profile) throw new ProviderInputError('找不到所选连接方案。');
    return { maxContext: profile.maxContext, maxOutput: profile.maxOutput };
  }

  async save(profile: ProviderProfile, apiKey?: string): Promise<ProviderProfile> {
    validateProfile(profile);
    const config = await this.readConfig();
    const existing = config.profiles.find((item) => item.id === profile.id);
    const suppliedKey = normalizeApiKey(apiKey);
    const reusedKey = sameProviderIdentity(existing, profile) ? normalizeApiKey(existing?.apiKey) : '';
    const stored: StoredProviderProfile = { ...profile };
    if (stored.kind === 'openai-compatible') stored.apiKey = suppliedKey || reusedKey;
    else delete stored.apiKey;
    if (stored.kind === 'openai-compatible' && !stored.apiKey) {
      throw new ProviderInputError('OpenAI-compatible 连接需要 API Key。');
    }
    const next = {
      profiles: [...config.profiles.filter((item) => item.id !== profile.id), stored],
    };
    await atomicWrite(this.file, `${JSON.stringify(next, null, 2)}\n`);
    return safeProfile(stored);
  }

  private async resolve(profileId: string): Promise<StoredProviderProfile> {
    const profile = (await this.readConfig()).profiles.find((item) => item.id === profileId);
    if (!profile) throw new ProviderInputError('找不到所选连接方案。');
    return profile;
  }

  private async credentials(profile: ProviderProfile, apiKey?: string): Promise<StoredProviderProfile> {
    const stored = (await this.readConfig()).profiles.find((item) => item.id === profile.id);
    const suppliedKey = normalizeApiKey(apiKey);
    const candidate: StoredProviderProfile = { ...profile };
    if (sameProviderIdentity(stored, profile)) {
      Object.assign(candidate, stored);
      Object.assign(candidate, profile);
    }
    if (candidate.kind === 'openai-compatible') {
      candidate.apiKey = suppliedKey || (
        sameProviderIdentity(stored, profile) ? normalizeApiKey(stored?.apiKey) : ''
      );
    } else {
      delete candidate.apiKey;
    }
    validateProfile(candidate);
    if (candidate.kind === 'openai-compatible' && !candidate.apiKey) {
      throw new ProviderInputError('请填写 API Key。');
    }
    return candidate;
  }

  async test(profile: ProviderProfile, apiKey?: string): Promise<{ ok: true; modelId: string }> {
    const candidate = await this.credentials(profile, apiKey);
    if (candidate.kind === 'fake') return { ok: true, modelId: candidate.modelId };
    const parsed = parseProviderUrl(candidate.baseUrl);
    await assertAllowedDestination(parsed, this.allowPrivateNetwork);
    let response: Response;
    try {
      response = await fetch(endpoint(parsed.url, 'models'), {
        headers: { Accept: 'application/json', Authorization: `Bearer ${candidate.apiKey}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ProviderConnectionError('无法连接本机 Provider。');
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ProviderConnectionError('Provider 重定向被拒绝。');
    }
    if (!response.ok) throw new ProviderConnectionError(readErrorStatus(response.status));
    const payload = await readJsonWithinLimit(response) as { data?: Array<{ id?: unknown }> };
    const ids = Array.isArray(payload.data)
      ? payload.data.map((item) => item?.id).filter((id): id is string => typeof id === 'string')
      : [];
    if (ids.length && !ids.includes(candidate.modelId)) {
      throw new ProviderConnectionError('连接成功，但模型列表中没有这个模型 ID。');
    }
    return { ok: true, modelId: candidate.modelId };
  }

  async generate(
    profileId: string,
    messages: PromptMessage[],
    externalSignal?: AbortSignal,
  ): Promise<string | null> {
    const profile = await this.resolve(profileId);
    if (externalSignal?.aborted) throw new ProviderCancelledError();
    if (profile.kind === 'fake') return null;
    const apiKey = normalizeApiKey(profile.apiKey);
    if (!apiKey) throw new ProviderInputError('所选连接方案没有本机 API Key。');
    const body = {
      model: profile.modelId,
      messages: messages.map(({ role, content }) => ({ role, content })),
      max_tokens: profile.maxOutput,
      temperature: profile.temperature ?? 1,
      top_p: profile.topP ?? 1,
      frequency_penalty: profile.frequencyPenalty ?? 0,
      presence_penalty: profile.presencePenalty ?? 0,
      ...(profile.reasoningEffort ? { reasoning_effort: profile.reasoningEffort } : {}),
      ...(profile.verbosity ? { verbosity: profile.verbosity } : {}),
    };
    const parsed = parseProviderUrl(profile.baseUrl);
    await assertAllowedDestination(parsed, this.allowPrivateNetwork);
    if (externalSignal?.aborted) throw new ProviderCancelledError();

    const linkedAbort = linkProviderAbort(externalSignal);
    try {
      let response: Response;
      try {
        response = await fetch(endpoint(parsed.url, 'chat/completions'), {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          redirect: 'manual',
          signal: linkedAbort.signal,
        });
      } catch {
        const cause = linkedAbort.cause();
        if (cause) throw errorForAbortCause(cause);
        throw new ProviderConnectionError('本机 Provider 调用失败。');
      }
      const causeAfterFetch = linkedAbort.cause();
      if (causeAfterFetch) throw errorForAbortCause(causeAfterFetch);
      if (response.status >= 300 && response.status < 400) {
        throw new ProviderConnectionError('Provider 重定向被拒绝。');
      }
      if (!response.ok) throw new ProviderConnectionError(readErrorStatus(response.status));

      let payload: {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      try {
        payload = await readJsonWithinLimit(response) as typeof payload;
      } catch (error) {
        const cause = linkedAbort.cause();
        if (cause) throw errorForAbortCause(cause);
        throw error;
      }
      const causeAfterBody = linkedAbort.cause();
      if (causeAfterBody) throw errorForAbortCause(causeAfterBody);
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) return content.trim();
      if (Array.isArray(content)) {
        const joined = content.map((item) => (
          item && typeof item === 'object' && 'text' in item && typeof item.text === 'string' ? item.text : ''
        )).join('').trim();
        if (joined) return joined;
      }
      throw new ProviderConnectionError('Provider 没有返回可写入正文的文本。');
    } catch (error) {
      const cause = linkedAbort.cause();
      if (cause) throw errorForAbortCause(cause);
      if (error instanceof ProviderInputError || error instanceof ProviderConnectionError) throw error;
      throw new ProviderConnectionError('本机 Provider 调用失败。');
    } finally {
      linkedAbort.cleanup();
    }
  }
}
