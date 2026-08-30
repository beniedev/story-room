import { describe, expect, it } from 'vitest';
import {
  defaultProviderProfiles,
  readProviderProfiles,
  upsertProviderProfile,
  type ProviderProfile,
} from '../src/providerProfiles';

describe('provider profile persistence', () => {
  it('falls back to synthetic profiles when stored data is unavailable', () => {
    expect(readProviderProfiles(null)).toEqual(defaultProviderProfiles);
    expect(readProviderProfiles('{broken')).toEqual(defaultProviderProfiles);
  });

  it('updates one profile without storing an API key', () => {
    const profile = {
      ...defaultProviderProfiles[0],
      modelId: 'replacement-model',
      apiKey: 'must-not-persist',
    } as ProviderProfile & { apiKey: string };

    const updated = upsertProviderProfile(defaultProviderProfiles, profile);

    expect(updated[0].modelId).toBe('replacement-model');
    expect(updated[0]).not.toHaveProperty('apiKey');
    expect(updated[1]).toEqual(defaultProviderProfiles[1]);
  });

  it('drops secret-shaped extra fields from imported profile metadata', () => {
    const stored = JSON.stringify([{ ...defaultProviderProfiles[0], apiKey: 'must-not-persist' }]);
    expect(readProviderProfiles(stored)[0]).not.toHaveProperty('apiKey');
  });
});
