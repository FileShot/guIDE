import React, { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  shortcut?: string;
  action: () => void;
  danger?: boolean;
  divider?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position if menu would overflow viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-[#2d2d2d]/85 glass border border-[#454545]/60 rounded shadow-xl py-1 min-w-[180px] select-none"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={i} className="border-t border-[#454545] my-1" />;
        }
        return (
          <button
            key={i}
            className={`w-full text-left px-3 py-[5px] text-[12px] flex items-center justify-between gap-4 transition-colors ${
              item.disabled
                ? 'text-[#585858] cursor-not-allowed'
                : item.danger
                ? 'text-[#f14c4c] hover:bg-[#3c3c3c]'
                : 'text-[#cccccc] hover:bg-[#094771]'
            }`}
            onClick={() => {
              if (!item.disabled) {
                item.action();
                onClose();
              }
            }}
            disabled={item.disabled}
          >
            <span className="flex items-center gap-2">
              {item.icon && <span className="text-[11px] w-4 text-center">{item.icon}</span>}
              {item.label}
            </span>
            {item.shortcut && (
              <span className="text-[10px] text-[#858585]">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
