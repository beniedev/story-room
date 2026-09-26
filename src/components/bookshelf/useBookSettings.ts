import { useEffect, useRef, useState } from 'react';
import { moveSourceItem, type SourceSelectionKind } from '../../sourceSelection';
import type { BookshelfProps, BookSettingsView, SettingsSection } from './types';

type BookSettingsProps = Pick<BookshelfProps, 'book' | 'onBookChange' | 'openBookSettingsRequest' | 'onBookSettingsOpened' | 'onBookSettingsClose'>;

export function useBookSettings(props: BookSettingsProps, canWrite: boolean, setSourceMoveBusy: (busy: boolean) => void) {
  const [sourceSelectionMode, setSourceSelectionMode] = useState<SourceSelectionKind | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [openSettingsSections, setOpenSettingsSections] = useState<Set<SettingsSection>>(
    () => new Set(['guidance']),
  );
  const [bookSettingsView, setBookSettingsView] = useState<BookSettingsView>({ kind: 'root' });
  const bookSettingsDialog = useRef<HTMLDialogElement>(null);
  const bookSettingsTrigger = useRef<HTMLButtonElement>(null);
  const bookSettingsPageTrigger = useRef<HTMLElement | null>(null);
  const sourceScopeTrigger = useRef<HTMLElement | null>(null);
  const bookSettingsScrollTop = useRef(0);
  const sourceScopeScrollTop = useRef(0);
  const bookSettingsBackButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.openBookSettingsRequest || !bookSettingsDialog.current || bookSettingsDialog.current.open) return;
    setBookSettingsView({ kind: 'root' });
    bookSettingsDialog.current.showModal();
    props.onBookSettingsOpened();
  }, [props.openBookSettingsRequest]);
  useEffect(() => {
    setSourceSelectionMode(null);
    setSelectedSourceIds(new Set());
  }, [props.book.id]);

  const rememberTrigger = () => document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const toggleSourceSelectionMode = (kind: SourceSelectionKind) => {
    if (!canWrite) return;
    setSourceSelectionMode((current) => current === kind ? null : kind);
    setSelectedSourceIds(new Set());
  };

  const moveSource = async (kind: SourceSelectionKind, id: string, beforeId: string | null) => {
    if (!canWrite) throw new Error('当前无法保存排序，请稍后重试。');
    const bookId = props.book.id;
    setSourceMoveBusy(true);
    try {
      await props.onBookChange((current) => {
        if (current.id !== bookId) throw new Error('当前书籍已切换，请重新排序。');
        return moveSourceItem(current, kind, id, beforeId);
      });
    } finally {
      setSourceMoveBusy(false);
    }
  };

  const openBookSettingsPage = (next: BookSettingsView) => {
    bookSettingsPageTrigger.current = rememberTrigger();
    bookSettingsScrollTop.current = bookSettingsDialog.current?.scrollTop ?? 0;
    setBookSettingsView(next);
    window.requestAnimationFrame(() => bookSettingsBackButton.current?.focus());
  };

  const openSourceScope = (next: Extract<BookSettingsView, { kind: 'character-scope' | 'world-scope' }>) => {
    sourceScopeTrigger.current = rememberTrigger();
    sourceScopeScrollTop.current = bookSettingsDialog.current?.scrollTop ?? 0;
    setBookSettingsView(next);
    window.requestAnimationFrame(() => bookSettingsBackButton.current?.focus());
  };

  const returnBookSettingsParent = () => {
    if (bookSettingsView.kind === 'character-scope' || bookSettingsView.kind === 'world-scope') {
      const trigger = sourceScopeTrigger.current;
      const parent: BookSettingsView = bookSettingsView.kind === 'character-scope'
        ? { kind: 'character', id: bookSettingsView.id }
        : { kind: 'world', id: bookSettingsView.id };
      setBookSettingsView(parent);
      window.requestAnimationFrame(() => {
        if (bookSettingsDialog.current) bookSettingsDialog.current.scrollTop = sourceScopeScrollTop.current;
        if (trigger?.isConnected) trigger.focus();
      });
      return;
    }
    const trigger = bookSettingsPageTrigger.current;
    setBookSettingsView({ kind: 'root' });
    window.requestAnimationFrame(() => {
      if (bookSettingsDialog.current) bookSettingsDialog.current.scrollTop = bookSettingsScrollTop.current;
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const closeBookSettings = () => bookSettingsDialog.current?.close();

  const resetBookSettings = () => {
    setBookSettingsView({ kind: 'root' });
    sourceScopeTrigger.current = null;
    bookSettingsTrigger.current?.focus();
    props.onBookSettingsClose();
  };

  const setSettingsSectionOpen = (section: SettingsSection, open: boolean) => {
    setOpenSettingsSections((current) => {
      const next = new Set(current);
      if (open) next.add(section);
      else next.delete(section);
      return next;
    });
  };

  const settingsCharacter = bookSettingsView.kind === 'character' || bookSettingsView.kind === 'character-scope'
    ? props.book.characters.find((character) => character.id === bookSettingsView.id)
    : undefined;
  const settingsWorldRule = bookSettingsView.kind === 'world' || bookSettingsView.kind === 'world-scope'
    ? props.book.worldRules.find((rule) => rule.id === bookSettingsView.id)
    : undefined;
  const bookSettingsTitle = bookSettingsView.kind === 'outline'
    ? '剧情大纲'
    : bookSettingsView.kind === 'style'
      ? '写作风格指导'
      : bookSettingsView.kind === 'character'
        ? settingsCharacter?.name ?? '角色卡'
        : bookSettingsView.kind === 'world'
          ? settingsWorldRule?.title ?? '世界观设定'
          : bookSettingsView.kind === 'character-scope'
            ? '加载角色卡'
            : bookSettingsView.kind === 'world-scope'
              ? '加载世界观设定'
          : '本书设定';

  const openBookSettings = () => {
    setBookSettingsView({ kind: 'root' });
    bookSettingsDialog.current?.showModal();
  };
  const resetSourceSelection = () => {
    setSourceSelectionMode(null);
    setSelectedSourceIds(new Set());
  };

  return {
    bookSettingsDialog, bookSettingsTrigger, bookSettingsBackButton, bookSettingsView,
    openSettingsSections, sourceSelectionMode, selectedSourceIds, setSelectedSourceIds,
    toggleSourceSelectionMode, moveSource, openBookSettingsPage, openSourceScope,
    returnBookSettingsParent, closeBookSettings, resetBookSettings, setSettingsSectionOpen,
    settingsCharacter, settingsWorldRule, bookSettingsTitle, openBookSettings, resetSourceSelection,
  };
}
