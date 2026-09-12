import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef } from 'react';

export interface DirectoryActionMenuItem {
  key: string;
  label: string;
  ariaLabel?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface DirectoryActionMenuProps {
  label: string;
  items: DirectoryActionMenuItem[];
  className?: string;
}

/**
 * The directory menu is deliberately a local <details> control.  It keeps
 * the action trigger keyboard reachable without introducing a document-wide
 * menu or gesture manager, and it is safe to place beside a chapter/section
 * row rather than inside the row's open button.
 */
export function DirectoryActionMenu({ label, items, className }: DirectoryActionMenuProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const menuClassName = ['directory-object-menu', className].filter(Boolean).join(' ');

  return (
    <details ref={menuRef} className={menuClassName} data-directory-menu>
      <summary
        className="icon-button directory-object-menu-trigger"
        aria-label={label}
        title={label}
        onClick={(event) => event.stopPropagation()}
      >
        <Ellipsis aria-hidden="true" />
      </summary>
      <div className="directory-object-menu-panel" role="menu" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`directory-object-menu-action${item.danger ? ' danger-icon' : ''}`}
            aria-label={item.ariaLabel}
            disabled={item.disabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              menuRef.current?.removeAttribute('open');
              item.onSelect();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}
