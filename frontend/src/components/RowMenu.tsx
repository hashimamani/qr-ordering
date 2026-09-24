import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreVerticalIcon } from './icons';

export interface RowMenuAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * A single kebab (⋮) button per row that reveals its actions in a
 * dropdown, instead of every action rendered inline -- keeps a table of
 * N rows from turning into a wall of buttons. Closes on outside click,
 * Escape, or selecting an action.
 */
export function RowMenu({ actions, label = 'Row actions' }: { actions: RowMenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="row-menu" ref={ref}>
      <button className="row-menu-trigger" onClick={() => setOpen((v) => !v)} aria-label={label} aria-haspopup="true" aria-expanded={open}>
        <MoreVerticalIcon size={18} />
      </button>
      {open && (
        <div className="row-menu-dropdown" role="menu">
          {actions.map((action, i) => (
            <button
              key={i}
              role="menuitem"
              className={`row-menu-item ${action.danger ? 'danger' : ''}`}
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
