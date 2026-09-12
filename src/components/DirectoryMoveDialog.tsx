import { Check, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { Book } from '../types';
import { getDirectoryMoveImpact, type DirectoryMove } from '../directoryOperations';

interface DirectoryMoveDialogProps {
  book: Book;
  move: DirectoryMove;
  busy: boolean;
  onChange: (move: DirectoryMove) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function DirectoryMoveDialog({ book, move, busy, onChange, onCancel, onSubmit }: DirectoryMoveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sourceChapter = book.chapters.find((chapter) => chapter.sections.some((section) => section.id === move.id));
  const sourceTitle = move.kind === 'chapter'
    ? book.chapters.find((chapter) => chapter.id === move.id)?.title ?? '章节'
    : sourceChapter?.sections.find((section) => section.id === move.id)?.title ?? '小节';
  const targetChapter = move.kind === 'section'
    ? book.chapters.find((chapter) => chapter.id === move.targetChapterId)
    : undefined;
  const impact = useMemo(() => {
    try {
      return getDirectoryMoveImpact(book, move);
    } catch {
      return [];
    }
  }, [book, move]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return undefined;
  }, []);

  const chapterPositions = move.kind === 'chapter'
    ? book.chapters.filter((chapter) => chapter.id !== move.id)
    : [];
  const sectionPositions = move.kind === 'section'
    ? (targetChapter?.sections ?? []).filter((section) => section.id !== move.id)
    : [];

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog directory-move-dialog"
      aria-labelledby="directory-move-dialog-title"
      aria-describedby="directory-move-dialog-description"
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        <header className="dialog-heading">
          <div>
            <p className="eyebrow">移动目录项目</p>
            <h2 id="directory-move-dialog-title">移动“{sourceTitle}”</h2>
          </div>
          <button type="button" className="icon-button" disabled={busy} onClick={onCancel} aria-label="取消移动" title="取消移动"><X aria-hidden="true" /></button>
        </header>
        <div className="confirm-dialog-body directory-move-dialog-body">
          <p id="directory-move-dialog-description">选择目标位置。保存成功后才会改变目录顺序。</p>
          {move.kind === 'chapter' ? (
            <label className="directory-move-field" htmlFor="directory-move-chapter-position">
              <span>插入位置</span>
              <select
                id="directory-move-chapter-position"
                aria-label="插入位置"
                value={move.beforeId ?? ''}
                onChange={(event) => onChange({ ...move, beforeId: event.target.value || null })}
                disabled={busy}
              >
                {chapterPositions.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>第 {book.chapters.indexOf(chapter) + 1} 章《{chapter.title}》之前</option>
                ))}
                <option value="">目录末尾</option>
              </select>
            </label>
          ) : (
            <>
              <label className="directory-move-field" htmlFor="directory-move-target-chapter">
                <span>目标章节</span>
                <select
                  id="directory-move-target-chapter"
                  aria-label="目标章节"
                  value={move.targetChapterId}
                  onChange={(event) => onChange({ ...move, targetChapterId: event.target.value, beforeId: null })}
                  disabled={busy}
                >
                  {book.chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>第 {book.chapters.indexOf(chapter) + 1} 章《{chapter.title}》</option>
                  ))}
                </select>
              </label>
              <label className="directory-move-field" htmlFor="directory-move-section-position">
                <span>插入位置</span>
                <select
                  id="directory-move-section-position"
                  aria-label="插入位置"
                  value={move.beforeId ?? ''}
                  onChange={(event) => onChange({ ...move, beforeId: event.target.value || null })}
                  disabled={busy}
                >
                  {sectionPositions.map((section) => (
                    <option key={section.id} value={section.id}>“{section.title}”之前</option>
                  ))}
                  <option value="">目标章节末尾</option>
                </select>
              </label>
            </>
          )}
          <section className="directory-move-impact" aria-live="polite">
            {impact.length > 0 ? (
              <>
                <p>此移动会改变 {impact.length} 处前文资格（引用可用性）。</p>
                <p className="directory-move-impact-note">这里表示顺序带来的资格变化；梗概仍需已确认且新鲜才会使用。</p>
                <details>
                  <summary>查看受影响的小节</summary>
                  <ul>
                    {impact.map((entry) => (
                      <li key={`${entry.targetSectionId}:${entry.sourceSectionId}`}>
                        <strong>{entry.targetTitle}</strong> ← {entry.sourceTitle}：移动后{entry.availableAfter ? '可用' : '暂不可用'}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <p>此位置不会改变已有前文资格。</p>
            )}
          </section>
          <div className="dialog-actions">
            <button type="button" className="quiet-action" disabled={busy} onClick={onCancel}>取消</button>
            <button type="submit" className="primary-action button-with-icon" disabled={busy}><Check aria-hidden="true" />确认移动</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
