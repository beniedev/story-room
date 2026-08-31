import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultProviderProfiles, type ProviderProfile } from '../src/providerProfiles.ts';

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

export class ProviderInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderInputError';
  }
}

export class ProviderConnectionError extends Error {
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = 'ProviderConnectionError';
  }
}

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
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(profile.id)) throw new ProviderInputError('连接方案 ID 无效。');
  if (!profile.name.trim() || !profile.modelId.trim()) throw new ProviderInputError('连接方案名称和模型 ID 不能为空。');
  if (profile.kind !== 'fake' && profile.kind !== 'openai-compatible') throw new ProviderInputError('连接方案类型无效。');
  if (!Number.isFinite(profile.maxContext) || profile.maxContext <= 0
    || !Number.isFinite(profile.maxOutput) || profile.maxOutput <= 0) {
    throw new ProviderInputError('上下文与输出上限必须是正数。');
  }
  let url: URL;
  try {
    url = new URL(profile.baseUrl);
  } catch {
    throw new ProviderInputError('连接地址必须是有效 URL。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderInputError('连接地址只支持 http:// 或 https://。');
  }
};

const endpoint = (baseUrl: string, suffix: string) => `${baseUrl.replace(/\/+$/, '')}/${suffix}`;

const atomicWrite = async (file: string, content: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

const readErrorStatus = (status: number) => status === 401 || status === 403
  ? 'Provider 拒绝了本机凭据。'
  : `Provider 返回 HTTP ${status}。`;

export class ProviderStore {
  readonly file: string;

  constructor(file = process.env.STORY_PROVIDER_CONFIG ?? path.resolve('.data/private/providers.json')) {
    this.file = file;
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

  async save(profile: ProviderProfile, apiKey?: string): Promise<ProviderProfile> {
    validateProfile(profile);
    const config = await this.readConfig();
    const existing = config.profiles.find((item) => item.id === profile.id);
    const stored: StoredProviderProfile = {
      ...profile,
      apiKey: apiKey?.trim() || existing?.apiKey,
    };
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
    const candidate: StoredProviderProfile = { ...stored, ...profile, apiKey: apiKey?.trim() || stored?.apiKey };
    validateProfile(candidate);
    if (candidate.kind === 'openai-compatible' && !candidate.apiKey) {
      throw new ProviderInputError('请填写 API Key。');
    }
    return candidate;
  }

  async test(profile: ProviderProfile, apiKey?: string): Promise<{ ok: true; modelId: string }> {
    const candidate = await this.credentials(profile, apiKey);
    if (candidate.kind === 'fake') return { ok: true, modelId: candidate.modelId };
    let response: Response;
    try {
      response = await fetch(endpoint(candidate.baseUrl, 'models'), {
        headers: { Accept: 'application/json', Authorization: `Bearer ${candidate.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ProviderConnectionError('无法连接本机 Provider。');
    }
    if (!response.ok) throw new ProviderConnectionError(readErrorStatus(response.status));
    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    const ids = Array.isArray(payload.data)
      ? payload.data.map((item) => item?.id).filter((id): id is string => typeof id === 'string')
      : [];
    if (ids.length && !ids.includes(candidate.modelId)) {
      throw new ProviderConnectionError('连接成功，但模型列表中没有这个模型 ID。');
    }
    return { ok: true, modelId: candidate.modelId };
  }

  async generate(profileId: string, prompt: string): Promise<string | null> {
    const profile = await this.resolve(profileId);
    if (profile.kind === 'fake') return null;
    if (!profile.apiKey) throw new ProviderInputError('所选连接方案没有本机 API Key。');
    const body = {
      model: profile.modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: profile.maxOutput,
      temperature: profile.temperature ?? 1,
      top_p: profile.topP ?? 1,
      frequency_penalty: profile.frequencyPenalty ?? 0,
      presence_penalty: profile.presencePenalty ?? 0,
      ...(profile.reasoningEffort ? { reasoning_effort: profile.reasoningEffort } : {}),
      ...(profile.verbosity ? { verbosity: profile.verbosity } : {}),
    };
    let response: Response;
    try {
      response = await fetch(endpoint(profile.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${profile.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch {
      throw new ProviderConnectionError('本机 Provider 调用失败。');
    }
    if (!response.ok) throw new ProviderConnectionError(readErrorStatus(response.status));
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const joined = content.map((item) => (
        item && typeof item === 'object' && 'text' in item && typeof item.text === 'string' ? item.text : ''
      )).join('').trim();
      if (joined) return joined;
    }
    throw new ProviderConnectionError('Provider 没有返回可写入正文的文本。');
  }
}
