import { useEffect, useRef, useState } from 'react';
import { BookOpenText, Check, ChevronDown, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { BookDirectory } from './bookshelf/BookDirectory';
import { BookSettingsDrawer } from './bookshelf/BookSettingsDrawer';
import { BookNameDialog } from './bookshelf/BookNameDialog';
import { BookDeleteDialog } from './bookshelf/BookDeleteDialog';
import { useBookDirectory } from './bookshelf/useBookDirectory';
import { useBookSettings } from './bookshelf/useBookSettings';
import { useBookshelfDialogs } from './bookshelf/useBookshelfDialogs';
import type { BookshelfProps } from './bookshelf/types';

export function Bookshelf(props: BookshelfProps) {
  const [sourceMoveBusy, setSourceMoveBusy] = useState(false);
  const bookLibraryDrawer = useRef<HTMLDetailsElement>(null);
  const bookSelectorTrigger = useRef<HTMLElement>(null);
  const bookActionsMenu = useRef<HTMLDetailsElement>(null);
  const bookActionsTrigger = useRef<HTMLElement>(null);
  const directory = useBookDirectory(props, sourceMoveBusy);
  const settings = useBookSettings(props, directory.canWrite, setSourceMoveBusy);
  const dialogs = useBookshelfDialogs(
    props, directory.canWrite,
    { bookActionsTrigger, bookActionsMenu, bookSettingsDialog: settings.bookSettingsDialog },
    directory.resetSelection, settings.resetSourceSelection,
  );
  const { canEdit, canWrite } = directory;
  const { openCurrentBookNameDialog, openCurrentBookDeleteDialog } = dialogs;

  useEffect(() => {
    const closeBookMenus = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (bookLibraryDrawer.current?.open && !bookLibraryDrawer.current.contains(event.target)) {
        bookLibraryDrawer.current.removeAttribute('open');
      }
      if (bookActionsMenu.current?.open && !bookActionsMenu.current.contains(event.target)) {
        bookActionsMenu.current.removeAttribute('open');
      }
    };
    const closeBookMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (bookActionsMenu.current?.open) {
        bookActionsMenu.current.removeAttribute('open');
        bookActionsTrigger.current?.focus();
        return;
      }
      if (bookLibraryDrawer.current?.open) {
        bookLibraryDrawer.current.removeAttribute('open');
        bookSelectorTrigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeBookMenus);
    document.addEventListener('keydown', closeBookMenuWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeBookMenus);
      document.removeEventListener('keydown', closeBookMenuWithKeyboard);
    };
  }, []);
  return (
    <div className={props.settingsOnly ? undefined : 'shelf-page'}>
      {!props.settingsOnly && <section className="shelf-content">
        <aside className="book-rail" aria-label="书目选择">
          <div className="book-library-controls">
            <details
              ref={bookLibraryDrawer}
              className="book-library-drawer"
              onToggle={(event) => {
                if (event.currentTarget.open) bookActionsMenu.current?.removeAttribute('open');
              }}
            >
              <summary ref={bookSelectorTrigger} className="book-selector-card">
                <BookOpenText aria-hidden="true" />
                <strong>{props.book.title}</strong>
                <ChevronDown className="book-selector-chevron" aria-hidden="true" />
              </summary>
              <div className="book-library-panel">
                <p className="book-list-label">切换书目</p>
                <div className="book-list" aria-label="全部书目">
                  {props.library.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={props.directoryBusy}
                      aria-current={entry.id === props.book.id ? 'true' : undefined}
                      onClick={() => {
                        bookLibraryDrawer.current?.removeAttribute('open');
                        if (entry.id !== props.book.id) props.onOpenBook(entry.id);
                      }}
                    >
                      <BookOpenText aria-hidden="true" />
                      <span>{entry.title}</span>
                      {entry.id === props.book.id && <Check aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>
            </details>
            <details
              ref={bookActionsMenu}
              className="book-actions-menu"
              onToggle={(event) => {
                if (event.currentTarget.open) bookLibraryDrawer.current?.removeAttribute('open');
              }}
            >
              <summary
                ref={bookActionsTrigger}
                className="icon-button book-actions-trigger"
                aria-label={`管理当前书目：${props.book.title}`}
                title="管理当前书目"
              ><Ellipsis aria-hidden="true" /></summary>
              <div className="book-actions-menu-panel" aria-label="当前书目操作">
                <button
                  type="button"
                  className="book-menu-action"
                  aria-haspopup="dialog"
                  disabled={!canWrite}
                  onClick={() => openCurrentBookNameDialog({ kind: 'rename-book', value: props.book.title })}
                ><Pencil aria-hidden="true" /><span>修改书名</span></button>
                <button
                  type="button"
                  className="book-menu-action danger-icon"
                  aria-haspopup="dialog"
                  disabled={!canWrite}
                  title={!canEdit ? '当前页面为只读' : props.directoryBusy ? '当前目录操作进行中' : undefined}
                  onClick={openCurrentBookDeleteDialog}
                ><Trash2 aria-hidden="true" /><span>删除书目</span></button>
              </div>
            </details>
          </div>
        </aside>
        <h1 className="sr-only">故事书屋</h1>
        <BookDirectory
          book={props.book}
          selectedSectionId={props.selectedSectionId}
          onOpenSection={props.onOpenSection}
          onRenameChapter={props.onRenameChapter}
          onRenameSection={props.onRenameSection}
          directoryBusy={props.directoryBusy}
          canUndoDirectoryMove={props.canUndoDirectoryMove}
          controller={directory}
          bookSettingsTrigger={settings.bookSettingsTrigger}
          onOpenSettings={settings.openBookSettings}
          openNameDialog={dialogs.openNameDialog}
          openDeleteDialog={dialogs.openDeleteDialog}
        />
      </section>}
      <BookNameDialog controller={dialogs.name} canWrite={canWrite} />
      <BookDeleteDialog controller={dialogs.deletion} canWrite={canWrite} />
      <BookSettingsDrawer
        book={props.book}
        onBookChange={props.onBookChange}
        canWrite={canWrite}
        controller={settings}
        openNameDialog={dialogs.openNameDialog}
        openDeleteDialog={dialogs.openDeleteDialog}
      />
    </div>
  );
}
