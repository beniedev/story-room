import path from 'node:path';
import type { ProviderProfile } from '../src/providerProfiles.ts';
import type { PromptMessage, ProviderLimits } from '../src/types.ts';
import type { ProviderGenerationResult } from './providerResult.ts';
import { ProviderInputError } from './providers/errors.ts';
import { readProviderConfig, resolveProviderCredentials, saveProviderProfile } from './providers/config.ts';
import { generateProviderCompletion, testProviderConnection, type ProviderGenerationOptions } from './providers/completionClient.ts';
import { safeProfile, type ProviderConfig, type StoredProviderProfile } from './providers/profiles.ts';

export { ProviderCancelledError, ProviderConnectionError, ProviderInputError } from './providers/errors.ts';
export type { ProviderGenerationOptions } from './providers/completionClient.ts';

export class ProviderStore {
  readonly file: string;

  constructor(
    file = process.env.STORY_PROVIDER_CONFIG ?? path.resolve('.data/private/providers.json'),
  ) {
    this.file = file;
  }

  private async readConfig(): Promise<ProviderConfig> {
    return readProviderConfig(this.file);
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
    return saveProviderProfile(this.file, profile, apiKey);
  }

  private async resolve(profileId: string): Promise<StoredProviderProfile> {
    const profile = (await this.readConfig()).profiles.find((item) => item.id === profileId);
    if (!profile) throw new ProviderInputError('找不到所选连接方案。');
    return profile;
  }

  private async credentials(profile: ProviderProfile, apiKey?: string): Promise<StoredProviderProfile> {
    return resolveProviderCredentials(await this.readConfig(), profile, apiKey);
  }

  async test(profile: ProviderProfile, apiKey?: string): Promise<{ ok: true; modelId: string }> {
    return testProviderConnection(await this.credentials(profile, apiKey));
  }

  async generate(
    profileId: string,
    messages: PromptMessage[],
    externalSignal?: AbortSignal,
    options: ProviderGenerationOptions = {},
  ): Promise<ProviderGenerationResult | null> {
    return generateProviderCompletion(await this.resolve(profileId), messages, externalSignal, options);
  }
}
