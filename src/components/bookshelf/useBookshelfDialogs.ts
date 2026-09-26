import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { idleDialogOperation, useDismissSuccessfulDialog, type DialogOperationState } from '../shared/DialogOperationStatus';
import type { BookshelfProps, DeleteDialogState, NameDialogState } from './types';

type DialogProps = Pick<BookshelfProps, 'book' | 'openNewBookRequest' | 'onNewBookOpened' | 'onCreateBook' | 'onDeleteBook' | 'onBookChange' | 'onAddChapter' | 'onAddCharacter' | 'onAddWorldRule' | 'onDeleteSelection' | 'onDeleteSources'>;
type DialogFocus = {
  bookActionsTrigger: RefObject<HTMLElement | null>;
  bookActionsMenu: RefObject<HTMLDetailsElement | null>;
  bookSettingsDialog: RefObject<HTMLDialogElement | null>;
};

export function useBookshelfDialogs(
  props: DialogProps,
  canWrite: boolean,
  { bookActionsTrigger, bookActionsMenu, bookSettingsDialog }: DialogFocus,
  resetDirectorySelection: () => void,
  resetSourceSelection: () => void,
) {
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [nameOperation, setNameOperation] = useState<DialogOperationState>(idleDialogOperation);
  const [deleteOperation, setDeleteOperation] = useState<DialogOperationState>(idleDialogOperation);
  const nameDialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const nameDialogTrigger = useRef<HTMLElement | null>(null);
  const deleteDialogTrigger = useRef<HTMLElement | null>(null);

  useDismissSuccessfulDialog(nameOperation.phase === 'success', () => nameDialogRef.current?.close());
  useDismissSuccessfulDialog(deleteOperation.phase === 'success', () => deleteDialogRef.current?.close());

  useEffect(() => {
    if (!nameDialog || !nameDialogRef.current || nameDialogRef.current.open) return undefined;
    nameDialogRef.current.showModal();
    const focusNameInput = () => {
      nameInputRef.current?.focus();
      if (nameDialog.kind === 'rename-book') nameInputRef.current?.select();
    };
    focusNameInput();
    const frame = window.requestAnimationFrame(focusNameInput);
    return () => window.cancelAnimationFrame(frame);
  }, [nameDialog]);

  useEffect(() => {
    if (deleteDialog && deleteDialogRef.current && !deleteDialogRef.current.open) {
      deleteDialogRef.current.showModal();
    }
  }, [deleteDialog]);
  const rememberTrigger = () => document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openNameDialog = (dialog: NameDialogState) => {
    if (!canWrite) return;
    nameDialogTrigger.current = rememberTrigger();
    setNameOperation(idleDialogOperation);
    setNameDialog(dialog);
  };
  const openDeleteDialog = (dialog: DeleteDialogState) => {
    if (!canWrite) return;
    deleteDialogTrigger.current = rememberTrigger();
    setDeleteOperation(idleDialogOperation);
    setDeleteDialog(dialog);
  };
  const openCurrentBookNameDialog = (dialog: NameDialogState) => {
    if (!canWrite) return;
    nameDialogTrigger.current = bookActionsTrigger.current;
    bookActionsMenu.current?.removeAttribute('open');
    setNameOperation(idleDialogOperation);
    setNameDialog(dialog);
  };
  const openCurrentBookDeleteDialog = () => {
    if (!canWrite) return;
    deleteDialogTrigger.current = bookActionsTrigger.current;
    bookActionsMenu.current?.removeAttribute('open');
    setDeleteOperation(idleDialogOperation);
    setDeleteDialog({ kind: 'book', id: props.book.id, title: props.book.title });
  };

  useEffect(() => {
    if (!props.openNewBookRequest) return;
    openNameDialog({ kind: 'new-book', value: '' });
    props.onNewBookOpened();
  }, [props.openNewBookRequest]);
  const restoreDialogFocus = (trigger: RefObject<HTMLElement | null>) => {
    const target = trigger.current;
    const focusTarget = () => {
      if (target?.isConnected) target.focus();
      else if (bookSettingsDialog.current?.open) bookSettingsDialog.current.querySelector<HTMLElement>('summary')?.focus();
      else document.querySelector<HTMLElement>('.directory-toolbar button, .book-selector-card')?.focus();
    };
    focusTarget();
    window.requestAnimationFrame(focusTarget);
  };

  const nameDialogCopy = (() => {
    switch (nameDialog?.kind) {
      case 'new-book': return { title: '新建书目', label: '书名', placeholder: '输入书名', action: '确认新建' };
      case 'rename-book': return { title: '修改书名', label: '书名', placeholder: '输入书名', action: '保存' };
      case 'new-chapter': return { title: '新建章节', label: '章节名称', placeholder: `第 ${props.book.chapters.length + 1} 章`, action: '确认新建' };
      case 'new-character': return { title: '新建角色卡', label: '角色名称', placeholder: '输入角色名称', action: '确认新建' };
      case 'new-world': return { title: '新建世界观设定', label: '设定名称', placeholder: '输入设定名称', action: '确认新建' };
      default: return { title: '命名', label: '名称', placeholder: '输入名称', action: '确认' };
    }
  })();

  const nameOperationCopy = (() => {
    switch (nameDialog?.kind) {
      case 'new-book': return { pending: '正在新建书目…', success: '新建书目成功', error: '新建书目失败' };
      case 'new-chapter': return { pending: '正在新建章节…', success: '新建章节成功', error: '新建章节失败' };
      case 'new-character': return { pending: '正在新建角色卡…', success: '新建角色卡成功', error: '新建角色卡失败' };
      case 'new-world': return { pending: '正在新建世界观设定…', success: '新建世界观设定成功', error: '新建世界观设定失败' };
      default: return { pending: '正在保存修改…', success: '保存成功', error: '保存失败' };
    }
  })();

  const deleteDialogCopy = (() => {
    if (!deleteDialog) return { title: '确认删除', message: '此操作无法撤销。', action: '确认删除' };
    if (deleteDialog.kind === 'selection') {
      const parts = [
        deleteDialog.chapterCount ? `${deleteDialog.chapterCount} 个章节` : '',
        deleteDialog.sectionCount ? `共 ${deleteDialog.sectionCount} 个小节` : '',
      ].filter(Boolean).join('和');
      return {
        title: '删除所选内容',
        message: `将删除${parts}。所选章节内的小节也会一起删除，此操作无法撤销。`,
        action: '删除所选内容',
      };
    }
    if (deleteDialog.kind === 'source-selection') {
      const label = deleteDialog.sourceKind === 'character' ? '角色卡' : '世界观设定';
      const count = deleteDialog.sourceKind === 'character'
        ? `${deleteDialog.ids.length} 张角色卡`
        : `${deleteDialog.ids.length} 条世界观设定`;
      return {
        title: `删除所选${label}`,
        message: `将删除 ${count}。此操作无法撤销。`,
        action: `删除${label}`,
      };
    }
    return {
      title: '删除书目',
      message: `确定删除“${deleteDialog.title}”吗？此操作无法撤销。`,
      action: '确认删除',
    };
  })();

  const closeNameDialog = () => {
    if (nameOperation.phase === 'pending') return;
    nameDialogRef.current?.close();
  };

  const closeDeleteDialog = () => {
    if (deleteOperation.phase === 'pending') return;
    deleteDialogRef.current?.close();
  };

  const submitNameDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (!canWrite || !nameDialog || nameOperation.phase === 'pending') return;
    const value = nameDialog.value.trim();
    if (!value) return;
    setNameOperation({ phase: 'pending', title: nameOperationCopy.pending });
    try {
      switch (nameDialog.kind) {
        case 'new-book': await props.onCreateBook(value); break;
        case 'rename-book': await props.onBookChange((current) => ({ ...current, title: value })); break;
        case 'new-chapter': await props.onAddChapter(value); break;
        case 'new-character': await props.onAddCharacter(value); break;
        case 'new-world': await props.onAddWorldRule(value); break;
      }
      setNameOperation({ phase: 'success', title: nameOperationCopy.success });
    } catch (error) {
      setNameOperation({
        phase: 'error',
        title: nameOperationCopy.error,
        detail: error instanceof Error ? error.message : '请稍后重试。',
      });
    }
  };
  const confirmDelete = async () => {
    if (!canWrite || !deleteDialog || deleteOperation.phase === 'pending') return;
    setDeleteOperation({ phase: 'pending', title: '正在删除…' });
    try {
      if (deleteDialog.kind === 'book') await props.onDeleteBook();
      if (deleteDialog.kind === 'selection') {
        await props.onDeleteSelection({
          chapterIds: new Set(deleteDialog.chapterIds),
          sectionIds: new Set(deleteDialog.sectionIds),
        });
        resetDirectorySelection();
      }
      if (deleteDialog.kind === 'source-selection') {
        await props.onDeleteSources(deleteDialog.sourceKind, new Set(deleteDialog.ids));
        resetSourceSelection();
      }
      setDeleteOperation({ phase: 'success', title: '删除成功' });
    } catch (error) {
      setDeleteOperation({
        phase: 'error',
        title: '删除失败',
        detail: error instanceof Error ? error.message : '请稍后重试。',
      });
    }
  };

  const onNameClosed = () => {
    setNameDialog(null);
    setNameOperation(idleDialogOperation);
    restoreDialogFocus(nameDialogTrigger);
  };
  const onNameReturn = () => {
    setNameOperation(idleDialogOperation);
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  };
  const onNameChange = (value: string) => setNameDialog((current) => current ? { ...current, value } : current);
  const onDeleteClosed = () => {
    setDeleteDialog(null);
    setDeleteOperation(idleDialogOperation);
    restoreDialogFocus(deleteDialogTrigger);
  };
  const onDeleteReturn = () => setDeleteOperation(idleDialogOperation);

  return {
    openNameDialog, openDeleteDialog, openCurrentBookNameDialog, openCurrentBookDeleteDialog,
    name: {
      nameDialogRef, nameInputRef, nameDialog, nameOperation, nameDialogCopy,
      closeNameDialog, submitNameDialog, onNameClosed, onNameReturn, onNameChange,
    },
    deletion: {
      deleteDialogRef, deleteOperation, deleteDialogCopy, closeDeleteDialog,
      confirmDelete, onDeleteClosed, onDeleteReturn,
    },
  };
}
