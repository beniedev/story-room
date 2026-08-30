import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('writing UI contract', () => {
  it('keeps the manuscript out of chat UI structures', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain('className="manuscript"');
    expect(source).not.toMatch(/message-bubble|avatar-turn|chat-message|User:|Assistant:/i);
  });

  it('uses one stylesheet and semantic theme tokens', async () => {
    const source = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain(':root[data-theme="manga"]');
    expect(source).toContain('--surface-active: #faecf1');
    expect(source).toContain('.manuscript');
  });

  it('makes the restricted first-person mode and prompt plan visible', async () => {
    const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).toContain('角色模式 · 第一视角');
    expect(source).toContain('第一人称连续正文生成');
    expect(source).toContain('selectedCharacterId');
    expect(source).toContain('Prompt 计划');
    expect(source).toContain('按实际装入顺序排列');
    expect(source).toContain('aria-describedby="prompt-dialog-description"');
    expect(source).toContain('data-dialog-close');
    expect(source).toContain('onCancel=');
  });

  it('keeps mobile reflow and touch/focus contracts explicit', async () => {
    const source = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(source).toContain('@media (max-width: 24rem)');
    expect(source).toContain('.source-card {');
    expect(source).toContain('min-height: 44px');
    expect(source).toContain('font-size: 1rem');
    expect(source).toContain('env(safe-area-inset-bottom)');
    expect(source).toContain(':focus-visible');
  });
});
