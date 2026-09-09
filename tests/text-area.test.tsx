// @vitest-environment jsdom

import { act, createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TextArea } from '../src/components/shared/TextArea';

it('preserves native edits and selection, and applies external text changes through the same input', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const ref = createRef<HTMLTextAreaElement>();
  let replaceText: (value: string) => void = () => undefined;
  let latest = '';
  function Editor() {
    const [value, setValue] = useState('Initial manuscript');
    replaceText = setValue;
    latest = value;
    return <TextArea ref={ref} aria-label="Manuscript" value={value}
      onChange={(event) => setValue(event.target.value)} />;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  try {
    await act(async () => root.render(<Editor />));
    const input = ref.current!;
    const defaultWrites = vi.spyOn(input, 'defaultValue', 'set');
    const valueWrites = vi.spyOn(input, 'value', 'set');
    input.focus();
    await act(async () => {
      nativeValueSetter.call(input, '中文编辑');
      input.setSelectionRange(2, 2);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    expect(latest).toBe('中文编辑');
    expect(input.selectionStart).toBe(2);
    expect(document.activeElement).toBe(input);
    expect(input.defaultValue).toBe('Initial manuscript');
    expect(defaultWrites.mock.calls.every(([value]) => value === 'Initial manuscript')).toBe(true);
    expect(valueWrites.mock.calls.length).toBe(0);
    await act(async () => replaceText('Externally replaced manuscript'));
    expect(ref.current).toBe(input);
    expect(input.value).toBe('Externally replaced manuscript');
    expect(valueWrites.mock.calls.length).toBe(1);
    await act(async () => replaceText(''));
    expect(input.value).toBe('');
    expect(input.defaultValue).toBe('Initial manuscript');
  } finally {
    await act(async () => root.unmount());
    expect(ref.current).toBeNull();
    vi.restoreAllMocks();
    container.remove();
  }
});
