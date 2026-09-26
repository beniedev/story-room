import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultProviderProfiles, type ProviderProfile } from '../../src/providerProfiles.ts';
import { ProviderInputError } from './errors.ts';
import { sameProviderIdentity } from './destinationPolicy.ts';
import { normalizeApiKey, safeProfile, validateProfile, type ProviderConfig, type StoredProviderProfile } from './profiles.ts';

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

export const readProviderConfig = async (file: string): Promise<ProviderConfig> => {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as ProviderConfig;
    if (!parsed || !Array.isArray(parsed.profiles)) throw new Error('invalid config');
    for (const profile of parsed.profiles) validateProfile(profile);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { profiles: defaultProviderProfiles.map((profile) => ({ ...profile })) };
    }
    throw new ProviderInputError('本机 Provider 配置无效。');
  }
};

export const saveProviderProfile = async (file: string, profile: ProviderProfile, apiKey?: string): Promise<ProviderProfile> => {
  validateProfile(profile);
  const config = await readProviderConfig(file);
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
  await atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`);
  return safeProfile(stored);
};

export const resolveProviderCredentials = (config: ProviderConfig, profile: ProviderProfile, apiKey?: string): StoredProviderProfile => {
  const stored = config.profiles.find((item) => item.id === profile.id);
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
};
