import { isValidProviderLimit, MAX_PROVIDER_CONTEXT_TOKENS, MAX_PROVIDER_OUTPUT_TOKENS, type ProviderProfile } from '../../src/providerProfiles.ts';
import { ProviderInputError } from './errors.ts';
import { parseProviderUrl } from './destinationPolicy.ts';

export type StoredProviderProfile = ProviderProfile & {
  apiKey?: string;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  reasoningEffort?: string;
  verbosity?: string;
};

export type ProviderConfig = { profiles: StoredProviderProfile[] };

export const normalizeApiKey = (apiKey?: string) => typeof apiKey === 'string' ? apiKey.trim() : '';

export const safeProfile = (profile: StoredProviderProfile): ProviderProfile => ({
  id: profile.id,
  name: profile.name,
  kind: profile.kind,
  baseUrl: profile.baseUrl,
  modelId: profile.modelId,
  maxContext: profile.maxContext,
  maxOutput: profile.maxOutput,
});

export const validateProfile = (profile: ProviderProfile) => {
  if (!profile || typeof profile !== 'object') throw new ProviderInputError('连接方案数据无效。');
  if (typeof profile.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(profile.id)) {
    throw new ProviderInputError('连接方案 ID 无效。');
  }
  if (typeof profile.name !== 'string' || typeof profile.modelId !== 'string'
    || !profile.name.trim() || !profile.modelId.trim()) {
    throw new ProviderInputError('连接方案名称和模型 ID 不能为空。');
  }
  if (profile.kind !== 'fake' && profile.kind !== 'openai-compatible') throw new ProviderInputError('连接方案类型无效。');
  if (!isValidProviderLimit(profile.maxContext, MAX_PROVIDER_CONTEXT_TOKENS)
    || !isValidProviderLimit(profile.maxOutput, MAX_PROVIDER_OUTPUT_TOKENS)) {
    throw new ProviderInputError('上下文与输出上限必须是合理的正整数。');
  }
  if (typeof profile.baseUrl !== 'string') throw new ProviderInputError('连接地址必须是有效 URL。');
  parseProviderUrl(profile.baseUrl);
};
