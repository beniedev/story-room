import { useEffect, useRef, useState, type RefObject } from 'react';
import { X } from 'lucide-react';
import type { ProviderProfile } from '../providerProfiles';
import type { ThemeName } from '../types';
import { ProviderSettings } from './ProviderSettings';
import { AppearanceSettings, type ManuscriptFontFamily } from './AppearanceSettings';
import { makeId } from './shared/id';
import { DialogOperationStatus, idleDialogOperation, useDismissSuccessfulDialog, type DialogOperationState } from './shared/DialogOperationStatus';

export function SettingsDrawer({
  dialogRef,
  theme,
  onThemeChange,
  manuscriptFontFamily,
  onManuscriptFontFamilyChange,
  manuscriptFontSize,
  onManuscriptFontSizeChange,
  streamingOutput,
  onStreamingOutputChange,
  providerProfiles,
  activeProviderProfileId,
  onSelectProviderProfile,
  onSaveProviderProfile,
  onTestProviderProfile,
  providerRuntime,
  onLoadStorageLocation,
  onClose,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  manuscriptFontFamily: ManuscriptFontFamily;
  onManuscriptFontFamilyChange: (font: ManuscriptFontFamily) => void;
  manuscriptFontSize: number;
  onManuscriptFontSizeChange: (size: number) => void;
  streamingOutput: boolean;
  onStreamingOutputChange: (enabled: boolean) => void;
  providerProfiles: ProviderProfile[];
  activeProviderProfileId: string;
  onSelectProviderProfile: (id: string) => void;
  onSaveProviderProfile: (profile: ProviderProfile, apiKey?: string) => Promise<ProviderProfile>;
  onTestProviderProfile: (profile: ProviderProfile, apiKey?: string) => Promise<{ ok: true; modelId: string }>;
  providerRuntime: 'host' | 'device';
  onLoadStorageLocation: () => Promise<{ location: string }>;
  onClose: () => void;
}) {
  const currentProfile = providerProfiles.find((profile) => profile.id === activeProviderProfileId)
    ?? providerProfiles[0];
  const blankProfile = (): ProviderProfile => ({
    id: '',
    name: '',
    kind: 'openai-compatible',
    baseUrl: '',
    modelId: '',
    maxContext: 128000,
    maxOutput: 8192,
  });
  const [editingId, setEditingId] = useState(currentProfile?.id ?? '');
  const [profileDraft, setProfileDraft] = useState<ProviderProfile>(() => currentProfile ? { ...currentProfile } : blankProfile());
  const [profileBaseline, setProfileBaseline] = useState<{ profile: ProviderProfile; key: string }>(() => ({
    profile: currentProfile ? { ...currentProfile } : blankProfile(),
    key: '',
  }));
  const [sessionKeys, setSessionKeys] = useState<Record<string, string>>({});
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('');
  const [connectionState, setConnectionState] = useState<'idle' | 'testing' | 'saving' | 'success' | 'error'>('idle');
  const [storageLocation, setStorageLocation] = useState('正在读取本地地址…');
  const [discardOperation, setDiscardOperation] = useState<DialogOperationState>(idleDialogOperation);
  const discardChangesDialog = useRef<HTMLDialogElement>(null);
  const [pendingSettingsAction, setPendingSettingsAction] = useState<'close' | 'new' | ProviderProfile | null>(null);
  useEffect(() => {
    let active = true;
    void onLoadStorageLocation()
      .then(({ location }) => {
        if (active) setStorageLocation(location);
      })
      .catch(() => {
        if (active) setStorageLocation('本地地址暂时无法读取');
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!currentProfile || editingId) return;
    setEditingId(currentProfile.id);
    setProfileDraft({ ...currentProfile });
    setProfileBaseline({ profile: { ...currentProfile }, key: sessionKeys[currentProfile.id] ?? '' });
  }, [currentProfile, editingId]);
  const performCloseDrawer = () => dialogRef.current?.close();
  const clearConnectionResult = () => {
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const selectProfile = (profile: ProviderProfile) => {
    onSelectProviderProfile(profile.id);
    setEditingId(profile.id);
    setProfileDraft({ ...profile });
    setApiKeyDraft(sessionKeys[profile.id] ?? '');
    setProfileBaseline({ profile: { ...profile }, key: sessionKeys[profile.id] ?? '' });
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const startNewProfile = () => {
    setEditingId('');
    setProfileDraft(blankProfile());
    setApiKeyDraft('');
    setProfileBaseline({ profile: blankProfile(), key: '' });
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const restoreProfileBaseline = () => {
    setEditingId(profileBaseline.profile.id);
    setProfileDraft({ ...profileBaseline.profile });
    setApiKeyDraft(profileBaseline.key);
    setConnectionStatus('');
    setConnectionState('idle');
  };
  const providerDraftChanged = () => {
    return JSON.stringify({ ...profileDraft, id: editingId }) !== JSON.stringify({ ...profileBaseline.profile, id: editingId })
      || apiKeyDraft !== profileBaseline.key;
  };
  const applySettingsAction = (action: 'close' | 'new' | ProviderProfile) => {
    setPendingSettingsAction(null);
    if (action === 'close') {
      performCloseDrawer();
      return;
    }
    if (action === 'new') {
      startNewProfile();
      return;
    }
    selectProfile(action);
  };
  const requestSettingsAction = (action: 'close' | 'new' | ProviderProfile) => {
    if (!providerDraftChanged()) {
      applySettingsAction(action);
      return;
    }
    setPendingSettingsAction(action);
    setDiscardOperation(idleDialogOperation);
    discardChangesDialog.current?.showModal();
  };
  const finishDiscardAction = () => {
    const action = pendingSettingsAction;
    discardChangesDialog.current?.close();
    if (action) applySettingsAction(action);
  };
  useDismissSuccessfulDialog(discardOperation.phase === 'success', finishDiscardAction);
  const submitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (connectionState === 'saving' || connectionState === 'testing') return;
    const id = editingId || makeId('provider');
    const profile: ProviderProfile = {
      ...profileDraft,
      id,
      name: profileDraft.name.trim(),
      baseUrl: profileDraft.baseUrl.trim(),
      modelId: profileDraft.modelId.trim(),
      maxContext: Math.max(1, Number(profileDraft.maxContext)),
      maxOutput: Math.max(1, Number(profileDraft.maxOutput)),
    };
    setConnectionState('saving');
    setConnectionStatus('正在保存连接方案…');
    try {
      const saved = await onSaveProviderProfile(profile, apiKeyDraft || undefined);
      setEditingId(saved.id);
      setProfileDraft(saved);
      setProfileBaseline({ profile: { ...saved }, key: providerRuntime === 'device' ? apiKeyDraft : '' });
      if (providerRuntime === 'device') {
        setSessionKeys((current) => ({ ...current, [saved.id]: apiKeyDraft }));
      } else {
        setApiKeyDraft('');
      }
      setConnectionStatus(providerRuntime === 'host'
        ? '连接方案已保存到本机私有配置。'
        : '连接方案已保存。API Key 只在当前页面临时保留。');
      setConnectionState('success');
    } catch (error) {
      setConnectionState('error');
      setConnectionStatus(error instanceof Error ? error.message : '连接方案保存失败。');
    }
  };
  const testProfileConnection = async () => {
    if (connectionState === 'saving' || connectionState === 'testing') return;
    const baseUrl = profileDraft.baseUrl.trim().replace(/\/+$/, '');
    const modelId = profileDraft.modelId.trim();
    if (!baseUrl || !modelId) {
      setConnectionState('error');
      setConnectionStatus('请先填写 URL 和模型 ID。');
      return;
    }

    let endpoint: URL;
    try {
      endpoint = new URL(`${baseUrl}/models`);
      if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') throw new Error();
    } catch {
      setConnectionState('error');
      setConnectionStatus('请填写以 http:// 或 https:// 开头的有效 URL。');
      return;
    }

    setConnectionState('testing');
    setConnectionStatus('正在测试连接…');
    try {
      await onTestProviderProfile({ ...profileDraft, baseUrl, modelId }, apiKeyDraft || undefined);
      setConnectionState('success');
      setConnectionStatus('已访问 /models，模型列表已返回；未验证实际生成参数。');
    } catch (error) {
      setConnectionState('error');
      setConnectionStatus(error instanceof Error ? error.message : '无法连接。');
    }
  };
  return (
    <dialog
      className="settings-drawer"
      ref={dialogRef}
      onClick={(event) => { if (event.target === event.currentTarget) requestSettingsAction('close'); }}
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); requestSettingsAction('close'); }}
      aria-labelledby="settings-title"
    >
      <header className="drawer-heading">
        <div>
          <p className="eyebrow">界面偏好</p>
          <h2 id="settings-title">设置</h2>
        </div>
        <button type="button" className="icon-button" autoFocus onClick={() => requestSettingsAction('close')} aria-label="关闭设置" title="关闭设置"><X aria-hidden="true" /></button>
      </header>
      <AppearanceSettings
        theme={theme}
        onThemeChange={onThemeChange}
        manuscriptFontFamily={manuscriptFontFamily}
        onManuscriptFontFamilyChange={onManuscriptFontFamilyChange}
        manuscriptFontSize={manuscriptFontSize}
        onManuscriptFontSizeChange={onManuscriptFontSizeChange}
        streamingOutput={streamingOutput}
        onStreamingOutputChange={onStreamingOutputChange}
      />
      <ProviderSettings
        currentProfile={currentProfile}
        providerProfiles={providerProfiles}
        editingId={editingId}
        connectionState={connectionState}
        profileDraft={profileDraft}
        apiKeyDraft={apiKeyDraft}
        providerRuntime={providerRuntime}
        connectionStatus={connectionStatus}
        onRequestSettingsAction={(action) => requestSettingsAction(action)}
        onClearConnectionResult={clearConnectionResult}
        onProfileDraftChange={(recipe) => setProfileDraft(recipe)}
        onApiKeyDraftChange={setApiKeyDraft}
        onSubmitProfile={submitProfile}
        onTestProfileConnection={() => void testProfileConnection()}
      />

      <section className="settings-section" aria-labelledby="storage-heading">
        <h3 id="storage-heading">保存位置</h3>
        <p className="helper-copy storage-copy">
          正文和资料保存在本地：<span className="storage-location">{storageLocation}</span><br />
          可以使用导出功能，导出为其他格式的文件。
        </p>
      </section>
      <dialog
        className="confirm-dialog"
        ref={discardChangesDialog}
        onClose={() => setDiscardOperation(idleDialogOperation)}
        onCancel={(event) => {
          event.preventDefault();
          if (discardOperation.phase === 'success') finishDiscardAction();
          else discardChangesDialog.current?.close();
        }}
        aria-labelledby="discard-provider-dialog-title"
        aria-describedby={discardOperation.phase === 'idle' ? 'discard-provider-dialog-description' : undefined}
      >
        <header className="dialog-heading">
          <h2 id="discard-provider-dialog-title">放弃未保存修改？</h2>
          <button type="button" className="icon-button" onClick={() => discardChangesDialog.current?.close()} aria-label="取消放弃修改" title="取消"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body">
          {discardOperation.phase === 'idle' ? (
            <>
              <p id="discard-provider-dialog-description">当前连接方案有未保存的修改；放弃后才会继续下一步。</p>
              <div className="dialog-actions">
                <button type="button" className="quiet-action" onClick={() => discardChangesDialog.current?.close()}>继续编辑</button>
                <button
                  type="button"
                  className="danger-action"
                  onClick={() => {
                    restoreProfileBaseline();
                    setDiscardOperation({ phase: 'success', title: '已放弃修改' });
                  }}
                >放弃并继续</button>
              </div>
            </>
          ) : (
            <DialogOperationStatus state={discardOperation} />
          )}
        </div>
      </dialog>
    </dialog>
  );
}
