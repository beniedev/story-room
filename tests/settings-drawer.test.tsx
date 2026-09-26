// @vitest-environment jsdom

import { act, createRef, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SettingsDrawer } from '../src/components/SettingsDrawer';
import type { ProviderProfile } from '../src/providerProfiles';

const profiles: ProviderProfile[] = ['one', 'two'].map((id) => ({
  id: `profile-${id}`, name: `Synthetic ${id}`, kind: 'openai-compatible',
  baseUrl: 'https://provider.example/v1', modelId: `model-${id}`,
  maxContext: 128000, maxOutput: 8192,
}));

const renderSettings = async (overrides: Partial<ComponentProps<typeof SettingsDrawer>> = {}) => {
  const props: ComponentProps<typeof SettingsDrawer> = {
    dialogRef: createRef<HTMLDialogElement>(), theme: 'paper', onThemeChange: vi.fn(),
    manuscriptFontFamily: 'sans', onManuscriptFontFamilyChange: vi.fn(),
    manuscriptFontSize: 16, onManuscriptFontSizeChange: vi.fn(), streamingOutput: true,
    onStreamingOutputChange: vi.fn(), providerProfiles: profiles, activeProviderProfileId: profiles[0]!.id,
    onSelectProviderProfile: vi.fn(), onSaveProviderProfile: vi.fn(async (profile) => profile),
    onTestProviderProfile: vi.fn(async () => ({ ok: true as const, modelId: 'model-one' })),
    providerRuntime: 'device', onLoadStorageLocation: vi.fn(async () => ({ location: 'Synthetic local storage' })),
    onClose: vi.fn(), ...overrides,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<SettingsDrawer {...props} />));
  await act(async () => props.dialogRef.current!.showModal());
  return { props, container, root };
};

const setInput = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const selectProfile = async (container: HTMLElement, id: string) => {
  const select = container.querySelector('#provider-profile-select');
  if (!(select instanceof HTMLSelectElement)) throw new Error('Missing profile select.');
  await act(async () => { select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); });
};
const submit = async (container: HTMLElement) => {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
};

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
    this.open = false; this.dispatchEvent(new Event('close'));
  } });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('settings drawer session lifecycle', () => {
  it('keeps device keys per profile while mounted and clears them after unmount without browser storage writes', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const { props, container, root } = await renderSettings();
    try {
      await setInput(container.querySelector<HTMLInputElement>('#provider-api-key')!, 'synthetic-device-key');
      await submit(container);
      expect(props.onSaveProviderProfile).toHaveBeenCalledWith(profiles[0], 'synthetic-device-key');
      await selectProfile(container, profiles[1]!.id);
      expect(container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe('');
      await selectProfile(container, profiles[0]!.id);
      expect(container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe('synthetic-device-key');
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="测试连接"]')!.click());
      expect(props.onTestProviderProfile).toHaveBeenCalledWith(profiles[0], 'synthetic-device-key');
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭设置"]')!.click());
      expect(props.dialogRef.current?.open).toBe(false);
      await act(async () => props.dialogRef.current!.showModal());
      expect(container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe('synthetic-device-key');
      expect(writes).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
    const remounted = await renderSettings();
    try { expect(remounted.container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe(''); }
    finally { await act(async () => remounted.root.unmount()); }
  });

  it('clears a host key only after successful save and blocks duplicate save/test calls while pending', async () => {
    let complete: (profile: ProviderProfile) => void = () => undefined;
    const onSaveProviderProfile = vi.fn(() => new Promise<ProviderProfile>((resolve) => { complete = resolve; }));
    const { props, container, root } = await renderSettings({ providerRuntime: 'host', onSaveProviderProfile });
    try {
      await setInput(container.querySelector<HTMLInputElement>('#provider-api-key')!, 'synthetic-host-key');
      await submit(container);
      await submit(container);
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="测试连接"]')!.click());
      expect(onSaveProviderProfile).toHaveBeenCalledTimes(1);
      expect(props.onTestProviderProfile).not.toHaveBeenCalled();
      expect(container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe('synthetic-host-key');
      await act(async () => complete(profiles[0]!));
      expect(container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe('');
      expect(container.querySelector('.provider-save-status')?.textContent).toContain('已保存到本机私有配置');
      await selectProfile(container, profiles[1]!.id);
      await selectProfile(container, profiles[0]!.id);
      expect(container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe('');
    } finally { await act(async () => root.unmount()); }
  });

  it('retains failed provider drafts through prop updates and canceled dismissal without saving or switching', async () => {
    const onSaveProviderProfile = vi.fn(async () => { throw new Error('synthetic provider failure'); });
    const { props, container, root } = await renderSettings({ onSaveProviderProfile });
    try {
      await setInput(container.querySelector<HTMLInputElement>('#provider-profile-name')!, 'Unsaved synthetic name');
      await setInput(container.querySelector<HTMLInputElement>('#provider-api-key')!, 'synthetic-unsaved-key');
      await submit(container);
      expect(container.querySelector('.provider-save-status')?.textContent).toContain('synthetic provider failure');
      await act(async () => root.render(<SettingsDrawer {...props} providerProfiles={[{ ...profiles[0]!, name: 'External name' }, profiles[1]!]} />));
      expect(container.querySelector<HTMLInputElement>('#provider-profile-name')?.value).toBe('Unsaved synthetic name');
      expect(container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe('synthetic-unsaved-key');
      await act(async () => props.dialogRef.current!.dispatchEvent(new Event('cancel', { cancelable: true })));
      const confirmation = container.querySelector<HTMLDialogElement>('.confirm-dialog')!;
      expect(confirmation.open).toBe(true);
      expect(props.dialogRef.current?.open).toBe(true);
      await act(async () => confirmation.querySelector<HTMLButtonElement>('.quiet-action')!.click());
      expect(confirmation.open).toBe(false);
      expect(container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe('synthetic-unsaved-key');
      expect(props.dialogRef.current?.open).toBe(true);
      // The existing nested close bubbles to the drawer's focus-restoration callback.
      expect(props.onClose).toHaveBeenCalledOnce();
      expect(props.onSelectProviderProfile).not.toHaveBeenCalled();
      expect(onSaveProviderProfile).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
  });

  it('restores the baseline before delayed discard success applies the selected profile', async () => {
    vi.useFakeTimers();
    const { props, container, root } = await renderSettings();
    try {
      await setInput(container.querySelector<HTMLInputElement>('#provider-profile-name')!, 'Unsaved synthetic name');
      await setInput(container.querySelector<HTMLInputElement>('#provider-api-key')!, 'synthetic-unsaved-key');
      await selectProfile(container, profiles[1]!.id);
      const confirmation = container.querySelector<HTMLDialogElement>('.confirm-dialog')!;
      expect(props.onSelectProviderProfile).not.toHaveBeenCalled();
      await act(async () => confirmation.querySelector<HTMLButtonElement>('.danger-action')!.click());
      expect(confirmation.textContent).toContain('已放弃修改');
      expect(container.querySelector<HTMLInputElement>('#provider-profile-name')?.value).toBe(profiles[0]!.name);
      expect(container.querySelector<HTMLInputElement>('#provider-api-key')?.value).toBe('');
      await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
      expect(props.onSelectProviderProfile).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(props.onSelectProviderProfile).toHaveBeenCalledExactlyOnceWith(profiles[1]!.id);
      expect(confirmation.open).toBe(false);
      expect(container.querySelector<HTMLInputElement>('#provider-profile-name')?.value).toBe(profiles[1]!.name);
      expect(props.onSaveProviderProfile).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });

  it('routes appearance controls to their owners and displays storage lookup failure once per mount', async () => {
    const onLoadStorageLocation = vi.fn(async () => { throw new Error('synthetic location failure'); });
    const { props, container, root } = await renderSettings({ onLoadStorageLocation, manuscriptFontSize: 12 });
    try {
      expect(container.querySelector('.storage-location')?.textContent).toBe('本地地址暂时无法读取');
      expect(container.querySelector<HTMLButtonElement>('[aria-label="减小正文字号"]')?.disabled).toBe(true);
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="增大正文字号"]')!.click());
      expect(props.onManuscriptFontSizeChange).toHaveBeenCalledExactlyOnceWith(13);
      const theme = container.querySelector('#theme-select');
      const font = container.querySelector('#manuscript-font-select');
      if (!(theme instanceof HTMLSelectElement) || !(font instanceof HTMLSelectElement)) throw new Error('Missing appearance selects.');
      await act(async () => { theme.value = 'purple'; theme.dispatchEvent(new Event('change', { bubbles: true })); });
      await act(async () => { font.value = 'wenkai'; font.dispatchEvent(new Event('change', { bubbles: true })); });
      await act(async () => container.querySelector<HTMLInputElement>('#streaming-output-toggle')!.click());
      expect(props.onThemeChange).toHaveBeenCalledExactlyOnceWith('purple');
      expect(props.onManuscriptFontFamilyChange).toHaveBeenCalledExactlyOnceWith('wenkai');
      expect(props.onStreamingOutputChange).toHaveBeenCalledExactlyOnceWith(false);
      await act(async () => root.render(<SettingsDrawer {...props} manuscriptFontSize={24} />));
      expect(container.querySelector<HTMLButtonElement>('[aria-label="增大正文字号"]')?.disabled).toBe(true);
      expect(onLoadStorageLocation).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
  });
});
