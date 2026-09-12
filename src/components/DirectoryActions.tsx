import type { ReactNode } from 'react';

interface DirectoryAction {
  key: string;
  label: string;
  ariaLabel?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface DirectoryActionsProps {
  label: string;
  items: DirectoryAction[];
  className?: string;
}

export function DirectoryActions({ label, items, className }: DirectoryActionsProps) {
  return (
    <span className={`directory-object-actions ${className ?? ''}`} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`icon-button directory-object-action${item.danger ? ' danger-icon' : ''}`}
          aria-label={item.ariaLabel ?? item.label}
          title={item.label}
          disabled={item.disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            item.onSelect();
          }}
        >
          {item.icon}
        </button>
      ))}
    </span>
  );
}
