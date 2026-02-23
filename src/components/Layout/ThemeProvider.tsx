import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface Theme {
  id: string;
  name: string;
  type: 'dark' | 'light';
  colors: {
    // Base
    bg: string;
    bgSecondary: string;
    bgTertiary: string;
    // Sidebar
    sidebar: string;
    sidebarBorder: string;
    // Activity bar
    activityBar: string;
    activityBarActive: string;
    // Title bar
    titleBar: string;
    // Borders
    border: string;
    borderFocus: string;
    // Text
    foreground: string;
    foregroundMuted: string;
    foregroundSubtle: string;
    // Accent
    accent: string;
    accentHover: string;
    // Selection
    selection: string;
    selectionHover: string;
    // Inputs
    inputBg: string;
    inputBorder: string;
    // Status bar
    statusBar: string;
    statusBarFg: string;
    // Tab
    tabActive: string;
    tabInactive: string;
    // Scrollbar
    scrollbar: string;
    scrollbarHover: string;
    // Chat
    chatBubble: string;
  };
}

export const themes: Theme[] = [
  {
    id: 'dark-default',
    name: 'Dark (Default)',
    type: 'dark',
    colors: {
      bg: '#1e1e1e', bgSecondary: '#252526', bgTertiary: '#2d2d2d',
      sidebar: '#252526', sidebarBorder: '#1e1e1e',
      activityBar: '#333333', activityBarActive: '#252526',
      titleBar: '#323233',
      border: '#3c3c3c', borderFocus: '#007acc',
      foreground: '#cccccc', foregroundMuted: '#858585', foregroundSubtle: '#585858',
      accent: '#007acc', accentHover: '#006bb3',
      selection: '#094771', selectionHover: '#2a2d2e',
      inputBg: '#3c3c3c', inputBorder: '#3c3c3c',
      statusBar: '#007acc', statusBarFg: '#ffffff',
      tabActive: '#1e1e1e', tabInactive: '#2d2d2d',
      scrollbar: '#424242', scrollbarHover: '#4f4f4f',
      chatBubble: '#004e87',
    },
  },
  {
    id: 'dark-monokai',
    name: 'Monokai',
    type: 'dark',
    colors: {
      bg: '#272822', bgSecondary: '#1e1f1c', bgTertiary: '#33342d',
      sidebar: '#1e1f1c', sidebarBorder: '#272822',
      activityBar: '#1e1f1c', activityBarActive: '#272822',
      titleBar: '#1e1f1c',
      border: '#3b3c35', borderFocus: '#a6e22e',
      foreground: '#f8f8f2', foregroundMuted: '#75715e', foregroundSubtle: '#49483e',
      accent: '#a6e22e', accentHover: '#8cbf1e',
      selection: '#49483e', selectionHover: '#3b3c35',
      inputBg: '#3b3c35', inputBorder: '#49483e',
      statusBar: '#a6e22e', statusBarFg: '#272822',
      tabActive: '#272822', tabInactive: '#1e1f1c',
      scrollbar: '#49483e', scrollbarHover: '#75715e',
      chatBubble: '#2d431a',
    },
  },
  {
    id: 'dark-dracula',
    name: 'Dracula',
    type: 'dark',
    colors: {
      bg: '#282a36', bgSecondary: '#21222c', bgTertiary: '#343746',
      sidebar: '#21222c', sidebarBorder: '#191a21',
      activityBar: '#21222c', activityBarActive: '#282a36',
      titleBar: '#21222c',
      border: '#44475a', borderFocus: '#bd93f9',
      foreground: '#f8f8f2', foregroundMuted: '#6272a4', foregroundSubtle: '#44475a',
      accent: '#bd93f9', accentHover: '#a67cec',
      selection: '#44475a', selectionHover: '#3a3c4e',
      inputBg: '#343746', inputBorder: '#44475a',
      statusBar: '#bd93f9', statusBarFg: '#282a36',
      tabActive: '#282a36', tabInactive: '#21222c',
      scrollbar: '#44475a', scrollbarHover: '#6272a4',
      chatBubble: '#3d2b5e',
    },
  },
  {
    id: 'dark-nord',
    name: 'Nord',
    type: 'dark',
    colors: {
      bg: '#2e3440', bgSecondary: '#272c36', bgTertiary: '#3b4252',
      sidebar: '#272c36', sidebarBorder: '#2e3440',
      activityBar: '#272c36', activityBarActive: '#2e3440',
      titleBar: '#272c36',
      border: '#3b4252', borderFocus: '#88c0d0',
      foreground: '#d8dee9', foregroundMuted: '#616e88', foregroundSubtle: '#434c5e',
      accent: '#88c0d0', accentHover: '#6eb5c4',
      selection: '#434c5e', selectionHover: '#3b4252',
      inputBg: '#3b4252', inputBorder: '#434c5e',
      statusBar: '#5e81ac', statusBarFg: '#eceff4',
      tabActive: '#2e3440', tabInactive: '#272c36',
      scrollbar: '#434c5e', scrollbarHover: '#4c566a',
      chatBubble: '#2d3f5e',
    },
  },
  {
    id: 'dark-solarized',
    name: 'Solarized Dark',
    type: 'dark',
    colors: {
      bg: '#002b36', bgSecondary: '#00252f', bgTertiary: '#073642',
      sidebar: '#00252f', sidebarBorder: '#002b36',
      activityBar: '#00252f', activityBarActive: '#002b36',
      titleBar: '#00252f',
      border: '#073642', borderFocus: '#268bd2',
      foreground: '#839496', foregroundMuted: '#657b83', foregroundSubtle: '#586e75',
      accent: '#268bd2', accentHover: '#1a7db8',
      selection: '#073642', selectionHover: '#094050',
      inputBg: '#073642', inputBorder: '#094050',
      statusBar: '#268bd2', statusBarFg: '#fdf6e3',
      tabActive: '#002b36', tabInactive: '#00252f',
      scrollbar: '#094050', scrollbarHover: '#586e75',
      chatBubble: '#00363f',
    },
  },
  {
    id: 'dark-github',
    name: 'GitHub Dark',
    type: 'dark',
    colors: {
      bg: '#0d1117', bgSecondary: '#161b22', bgTertiary: '#21262d',
      sidebar: '#161b22', sidebarBorder: '#0d1117',
      activityBar: '#161b22', activityBarActive: '#0d1117',
      titleBar: '#161b22',
      border: '#30363d', borderFocus: '#58a6ff',
      foreground: '#c9d1d9', foregroundMuted: '#8b949e', foregroundSubtle: '#484f58',
      accent: '#58a6ff', accentHover: '#4090e0',
      selection: '#1f6feb33', selectionHover: '#21262d',
      inputBg: '#0d1117', inputBorder: '#30363d',
      statusBar: '#58a6ff', statusBarFg: '#0d1117',
      tabActive: '#0d1117', tabInactive: '#161b22',
      scrollbar: '#30363d', scrollbarHover: '#484f58',
      chatBubble: '#1c3a5c',
    },
  },
  {
    id: 'dark-void',
    name: 'Void',
    type: 'dark',
    colors: {
      bg: '#080808', bgSecondary: '#0f0f0f', bgTertiary: '#181818',
      sidebar: '#0f0f0f', sidebarBorder: '#080808',
      activityBar: '#060606', activityBarActive: '#0f0f0f',
      titleBar: '#060606',
      border: '#1e1e1e', borderFocus: '#888888',
      foreground: '#d0d0d0', foregroundMuted: '#666666', foregroundSubtle: '#3a3a3a',
      accent: '#a0a0a0', accentHover: '#cccccc',
      selection: '#2a2a2a', selectionHover: '#222222',
      inputBg: '#181818', inputBorder: '#1e1e1e',
      statusBar: '#888888', statusBarFg: '#080808',
      tabActive: '#080808', tabInactive: '#0f0f0f',
      scrollbar: '#282828', scrollbarHover: '#3a3a3a',
      chatBubble: '#1c1c1c',
    },
  },
  {
    id: 'light-default',
    name: 'Light',
    type: 'light',
    colors: {
      bg: '#ffffff', bgSecondary: '#f3f3f3', bgTertiary: '#ececec',
      sidebar: '#f3f3f3', sidebarBorder: '#e7e7e7',
      activityBar: '#e0e0e0', activityBarActive: '#f3f3f3',
      titleBar: '#e0e0e0',
      border: '#d4d4d4', borderFocus: '#0066b8',
      foreground: '#333333', foregroundMuted: '#717171', foregroundSubtle: '#999999',
      accent: '#0066b8', accentHover: '#005a9e',
      selection: '#add6ff', selectionHover: '#e8e8e8',
      inputBg: '#ffffff', inputBorder: '#d4d4d4',
      statusBar: '#0066b8', statusBarFg: '#ffffff',
      tabActive: '#ffffff', tabInactive: '#ececec',
      scrollbar: '#c1c1c1', scrollbarHover: '#a0a0a0',
      chatBubble: '#0058b8',
    },
  },
  {
    id: 'dark-catppuccin',
    name: 'Catppuccin Mocha',
    type: 'dark',
    colors: {
      bg: '#1e1e2e', bgSecondary: '#181825', bgTertiary: '#313244',
      sidebar: '#181825', sidebarBorder: '#1e1e2e',
      activityBar: '#181825', activityBarActive: '#1e1e2e',
      titleBar: '#181825',
      border: '#313244', borderFocus: '#cba6f7',
      foreground: '#cdd6f4', foregroundMuted: '#6c7086', foregroundSubtle: '#45475a',
      accent: '#cba6f7', accentHover: '#b48bde',
      selection: '#45475a', selectionHover: '#313244',
      inputBg: '#313244', inputBorder: '#45475a',
      statusBar: '#cba6f7', statusBarFg: '#1e1e2e',
      tabActive: '#1e1e2e', tabInactive: '#181825',
      scrollbar: '#45475a', scrollbarHover: '#585b70',
      chatBubble: '#362b58',
    },
  },
];

interface ThemeContextType {
  theme: Theme;
  setThemeById: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: themes[0],
  setThemeById: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('guIDE-theme');
    return themes.find(t => t.id === saved) || themes.find(t => t.id === 'dark-void') || themes[0];
  });

  const setThemeById = useCallback((id: string) => {
    const t = themes.find(t => t.id === id);
    if (t) {
      setTheme(t);
      localStorage.setItem('guIDE-theme', id);
    }
  }, []);

  // Apply theme as CSS custom properties on :root
  useEffect(() => {
    const root = document.documentElement;
    const c = theme.colors;
    root.style.setProperty('--theme-bg', c.bg);
    root.style.setProperty('--theme-bg-secondary', c.bgSecondary);
    root.style.setProperty('--theme-bg-tertiary', c.bgTertiary);
    root.style.setProperty('--theme-sidebar', c.sidebar);
    root.style.setProperty('--theme-sidebar-border', c.sidebarBorder);
    root.style.setProperty('--theme-activity-bar', c.activityBar);
    root.style.setProperty('--theme-activity-bar-active', c.activityBarActive);
    root.style.setProperty('--theme-title-bar', c.titleBar);
    root.style.setProperty('--theme-border', c.border);
    root.style.setProperty('--theme-border-focus', c.borderFocus);
    root.style.setProperty('--theme-foreground', c.foreground);
    root.style.setProperty('--theme-foreground-muted', c.foregroundMuted);
    root.style.setProperty('--theme-foreground-subtle', c.foregroundSubtle);
    root.style.setProperty('--theme-accent', c.accent);
    root.style.setProperty('--theme-accent-hover', c.accentHover);
    root.style.setProperty('--theme-selection', c.selection);
    root.style.setProperty('--theme-selection-hover', c.selectionHover);
    root.style.setProperty('--theme-input-bg', c.inputBg);
    root.style.setProperty('--theme-input-border', c.inputBorder);
    root.style.setProperty('--theme-status-bar', c.statusBar);
    root.style.setProperty('--theme-status-bar-fg', c.statusBarFg);
    root.style.setProperty('--theme-tab-active', c.tabActive);
    root.style.setProperty('--theme-tab-inactive', c.tabInactive);
    root.style.setProperty('--theme-scrollbar', c.scrollbar);
    root.style.setProperty('--theme-scrollbar-hover', c.scrollbarHover);
    root.style.setProperty('--theme-chat-bubble', c.chatBubble);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setThemeById }}>
      {children}
    </ThemeContext.Provider>
  );
};
