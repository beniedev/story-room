// @vitest-environment jsdom

import { act, useState, type Dispatch, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { InlineTitle, TITLE_ACTIVATION_DELAY } from '../src/components/shared/InlineTitle';

type SaveHook = (value: string) => Promise<void>;

type Fixture = {
  calls: string[];
  container: HTMLDivElement;
  parentClicks: () => number;
  setValue: Dispatch<SetStateAction<string>>;
  setDisabled: Dispatch<SetStateAction<boolean>>;
  unmount: () => Promise<void>;
};

const mount = async ({
  initial = '旧标题',
  disabled = false,
  onSave,
  onActivate,
}: {
  initial?: string;
  disabled?: boolean;
  onSave?: SaveHook;
  onActivate?: () => void;
} = {}): Promise<Fixture> => {
  let setValue: Dispatch<SetStateAction<string>> = () => undefined;
  let setDisabled: Dispatch<SetStateAction<boolean>> = () => undefined;
  let clicks = 0;
  const calls: string[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  function Harness() {
    const [value, updateValue] = useState(initial);
    const [isDisabled, updateDisabled] = useState(disabled);
    setValue = updateValue;
    setDisabled = updateDisabled;
    const save = async (nextValue: string) => {
      calls.push(nextValue);
      if (onSave) {
        await onSave(nextValue);
      } else {
        updateValue(nextValue);
      }
    };
    return (
      <div onClick={() => { clicks += 1; }}>
        <InlineTitle value={value} label="标题" disabled={isDisabled} onSave={save} onActivate={onActivate} />
      </div>
    );
  }

  await act(async () => root.render(<Harness />));
  return {
    calls,
    container,
    parentClicks: () => clicks,
    setValue,
    setDisabled,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
};

const displayButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.inline-title-display')!;
const editorInput = (container: HTMLElement) => container.querySelector<HTMLInputElement>('.inline-title-input')!;

const dispatchMouse = async (target: Element, type: 'click' | 'dblclick', detail: number) => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, detail }));
  });
};

const dispatchKey = async (target: Element, key: string, keyCode?: number) => {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
    if (keyCode !== undefined) Object.defineProperty(event, 'keyCode', { configurable: true, value: keyCode });
    target.dispatchEvent(event);
  });
};

const setInputValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
};

const dispatchPointer = async (
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  {
    pointerId = 1,
    pointerType = 'touch',
    isPrimary = true,
    clientX = 10,
    clientY = 10,
    timeStamp,
  }: {
    pointerId?: number;
    pointerType?: string;
    isPrimary?: boolean;
    clientX?: number;
    clientY?: number;
    timeStamp: number;
  },
) => {
  await act(async () => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType,
      isPrimary,
      clientX,
      clientY,
    });
    Object.defineProperty(event, 'timeStamp', { configurable: true, value: timeStamp });
    target.dispatchEvent(event);
    if (type === 'pointerup') target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
};

const touchTap = async (target: Element, start: number, end: number, pointerId = 1) => {
  await dispatchPointer(target, 'pointerdown', { pointerId, timeStamp: start });
  await dispatchPointer(target, 'pointerup', { pointerId, timeStamp: end });
};

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('InlineTitle', () => {
  it('delays only the pointer primary action, and cancels it for a double click', async () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    const fixture = await mount({ onActivate });
    try {
      await dispatchMouse(displayButton(fixture.container), 'click', 1);
      expect(onActivate).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(TITLE_ACTIVATION_DELAY); });
      expect(onActivate).toHaveBeenCalledTimes(1);
      onActivate.mockClear();
      await dispatchMouse(displayButton(fixture.container), 'click', 1);
      await dispatchMouse(displayButton(fixture.container), 'click', 2);
      expect(editorInput(fixture.container)).not.toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(onActivate).not.toHaveBeenCalled();
    } finally { await fixture.unmount(); }
  });

  it('cancels a pending title for another target, scrolling, disabling and unmounting', async () => {
    vi.useFakeTimers();
    const oneAction = vi.fn();
    const twoAction = vi.fn();
    const one = await mount({ onActivate: oneAction });
    const two = await mount({ onActivate: twoAction });
    try {
      await dispatchMouse(displayButton(one.container), 'click', 1);
      await dispatchMouse(displayButton(two.container), 'click', 1);
      await act(async () => { await vi.advanceTimersByTimeAsync(TITLE_ACTIVATION_DELAY); });
      expect(oneAction).not.toHaveBeenCalled();
      expect(twoAction).toHaveBeenCalledTimes(1);
      await dispatchMouse(displayButton(one.container), 'click', 1);
      await act(async () => document.dispatchEvent(new Event('scroll')));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(oneAction).not.toHaveBeenCalled();
      await dispatchPointer(displayButton(one.container), 'pointerdown', { timeStamp: 1000 });
      await dispatchPointer(displayButton(one.container), 'pointerup', { timeStamp: 1040 });
      await act(async () => one.setDisabled(true));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(oneAction).not.toHaveBeenCalled();
      await dispatchMouse(displayButton(two.container), 'click', 1);
    } finally { await one.unmount(); await two.unmount(); }
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(twoAction).toHaveBeenCalledTimes(1);
  });

  it('uses immediate keyboard activation and F2 renaming for a directory title', async () => {
    const onActivate = vi.fn();
    const fixture = await mount({ onActivate });
    try {
      await dispatchKey(displayButton(fixture.container), 'Enter');
      await dispatchKey(displayButton(fixture.container), ' ');
      expect(onActivate).toHaveBeenCalledTimes(2);
      await dispatchKey(displayButton(fixture.container), 'F2');
      expect(editorInput(fixture.container)).not.toBeNull();
      expect(onActivate).toHaveBeenCalledTimes(2);
    } finally { await fixture.unmount(); }
  });
  it('keeps a pointer single click inert and enters on mouse double click', async () => {
    const fixture = await mount();
    try {
      await dispatchMouse(displayButton(fixture.container), 'click', 1);
      expect(fixture.parentClicks()).toBe(0);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();

      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      const input = editorInput(fixture.container);
      expect(input.value).toBe('旧标题');
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
      expect(fixture.parentClicks()).toBe(0);
      expect(displayButton(fixture.container)).toBeNull();
    } finally {
      await fixture.unmount();
    }
  });

  it('recognizes close, short touch and pen double taps through local PointerEvents', async () => {
    const fixture = await mount();
    try {
      const button = displayButton(fixture.container);
      await touchTap(button, 10, 60);
      await touchTap(displayButton(fixture.container), 150, 200);
      expect(editorInput(fixture.container)).not.toBeNull();
      expect(fixture.parentClicks()).toBe(0);
    } finally {
      await fixture.unmount();
    }

    const penFixture = await mount();
    try {
      const button = displayButton(penFixture.container);
      await dispatchPointer(button, 'pointerdown', { pointerType: 'pen', pointerId: 2, clientX: 30, clientY: 30, timeStamp: 10 });
      await dispatchPointer(button, 'pointerup', { pointerType: 'pen', pointerId: 2, clientX: 30, clientY: 30, timeStamp: 60 });
      await dispatchPointer(displayButton(penFixture.container), 'pointerdown', { pointerType: 'pen', pointerId: 3, clientX: 35, clientY: 34, timeStamp: 140 });
      await dispatchPointer(displayButton(penFixture.container), 'pointerup', { pointerType: 'pen', pointerId: 3, clientX: 35, clientY: 34, timeStamp: 190 });
      expect(editorInput(penFixture.container)).not.toBeNull();
    } finally {
      await penFixture.unmount();
    }
  });

  it('rejects moved, cancelled, scrolled, long and distant touch gestures', async () => {
    const fixture = await mount();
    try {
      let button = displayButton(fixture.container);
      await dispatchPointer(button, 'pointerdown', { isPrimary: false, timeStamp: 1 });
      await dispatchPointer(button, 'pointerup', { isPrimary: false, timeStamp: 40 });
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();

      await dispatchPointer(button, 'pointerdown', { timeStamp: 10 });
      await dispatchPointer(button, 'pointermove', { clientX: 40, clientY: 10, timeStamp: 30 });
      await dispatchPointer(button, 'pointerup', { clientX: 40, clientY: 10, timeStamp: 50 });
      await touchTap(displayButton(fixture.container), 100, 150);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();

      button = displayButton(fixture.container);
      await touchTap(button, 700, 740);
      await dispatchPointer(displayButton(fixture.container), 'pointerdown', { timeStamp: 800 });
      await dispatchPointer(displayButton(fixture.container), 'pointercancel', { timeStamp: 820 });
      await touchTap(displayButton(fixture.container), 860, 900);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();

      button = displayButton(fixture.container);
      await dispatchPointer(button, 'pointerdown', { timeStamp: 1_000 });
      await act(async () => button.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: true })));
      await dispatchPointer(button, 'pointerup', { timeStamp: 1_060 });
      await touchTap(displayButton(fixture.container), 1_100, 1_150);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();

      button = displayButton(fixture.container);
      await dispatchPointer(button, 'pointerdown', { timeStamp: 1_300 });
      await dispatchPointer(button, 'pointerup', { timeStamp: 1_900 });
      await touchTap(displayButton(fixture.container), 2_000, 2_050);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();

      button = displayButton(fixture.container);
      await touchTap(button, 2_500, 2_550);
      await dispatchPointer(displayButton(fixture.container), 'pointerdown', { clientX: 100, clientY: 100, timeStamp: 2_600 });
      await dispatchPointer(displayButton(fixture.container), 'pointerup', { clientX: 100, clientY: 100, timeStamp: 2_650 });
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();
    } finally {
      await fixture.unmount();
    }
  });

  it('enters from F2, Enter and Space keyboard activation', async () => {
    const fixture = await mount();
    try {
      await dispatchKey(displayButton(fixture.container), 'F2');
      expect(editorInput(fixture.container)).not.toBeNull();
      await dispatchKey(editorInput(fixture.container), 'Escape');
      expect(document.activeElement).toBe(displayButton(fixture.container));

      await dispatchKey(displayButton(fixture.container), 'Enter');
      expect(editorInput(fixture.container)).not.toBeNull();
      await dispatchKey(editorInput(fixture.container), 'Escape');

      await dispatchKey(displayButton(fixture.container), ' ');
      expect(editorInput(fixture.container)).not.toBeNull();
      await dispatchKey(editorInput(fixture.container), 'Escape');
      expect(document.activeElement).toBe(displayButton(fixture.container));
    } finally {
      await fixture.unmount();
    }
  });

  it('uses the same save path for Enter and external blur, while IME Enter waits', async () => {
    const fixture = await mount();
    try {
      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      const input = editorInput(fixture.container);
      await setInputValue(input, '中文标题');
      await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await dispatchKey(input, 'Enter');
      await dispatchKey(input, 'Enter', 229);
      expect(fixture.calls).toHaveLength(0);
      await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '题' })));
      await dispatchKey(input, 'Enter');
      expect(fixture.calls).toEqual(['中文标题']);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();
      expect(document.activeElement).toBe(displayButton(fixture.container));

      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      const blurredInput = editorInput(fixture.container);
      await setInputValue(blurredInput, '失焦保存');
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      await act(async () => {
        outside.focus();
      });
      expect(fixture.calls).toEqual(['中文标题', '失焦保存']);
      expect(document.activeElement).toBe(outside);

      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      const composingInput = editorInput(fixture.container);
      await act(async () => composingInput.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
      await setInputValue(composingInput, '候选完成');
      await act(async () => outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
      expect(fixture.calls).toEqual(['中文标题', '失焦保存']);
      await act(async () => composingInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      expect(fixture.calls).toEqual(['中文标题', '失焦保存', '候选完成']);
      outside.remove();
    } finally {
      await fixture.unmount();
    }
  });

  it('keeps blank drafts in place, cancels, and skips unchanged saves', async () => {
    const fixture = await mount();
    try {
      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      const input = editorInput(fixture.container);
      await setInputValue(input, '   ');
      await dispatchKey(editorInput(fixture.container), 'Enter');
      expect(editorInput(fixture.container)).not.toBeNull();
      expect(fixture.calls).toHaveLength(0);
      expect(fixture.container.querySelector('[role="alert"]')?.textContent).toContain('不能为空');

      await dispatchKey(editorInput(fixture.container), 'Escape');
      expect(displayButton(fixture.container).textContent).toBe('旧标题');

      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      await dispatchKey(editorInput(fixture.container), 'Enter');
      expect(fixture.calls).toHaveLength(0);
      expect(displayButton(fixture.container).textContent).toBe('旧标题');

      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      await setInputValue(editorInput(fixture.container), ' 旧标题 ');
      await dispatchKey(editorInput(fixture.container), 'Enter');
      expect(fixture.calls).toHaveLength(0);
      expect(displayButton(fixture.container).textContent).toBe('旧标题');

      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      await setInputValue(editorInput(fixture.container), '  新标题  ');
      await dispatchKey(editorInput(fixture.container), 'Enter');
      expect(fixture.calls).toEqual(['新标题']);
      expect(displayButton(fixture.container).textContent).toBe('新标题');
    } finally {
      await fixture.unmount();
    }

    const emptyFixture = await mount({ initial: '' });
    try {
      await dispatchMouse(displayButton(emptyFixture.container), 'dblclick', 2);
      await setInputValue(editorInput(emptyFixture.container), '   ');
      await dispatchKey(editorInput(emptyFixture.container), 'Enter');
      expect(editorInput(emptyFixture.container)).not.toBeNull();
      expect(emptyFixture.calls).toHaveLength(0);
    } finally {
      await emptyFixture.unmount();
    }
  });

  it('finishes from an outside tap without buttons or consuming the outside action', async () => {
    const fixture = await mount();
    const outside = document.createElement('div');
    const outsideClick = vi.fn();
    outside.addEventListener('click', outsideClick);
    document.body.appendChild(outside);
    try {
      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      expect(fixture.container.querySelector('.inline-title button')).toBeNull();
      await setInputValue(editorInput(fixture.container), '点外面保存');
      await act(async () => {
        outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(fixture.calls).toEqual(['点外面保存']);
      expect(outsideClick).toHaveBeenCalledOnce();
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();

      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      await act(async () => outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
      expect(fixture.calls).toEqual(['点外面保存']);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();
    } finally {
      outside.remove();
      await fixture.unmount();
    }
  });

  it('deduplicates pending saves, retains failed input, and allows retry', async () => {
    let resolveSave: (() => void) | undefined;
    let rejectSave: ((reason?: unknown) => void) | undefined;
    let attempts = 0;
    let updateValue: Dispatch<SetStateAction<string>> = () => undefined;
    const fixture = await mount({
      onSave: async (nextValue) => {
        attempts += 1;
        if (attempts === 1) {
          await new Promise<void>((resolve) => { resolveSave = resolve; });
          updateValue(nextValue);
          return;
        }
        if (attempts === 2) {
          await new Promise<void>((_, reject) => { rejectSave = reject; });
        }
        updateValue(nextValue);
      },
    });
    updateValue = fixture.setValue;
    try {
      // The first attempt is held open so a second keyboard/blur path can race it.
      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      const input = editorInput(fixture.container);
      await setInputValue(input, '待定标题');
      await dispatchKey(input, 'Enter');
      await dispatchKey(input, 'Enter');
      await act(async () => input.dispatchEvent(new FocusEvent('blur', { bubbles: true })));
      expect(fixture.calls).toEqual(['待定标题']);
      expect(fixture.container.querySelector('.inline-title')?.getAttribute('aria-busy')).toBe('true');
      expect(fixture.container.querySelector('.inline-title-status')?.textContent).toBe('保存中…');
      resolveSave?.();
      await act(async () => undefined);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();

      // A rejected retry leaves the editor and its draft available for another try.
      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      const retryInput = editorInput(fixture.container);
      await setInputValue(retryInput, '重试标题');
      await dispatchKey(retryInput, 'Enter');
      rejectSave?.(new Error('synthetic failure'));
      await act(async () => undefined);
      expect(editorInput(fixture.container).value).toBe('重试标题');
      expect(fixture.container.querySelector('[role="alert"]')?.textContent).toContain('synthetic failure');
      await dispatchKey(editorInput(fixture.container), 'Enter');
      await act(async () => undefined);
      expect(fixture.calls).toEqual(['待定标题', '重试标题', '重试标题']);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();
    } finally {
      await fixture.unmount();
    }
  });

  it('retries the same draft after an optimistic parent update and failed save', async () => {
    let rejectFirst: ((reason?: unknown) => void) | undefined;
    let updateValue: Dispatch<SetStateAction<string>> = () => undefined;
    let attempts = 0;
    const fixture = await mount({
      onSave: async (nextValue) => {
        attempts += 1;
        updateValue(nextValue);
        if (attempts === 1) {
          await new Promise<void>((_, reject) => { rejectFirst = reject; });
        }
      },
    });
    updateValue = fixture.setValue;
    try {
      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      await setInputValue(editorInput(fixture.container), '乐观失败标题');
      await dispatchKey(editorInput(fixture.container), 'Enter');
      expect(fixture.calls).toEqual(['乐观失败标题']);
      expect(editorInput(fixture.container).value).toBe('乐观失败标题');

      rejectFirst?.('保存失败，请重试。');
      await act(async () => undefined);
      expect(fixture.container.querySelector('[role="alert"]')?.textContent).toBe('保存失败，请重试。');

      await dispatchKey(editorInput(fixture.container), 'Enter');
      await act(async () => undefined);
      expect(fixture.calls).toEqual(['乐观失败标题', '乐观失败标题']);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();
    } finally {
      await fixture.unmount();
    }
  });

  it('protects disabled titles and ignores a pending response after disabled changes', async () => {
    let resolveSave: (() => void) | undefined;
    const fixture = await mount({
      onSave: async () => new Promise<void>((resolve) => { resolveSave = resolve; }),
    });
    try {
      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      const input = editorInput(fixture.container);
      await setInputValue(input, '迟到标题');
      await dispatchKey(input, 'Enter');
      expect(fixture.calls).toEqual(['迟到标题']);
      await act(async () => fixture.setDisabled(true));
      resolveSave?.();
      await act(async () => undefined);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();
      expect(displayButton(fixture.container).disabled).toBe(true);

      await dispatchMouse(displayButton(fixture.container), 'dblclick', 2);
      expect(fixture.container.querySelector('.inline-title-input')).toBeNull();
    } finally {
      await fixture.unmount();
    }
  });
});
