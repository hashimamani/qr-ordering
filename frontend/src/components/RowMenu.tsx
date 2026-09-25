import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
 * Escape, scroll, or selecting an action.
 *
 * The dropdown is rendered into a portal and positioned with `fixed`
 * coordinates measured from the trigger, rather than living inside the
 * row as a normal absolutely-positioned child -- tables/cards this sits
 * in commonly clip overflow (border-radius on `table.data-table`, or an
 * implicit overflow-y:auto from a horizontal-scroll wrapper), which would
 * otherwise cut the dropdown off for any row near an edge.
 */
export function RowMenu({ actions, label = 'Row actions' }: { actions: RowMenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  // `anchorY` is the horizontal line the dropdown snaps to -- read as a
  // `top` coordinate when opening downward, or a `bottom` coordinate
  // (measured from the viewport bottom) when opening upward.
  const [position, setPosition] = useState<{ anchorY: number; right: number; openUpward: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = dropdownRef.current?.offsetHeight ?? 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = dropdownHeight > 0 && spaceBelow < dropdownHeight + 12 && rect.top > spaceBelow;
    setPosition({
      anchorY: openUpward ? window.innerHeight - rect.top + 6 : rect.bottom + 6,
      right: window.innerWidth - rect.right,
      openUpward,
    });
  }, [open, actions.length]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  return (
    <div className="row-menu">
      <button
        ref={triggerRef}
        className="row-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <MoreVerticalIcon size={18} />
      </button>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="row-menu-dropdown"
            role="menu"
            style={{
              position: 'fixed',
              top: position && !position.openUpward ? position.anchorY : undefined,
              bottom: position?.openUpward ? position.anchorY : undefined,
              right: position ? position.right : -9999,
              visibility: position ? 'visible' : 'hidden',
            }}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
