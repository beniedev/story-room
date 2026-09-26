import { deviceLibrary } from '../deviceLibrary';
import {
  isValidProviderLimit,
  MAX_PROVIDER_CONTEXT_TOKENS,
  MAX_PROVIDER_OUTPUT_TOKENS,
  PROVIDER_PROFILES_STORAGE_KEY,
  readProviderProfiles,
  type ProviderProfile,
} from '../providerProfiles';

const testDeviceProvider = async (profile: ProviderProfile, apiKey?: string) => {
  if (!isValidProviderLimit(profile.maxContext, MAX_PROVIDER_CONTEXT_TOKENS)
    || !isValidProviderLimit(profile.maxOutput, MAX_PROVIDER_OUTPUT_TOKENS)) {
    throw new Error('上下文与输出上限必须是合理的正整数。');
  }
  if (profile.kind === 'fake') return { ok: true as const, modelId: profile.modelId };
  if (!apiKey?.trim()) throw new Error('请填写 API Key。');
  const response = await fetch(`${profile.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? '连接失败：API Key 无效或没有权限。'
    : `连接失败：服务返回 HTTP ${response.status}。`);
  const payload = await response.json() as { data?: Array<{ id?: unknown }> };
  const ids = Array.isArray(payload.data)
    ? payload.data.map((item) => item?.id).filter((id): id is string => typeof id === 'string')
    : [];
  if (ids.length && !ids.includes(profile.modelId)) throw new Error('连接成功，但模型列表中没有这个模型 ID。');
  return { ok: true as const, modelId: profile.modelId };
};

const deviceProviderApi = {
  listProviderProfiles: async () => readProviderProfiles(
    typeof localStorage === 'undefined' ? null : localStorage.getItem(PROVIDER_PROFILES_STORAGE_KEY),
  ),
  saveProviderProfile: async (profile: ProviderProfile) => {
    if (!isValidProviderLimit(profile.maxContext, MAX_PROVIDER_CONTEXT_TOKENS)
      || !isValidProviderLimit(profile.maxOutput, MAX_PROVIDER_OUTPUT_TOKENS)) {
      throw new Error('上下文与输出上限必须是合理的正整数。');
    }
    return profile;
  },
  testProviderProfile: testDeviceProvider,
};

export const deviceApi = {
  runtime: 'device' as const,
  ...deviceLibrary,
  ...deviceProviderApi,
  storageLocation: async () => ({ location: `浏览器本地存储（${window.location.origin}）` }),
};
