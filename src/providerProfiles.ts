export interface ProviderProfile {
  id: string;
  name: string;
  kind: 'fake' | 'openai-compatible';
  baseUrl: string;
  modelId: string;
  maxContext: number;
  maxOutput: number;
}

export const PROVIDER_PROFILES_STORAGE_KEY = 'story-native:provider-profiles';
export const MAX_PROVIDER_CONTEXT_TOKENS = 10_000_000;
export const MAX_PROVIDER_OUTPUT_TOKENS = 1_000_000;

export const isValidProviderLimit = (value: number, maximum: number) => (
  Number.isSafeInteger(value) && value > 0 && value <= maximum
);

export const defaultProviderProfiles: ProviderProfile[] = [
  {
    id: 'provider-primary',
    name: '主要模型',
    kind: 'fake',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'example-model',
    maxContext: 128000,
    maxOutput: 8192,
  },
  {
    id: 'provider-draft',
    name: '快速草稿',
    kind: 'fake',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'example-model-fast',
    maxContext: 32000,
    maxOutput: 4096,
  },
];

const isProviderProfile = (value: unknown): value is ProviderProfile => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProviderProfile>;
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && (candidate.kind === 'fake' || candidate.kind === 'openai-compatible')
    && typeof candidate.baseUrl === 'string'
    && typeof candidate.modelId === 'string'
    && typeof candidate.maxContext === 'number'
    && typeof candidate.maxOutput === 'number'
    && isValidProviderLimit(candidate.maxContext, MAX_PROVIDER_CONTEXT_TOKENS)
    && isValidProviderLimit(candidate.maxOutput, MAX_PROVIDER_OUTPUT_TOKENS);
};

const normalizeProviderProfile = (profile: ProviderProfile): ProviderProfile => ({
  id: profile.id,
  name: profile.name,
  kind: profile.kind,
  baseUrl: profile.baseUrl,
  modelId: profile.modelId,
  maxContext: Number(profile.maxContext),
  maxOutput: Number(profile.maxOutput),
});

export const readProviderProfiles = (stored: string | null): ProviderProfile[] => {
  if (!stored) return defaultProviderProfiles.map((profile) => ({ ...profile }));
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return defaultProviderProfiles.map((profile) => ({ ...profile }));
    const profiles = parsed.filter(isProviderProfile).map(normalizeProviderProfile);
    return profiles.length ? profiles : defaultProviderProfiles.map((profile) => ({ ...profile }));
  } catch {
    return defaultProviderProfiles.map((profile) => ({ ...profile }));
  }
};

export const upsertProviderProfile = (profiles: ProviderProfile[], profile: ProviderProfile) => {
  const normalized = normalizeProviderProfile(profile);
  const exists = profiles.some((item) => item.id === profile.id);
  return exists
    ? profiles.map((item) => item.id === profile.id ? normalized : item)
    : [...profiles, normalized];
};
