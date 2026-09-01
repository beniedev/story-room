import type { FormEvent } from 'react';
import { Check, ChevronDown, KeyRound, Plus, PlugZap, ShieldCheck } from 'lucide-react';
import type { HostAccessTokenSettings } from '../api';
import type { ProviderProfile } from '../providerProfiles';

export type ProviderConnectionState = 'idle' | 'testing' | 'saving' | 'success' | 'error';
export type HostAccessState = 'idle' | 'saving' | 'success' | 'error';

export type ProviderSettingsProps = {
  currentProfile?: ProviderProfile;
  providerProfiles: ProviderProfile[];
  editingId: string;
  connectionState: ProviderConnectionState;
  profileDraft: ProviderProfile;
  apiKeyDraft: string;
  providerRuntime: 'host' | 'device';
  connectionStatus: string;
  hostAccessTokenSettings: HostAccessTokenSettings;
  hostAccessEnabled: boolean;
  hostAccessState: HostAccessState;
  hostAccessTokenDraft: string;
  hostAccessStatus: string;
  onRequestSettingsAction: (action: 'new' | ProviderProfile) => void;
  onClearConnectionResult: () => void;
  onProfileDraftChange: (recipe: (current: ProviderProfile) => ProviderProfile) => void;
  onApiKeyDraftChange: (value: string) => void;
  onSubmitProfile: (event: FormEvent) => void;
  onTestProfileConnection: () => void;
  onEnableHostAccess: () => void;
  onDisableHostAccess: () => void;
  onApplyHostAccessToken: (event: FormEvent) => void;
  onHostAccessTokenDraftChange: (value: string) => void;
};

export function ProviderSettings({
  currentProfile,
  providerProfiles,
  editingId,
  connectionState,
  profileDraft,
  apiKeyDraft,
  providerRuntime,
  connectionStatus,
  hostAccessTokenSettings,
  hostAccessEnabled,
  hostAccessState,
  hostAccessTokenDraft,
  hostAccessStatus,
  onRequestSettingsAction,
  onClearConnectionResult,
  onProfileDraftChange,
  onApiKeyDraftChange,
  onSubmitProfile,
  onTestProfileConnection,
  onEnableHostAccess,
  onDisableHostAccess,
  onApplyHostAccessToken,
  onHostAccessTokenDraftChange,
}: ProviderSettingsProps) {
  return (
    <>
    <section className="settings-section" aria-labelledby="provider-settings-heading">
      <h3 id="provider-settings-heading" className="sr-only">模型连接</h3>
      <details className="settings-subdrawer">
        <summary>
          <KeyRound aria-hidden="true" />
          <span><strong>模型连接</strong><small>{currentProfile ? `${currentProfile.name} · ${currentProfile.modelId}` : '保存并选择连接方案'}</small></span>
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="provider-settings-content">
          <div className="provider-profile-picker">
            <label htmlFor="provider-profile-select">连接方案</label>
            <div className="provider-profile-select-row">
              <select
                id="provider-profile-select"
                value={editingId}
                disabled={connectionState === 'saving' || connectionState === 'testing'}
                onChange={(event) => {
                  const profile = providerProfiles.find((item) => item.id === event.target.value);
                  if (profile) onRequestSettingsAction(profile);
                  else onRequestSettingsAction('new');
                }}
              >
                <option value="">新连接方案</option>
                {providerProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name} · {profile.modelId}</option>)}
              </select>
              <button type="button" className="icon-button" onClick={() => onRequestSettingsAction('new')} disabled={connectionState === 'saving' || connectionState === 'testing'} aria-label="新建连接方案" title="新建连接方案"><Plus aria-hidden="true" /></button>
            </div>
          </div>
          <form className="provider-profile-form" onSubmit={onSubmitProfile}>
            <label htmlFor="provider-profile-name">方案名称</label>
            <input id="provider-profile-name" name="provider-profile-name" required autoComplete="off" value={profileDraft.name} onChange={(event) => { onClearConnectionResult(); onProfileDraftChange((current) => ({ ...current, name: event.target.value })); }} placeholder="例如：主要模型" />

            <label htmlFor="provider-api-key">API Key</label>
            <input id="provider-api-key" name="provider-api-key" type="password" autoComplete="off" spellCheck={false} value={apiKeyDraft} onChange={(event) => { onClearConnectionResult(); onApiKeyDraftChange(event.target.value); }} placeholder="sk-…" />

            <label htmlFor="provider-base-url">URL</label>
            <input id="provider-base-url" name="provider-base-url" type="url" required autoComplete="url" spellCheck={false} value={profileDraft.baseUrl} onChange={(event) => { onClearConnectionResult(); onProfileDraftChange((current) => ({ ...current, baseUrl: event.target.value })); }} placeholder="https://api.example.com/v1" />

            <label htmlFor="provider-model-id">模型 ID</label>
            <input id="provider-model-id" name="provider-model-id" required autoComplete="off" spellCheck={false} value={profileDraft.modelId} onChange={(event) => { onClearConnectionResult(); onProfileDraftChange((current) => ({ ...current, modelId: event.target.value })); }} placeholder="model-id" />

            <div className="provider-number-grid">
              <label>最大上下文<input name="provider-max-context" type="number" inputMode="numeric" min="1" required value={profileDraft.maxContext} onChange={(event) => { onClearConnectionResult(); onProfileDraftChange((current) => ({ ...current, maxContext: Number(event.target.value) })); }} /></label>
              <label>最大输出<input name="provider-max-output" type="number" inputMode="numeric" min="1" required value={profileDraft.maxOutput} onChange={(event) => { onClearConnectionResult(); onProfileDraftChange((current) => ({ ...current, maxOutput: Number(event.target.value) })); }} /></label>
            </div>

            <p className="provider-secret-note">{providerRuntime === 'host'
              ? 'API Key 会以明文保存在本机配置文件（默认 .data/private/providers.json）中；不会写入书稿或浏览器。只有在你信任本机和 Provider 端点时才使用；留空可继续使用已保存的 Key。'
              : '仅在你信任当前页面和目标 URL 时输入 API Key；测试时临时 Key 会直接发送到填写的 URL，当前页面脚本可读取且不会持久化。'}</p>
            <div className="provider-form-actions">
              <button
                type="button"
                className="quiet-action button-with-icon provider-test-button"
                onClick={() => void onTestProfileConnection()}
                disabled={connectionState === 'testing' || connectionState === 'saving'}
                aria-busy={connectionState === 'testing' || undefined}
                aria-label="测试连接"
              ><PlugZap aria-hidden="true" />{connectionState === 'testing' ? '测试中' : '测试'}</button>
              <button type="submit" className="primary-action button-with-icon" disabled={connectionState === 'saving' || connectionState === 'testing'} aria-busy={connectionState === 'saving' || undefined}>
                <Check aria-hidden="true" />{connectionState === 'saving' ? '保存中…' : '保存连接方案'}
              </button>
            </div>
            <p className="provider-save-status" data-state={connectionState} role="status" aria-live="polite">
              {connectionStatus && <><span className="provider-status-dot" aria-hidden="true" />{connectionStatus}</>}
            </p>
          </form>
        </div>
      </details>
    </section>
    {providerRuntime === 'host' && (
      <section className="settings-section" aria-labelledby="host-access-heading">
        <h3 id="host-access-heading" className="sr-only">访问保护</h3>
        <details className="settings-subdrawer">
          <summary>
            <ShieldCheck aria-hidden="true" />
            <span><strong>访问密码（可选）</strong><small>{hostAccessTokenSettings.enabled ? '已启用' : '关闭'}</small></span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="host-access-settings">
            <label className="toggle-setting" htmlFor="host-access-toggle">
              <span><strong>启用访问密码</strong><small>默认关闭。只在需要密码才能打开书库时开启。</small></span>
              <input
                id="host-access-toggle"
                type="checkbox"
                role="switch"
                checked={hostAccessEnabled}
                disabled={hostAccessState === 'saving'}
                onChange={(event) => {
                  if (event.target.checked) {
                    onEnableHostAccess();
                  } else {
                    void onDisableHostAccess();
                  }
                }}
              />
            </label>
            {hostAccessEnabled && (
              <form className="host-access-form" onSubmit={onApplyHostAccessToken}>
                <label htmlFor="host-access-token">访问密码</label>
                <div className="host-access-input-row">
                  <input
                    id="host-access-token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={hostAccessTokenDraft}
                    onChange={(event) => {
                      onHostAccessTokenDraftChange(event.target.value);
                    }}
                    placeholder="输入访问密码"
                  />
                  <button type="submit" className="primary-action" disabled={hostAccessState === 'saving'}>
                    {hostAccessState === 'saving' ? '连接中…' : '保存并连接'}
                  </button>
                </div>
              </form>
            )}
            <p className="host-access-status" data-state={hostAccessState} role="status" aria-live="polite">
              {hostAccessStatus}
            </p>
          </div>
        </details>
      </section>
    )}
    </>
  );
}
