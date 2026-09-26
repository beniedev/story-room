// @vitest-environment jsdom

import { act, createRef, type ComponentProps, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EmptyLibraryActions } from '../src/components/EmptyLibraryActions';
import { ExportDialog } from '../src/components/ExportDialog';

const render = async (node: ReactNode) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, root };
};
const setInput = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
    this.open = false; this.dispatchEvent(new Event('close'));
  } });
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('library action dialogs', () => {
  it('keeps an empty-library name draft after closing and reopening without calling persistence', async () => {
    const props: ComponentProps<typeof EmptyLibraryActions> = { open: true, busy: false, onOpenChange: vi.fn(), onCreateBook: vi.fn(async () => undefined), onImport: vi.fn() };
    const { container, root } = await render(<EmptyLibraryActions {...props} />);
    try {
      const input = container.querySelector<HTMLInputElement>('input')!;
      expect(document.activeElement).toBe(input);
      await setInput(input, '未保存合成书名');
      await act(async () => root.render(<EmptyLibraryActions {...props} open={false} />));
      await act(async () => root.render(<EmptyLibraryActions {...props} open />));
      expect(input.value).toBe('未保存合成书名');
      expect(container.querySelector<HTMLDialogElement>('dialog')?.open).toBe(true);
      expect(props.onCreateBook).not.toHaveBeenCalled();
      await act(async () => container.querySelectorAll<HTMLButtonElement>('.empty-library-actions button')[1]!.click());
      expect(props.onImport).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); }
  });

  it('keeps the creation dialog and name through pending failure, then clears it only after successful retry', async () => {
    let reject: (error: Error) => void = () => undefined;
    const onCreateBook = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const props: ComponentProps<typeof EmptyLibraryActions> = { open: true, busy: false, onOpenChange: vi.fn(), onCreateBook, onImport: vi.fn() };
    const { container, root } = await render(<EmptyLibraryActions {...props} />);
    try {
      await setInput(container.querySelector<HTMLInputElement>('input')!, '  合成书目  ');
      const submit = () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await act(async () => { submit(); });
      await act(async () => { submit(); });
      expect(onCreateBook).toHaveBeenCalledExactlyOnceWith('合成书目');
      expect(container.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(true);
      expect(props.onOpenChange).not.toHaveBeenCalled();
      await act(async () => reject(new Error('synthetic creation failure')));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('synthetic creation failure');
      expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('  合成书目  ');
      expect(container.querySelector<HTMLDialogElement>('dialog')?.open).toBe(true);
      onCreateBook.mockImplementation(async () => undefined);
      await act(async () => { submit(); });
      expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
      expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('');
    } finally { await act(async () => root.unmount()); }
  });

  it('exports each selected format through the current callback and delegates native cancellation', async () => {
    const dialogRef = createRef<HTMLDialogElement>();
    const onExport = vi.fn();
    const onClose = vi.fn();
    const { container, root } = await render(<ExportDialog bookTitle="合成书目一" dialogRef={dialogRef} onExport={onExport} onClose={onClose} />);
    try {
      await act(async () => dialogRef.current!.showModal());
      for (const button of container.querySelectorAll<HTMLButtonElement>('.export-option')) await act(async () => button.click());
      expect(onExport.mock.calls.map(([format]) => format)).toEqual(['epub', 'markdown', 'text', 'json']);
      const nextExport = vi.fn();
      await act(async () => root.render(<ExportDialog bookTitle="合成书目二" dialogRef={dialogRef} onExport={nextExport} onClose={onClose} />));
      expect(container.querySelector('h2')?.textContent).toBe('导出《合成书目二》');
      await act(async () => container.querySelector<HTMLButtonElement>('.export-option')!.click());
      expect(nextExport).toHaveBeenCalledExactlyOnceWith('epub');
      const cancellation = new Event('cancel', { cancelable: true });
      await act(async () => dialogRef.current!.dispatchEvent(cancellation));
      expect(cancellation.defaultPrevented).toBe(true);
      expect(onClose).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); }
  });
});
