import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface MenuItem {
  label?: string;
  accelerator?: string;
  action?: string;
  separator?: boolean;
  role?: string;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

// Extracted component so useRef is valid (not inside a .map)
const MenuDropdown: React.FC<{
  menu: MenuDef;
  isActive: boolean;
  onMenuClick: (label: string) => void;
  onMenuHover: (label: string) => void;
  onItemClick: (item: MenuItem) => void;
  hasActiveMenu: boolean;
}> = ({ menu, isActive, onMenuClick, onMenuHover, onItemClick, hasActiveMenu }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (isActive && buttonRef.current) {
      setRect(buttonRef.current.getBoundingClientRect());
    }
  }, [isActive]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        className={`px-2.5 h-[36px] text-[13px] hover:bg-[#ffffff15] transition-colors ${
          isActive ? 'bg-[#ffffff20]' : ''
        }`}
        onClick={() => onMenuClick(menu.label)}
        onMouseEnter={() => {
          if (hasActiveMenu) onMenuHover(menu.label);
        }}
      >
        {menu.label}
      </button>
      {isActive && rect && createPortal(
        <div
          data-menubar-dropdown="true"
          className="fixed border border-[#454545]/60 shadow-2xl rounded-sm py-1 min-w-[240px] glass"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary, #252526) 85%, transparent)',
            zIndex: 99999,
            top: rect.bottom,
            left: rect.left,
          }}
        >
          {menu.items.map((item, i) =>
            item.separator ? (
              <div key={`sep-${i}`} className="h-px bg-[#454545] my-1 mx-2" />
            ) : (
              <button
                key={item.label}
                className="w-full text-left px-4 py-1.5 text-[13px] text-[#cccccc] hover:bg-[#094771] flex items-center justify-between"
                onClick={() => onItemClick(item)}
              >
                <span>{item.label}</span>
                {item.accelerator && (
                  <span className="text-[11px] text-[#858585] ml-6">{item.accelerator}</span>
                )}
              </button>
            )
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

interface MenuDef {
  label: string;
  items: MenuItem[];
}

interface MenuBarProps {
  onAction: (action: string) => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({ onAction }) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  const menus: MenuDef[] = [
    {
      label: 'File',
      items: [
        { label: 'New File', accelerator: 'Ctrl+N', action: 'new-file' },
        { label: 'New Project...', action: 'new-project' },
        { separator: true },
        { label: 'Open File...', accelerator: 'Ctrl+O', action: 'open-file-dialog' },
        { label: 'Open Folder...', accelerator: 'Ctrl+K Ctrl+O', action: 'open-folder-dialog' },
        { separator: true },
        { label: 'Save', accelerator: 'Ctrl+S', action: 'save' },
        { label: 'Save All', accelerator: 'Ctrl+K S', action: 'save-all' },
        { separator: true },
        { label: 'Exit', accelerator: 'Alt+F4', action: 'exit' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', accelerator: 'Ctrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Ctrl+Shift+Z', role: 'redo' },
        { separator: true },
        { label: 'Cut', accelerator: 'Ctrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'Ctrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'Ctrl+V', role: 'paste' },
        { separator: true },
        { label: 'Find', accelerator: 'Ctrl+F', action: 'find' },
        { label: 'Replace', accelerator: 'Ctrl+H', action: 'replace' },
        { label: 'Find in Files', accelerator: 'Ctrl+Shift+F', action: 'find-in-files' },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Command Palette...', accelerator: 'Ctrl+Shift+P', action: 'command-palette' },
        { separator: true },
        { label: 'Explorer', accelerator: 'Ctrl+Shift+E', action: 'toggle-explorer' },
        { label: 'Search', accelerator: 'Ctrl+Shift+F', action: 'toggle-search' },
        { label: 'Source Control', accelerator: 'Ctrl+Shift+G', action: 'toggle-git' },
        { separator: true },
        { label: 'Terminal', accelerator: 'Ctrl+`', action: 'toggle-terminal' },
        { label: 'AI Chat', action: 'toggle-chat' },
        { label: 'Browser', action: 'toggle-browser' },
        { separator: true },
        { label: 'Toggle Full Screen', accelerator: 'F11', action: 'toggle-fullscreen' },
      ],
    },
    {
      label: 'Terminal',
      items: [
        { label: 'New Terminal', accelerator: 'Ctrl+Shift+`', action: 'new-terminal' },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Welcome Guide', action: 'welcome-guide' },
        { separator: true },
        { label: 'About guIDE', action: 'about' },
        { separator: true },
        { label: 'Toggle Developer Tools', accelerator: 'F12', action: 'toggle-devtools' },
      ],
    },
  ];

  // Close menu when clicking outside (but not on dropdown portal items)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking inside the menu bar
      if (menuBarRef.current && menuBarRef.current.contains(target)) return;
      // Don't close if clicking inside a portaled dropdown (identified by data attribute)
      if (target.closest?.('[data-menubar-dropdown]')) return;
      setActiveMenu(null);
    };
    if (activeMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [activeMenu]);

  // Hide BrowserView (native overlay) when menu is open so dropdowns aren't hidden behind it
  useEffect(() => {
    if (activeMenu) {
      window.dispatchEvent(new Event('browser-overlay-show'));
    } else {
      window.dispatchEvent(new Event('browser-overlay-hide'));
    }
  }, [activeMenu]);

  const handleMenuClick = (label: string) => {
    setActiveMenu(activeMenu === label ? null : label);
  };

  const handleItemClick = (item: MenuItem) => {
    setActiveMenu(null);
    if (item.action) {
      onAction(item.action);
    }
  };

  return (
    <div
      ref={menuBarRef}
      className="flex items-center h-full text-[13px] text-[#cccccc]/80"
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      {menus.map(menu => (
        <MenuDropdown
          key={menu.label}
          menu={menu}
          isActive={activeMenu === menu.label}
          onMenuClick={handleMenuClick}
          onMenuHover={setActiveMenu}
          onItemClick={handleItemClick}
          hasActiveMenu={!!activeMenu}
        />
      ))}
    </div>
  );
};
