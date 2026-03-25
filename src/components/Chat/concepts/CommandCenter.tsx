/**
 * Concept 2: Command Center
 *
 * Information-dense, terminal-inspired design. Compact 30px header with
 * monospace status strip, `>` prefixed user messages, inter-message dividers,
 * terminal-style empty state with blinking cursor, slide-in sidebar-style
 * dropdown panels. Split-pane integrated dev console.
 */
import React from 'react';
import {
  X, Bug, Code, FileCode, Globe, Terminal, Plus, Trash2, Key,
  Volume2, VolumeX,
} from 'lucide-react';
import type { ConceptLayout, ConceptHeaderProps, ConceptEmptyStateProps, ConceptDropdownWrapperProps, ConceptDevConsoleWrapperProps, MessageBubbleStyles } from './types';

/* ── Header ─────────────────────────────────────────────────────────── */
const Header: React.FC<ConceptHeaderProps> = ({
  ttsEnabled, onToggleTts, isSpeaking, onStopSpeaking,
  showSettings, onToggleSettings,
  showDevConsole, onToggleDevConsole,
  showHistory, onToggleHistory, onRefreshSessions,
  onNew, onClear, onClose,
}) => {
  const iconBtn = (active: boolean): React.CSSProperties => ({
    color: active ? 'var(--theme-accent)' : 'var(--theme-foreground-subtle)',
    backgroundColor: active ? 'color-mix(in srgb, var(--theme-accent) 10%, transparent)' : 'transparent',
    borderRadius: 3,
    transition: 'all 0.1s ease',
  });

  return (
    <div
      className="h-[30px] flex items-center px-2 pr-[140px] flex-shrink-0 font-mono"
      style={{
        backgroundColor: 'var(--theme-bg-tertiary, var(--theme-bg-secondary))',
        borderBottom: '2px solid var(--theme-accent)',
      }}
    >
      <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: 'var(--theme-accent)' }}>
        CMD
      </span>
      <span className="text-[10px] mx-1.5" style={{ color: 'var(--theme-foreground-subtle)' }}>//</span>
      <span className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>
        guIDE
      </span>

      <div className="flex-1 min-w-0" />

      <div className="flex items-center gap-0 flex-shrink-0 chat-header-buttons">
        {([
          { active: ttsEnabled, icon: ttsEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />, onClick: () => { onToggleTts(); if (isSpeaking) onStopSpeaking(); }, title: 'TTS' },
          { active: showSettings, icon: <Key size={11} />, onClick: onToggleSettings, title: 'Keys' },
          { active: showDevConsole, icon: <Terminal size={11} />, onClick: onToggleDevConsole, title: 'Log' },
          { active: false, icon: <Plus size={11} />, onClick: onNew, title: 'New' },
          { active: showHistory, icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2H2.5C1.67 2 1 2.67 1 3.5v9C1 13.33 1.67 14 2.5 14h11c.83 0 1.5-.67 1.5-1.5v-9C15 2.67 14.33 2 13.5 2zM4 5h8v1H4V5zm0 3h8v1H4V8zm0 3h5v1H4v-1z"/></svg>, onClick: () => { onToggleHistory(); if (!showHistory) onRefreshSessions(); }, title: 'History' },
          { active: false, icon: <Trash2 size={11} />, onClick: onClear, title: 'Clear' },
        ] as const).map((b, i) => (
          <button
            key={i}
            className="w-[22px] h-[22px] flex items-center justify-center"
            style={iconBtn(b.active)}
            onClick={b.onClick}
            title={b.title}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; e.currentTarget.style.backgroundColor = 'var(--theme-selection)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = iconBtn(b.active).color as string; e.currentTarget.style.backgroundColor = iconBtn(b.active).backgroundColor as string; }}
          >
            {b.icon}
          </button>
        ))}

        <div style={{ width: 1, height: 12, backgroundColor: 'var(--theme-foreground-subtle)', margin: '0 3px', opacity: 0.3 }} />

        <button
          className="w-[22px] h-[22px] flex items-center justify-center"
          style={iconBtn(false)}
          onClick={onClose}
          title="Close"
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-foreground-subtle)'; }}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
};

/* ── Empty State ────────────────────────────────────────────────────── */
const EmptyState: React.FC<ConceptEmptyStateProps> = ({ onSetInput, licenseStatus }) => (
  <div className="flex flex-col items-start justify-center h-full px-5 font-mono">
    <div className="mb-6">
      <div className="text-[11px] mb-1" style={{ color: 'var(--theme-foreground-subtle)' }}>
        // guIDE Command Center
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[14px] font-bold" style={{ color: 'var(--theme-accent)' }}>&gt;</span>
        <span className="text-[13px]" style={{ color: 'var(--theme-foreground-muted)' }}>
          ready
        </span>
        <span
          className="inline-block w-[7px] h-[14px] ml-0.5"
          style={{ backgroundColor: 'var(--theme-accent)', animation: 'pulse 1.2s step-end infinite' }}
        />
      </div>
    </div>

    <div className="space-y-1 w-full max-w-[300px]">
      {[
        { cmd: 'debug', label: 'Find and fix bugs', icon: <Bug size={11} /> },
        { cmd: 'explain', label: 'Explain this code', icon: <Code size={11} /> },
        { cmd: 'refactor', label: 'Refactor selection', icon: <FileCode size={11} /> },
        { cmd: 'search', label: 'Search the web', icon: <Globe size={11} /> },
      ].map((action, i) => (
        <button
          key={i}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] rounded transition-colors text-left"
          style={{ backgroundColor: 'transparent', color: 'var(--theme-foreground-muted)' }}
          onClick={() => onSetInput(action.label)}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'var(--theme-selection)';
            e.currentTarget.style.color = 'var(--theme-foreground)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--theme-foreground-muted)';
          }}
        >
          <span style={{ color: 'var(--theme-accent)' }}>{action.icon}</span>
          <span className="font-mono text-[10px]" style={{ color: 'var(--theme-accent)', minWidth: 52 }}>{action.cmd}</span>
          <span className="text-[11px]">{action.label}</span>
        </button>
      ))}
    </div>

    {licenseStatus && !licenseStatus.isActivated && (
      <div
        className="mt-5 px-2.5 py-1.5 rounded text-[10px] font-mono max-w-[300px]"
        style={{
          color: 'var(--theme-foreground-muted)',
          backgroundColor: 'var(--theme-bg-secondary)',
          border: '1px solid var(--theme-border)',
        }}
      >
        // cloud requires activation &mdash;{' '}
        <a href="https://graysoft.dev/account" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--theme-accent)' }}>
          subscribe
        </a>
      </div>
    )}
  </div>
);

/* ── Dropdown Wrapper (sidebar slide-in style) ──────────────────────── */
const DropdownWrapper: React.FC<ConceptDropdownWrapperProps> = ({ children, type }) => (
  <div
    className="flex-shrink-0 overflow-auto chat-dropdown-panel"
    style={{
      maxHeight: type === 'settings' ? 320 : 200,
      backgroundColor: 'var(--theme-bg-secondary)',
      borderBottom: '2px solid var(--theme-accent)',
    }}
  >
    <div className="px-2.5 py-2">
      {children}
    </div>
  </div>
);

/* ── Dev Console Wrapper ────────────────────────────────────────────── */
const DevConsoleWrapper: React.FC<ConceptDevConsoleWrapperProps> = ({ children, onClose }) => (
  <div
    className="flex flex-col flex-shrink-0"
    style={{
      maxHeight: 220,
      minHeight: 80,
      borderBottom: '2px solid var(--theme-accent)',
      backgroundColor: 'var(--theme-bg)',
    }}
  >
    <div
      className="flex items-center justify-between px-2.5 py-1 flex-shrink-0 font-mono"
      style={{ borderBottom: '1px solid var(--theme-border)', backgroundColor: 'var(--theme-bg-secondary)' }}
    >
      <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'var(--theme-accent)' }}>
        &gt; stdout
      </span>
      <button
        className="p-0.5 rounded transition-colors"
        style={{ color: 'var(--theme-foreground-muted)' }}
        onClick={onClose}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-foreground-muted)'; }}
      >
        <X size={10} />
      </button>
    </div>
    <div className="flex-1 overflow-auto">
      {children}
    </div>
  </div>
);

/* ── Message bubble styles ──────────────────────────────────────────── */
function getMessageBubbleStyles(role: 'user' | 'assistant' | 'system', isError?: boolean): MessageBubbleStyles {
  if (role === 'user') {
    return {
      outerClassName: 'px-3 py-1 flex justify-start',
      outerStyle: {},
      innerClassName: 'w-full text-[13px] leading-relaxed break-words font-mono',
      innerStyle: {
        color: 'var(--theme-foreground)',
      },
    };
  }
  if (role === 'system') {
    if (isError) {
      return {
        outerClassName: 'px-3 py-1',
        outerStyle: {},
        innerClassName: 'w-full rounded px-2.5 py-1.5 text-[13px] leading-relaxed break-words font-mono',
        innerStyle: {
          backgroundColor: 'color-mix(in srgb, #f44747 10%, var(--theme-bg))',
          color: '#e8a09a',
          border: '1px solid color-mix(in srgb, #f44747 25%, transparent)',
        },
      };
    }
    return {
      outerClassName: 'px-3 py-1',
      outerStyle: {},
      innerClassName: 'w-full text-center rounded px-2.5 py-1.5 text-[12px] leading-relaxed break-words font-mono',
      innerStyle: {
        backgroundColor: 'var(--theme-bg-secondary)',
        color: 'var(--theme-foreground-subtle)',
        borderLeft: '2px solid var(--theme-border)',
      },
    };
  }
  // assistant — clean block with top divider
  return {
    outerClassName: 'px-3 py-1.5',
    outerStyle: { borderTop: '1px solid color-mix(in srgb, var(--theme-border) 30%, transparent)' },
    innerClassName: 'w-full text-[13px] leading-relaxed overflow-hidden break-words px-1',
    innerStyle: {
      color: 'var(--theme-foreground)',
    },
  };
}

/* ── Export ──────────────────────────────────────────────────────────── */
export const CommandCenter: ConceptLayout = {
  Header,
  EmptyState,
  DropdownWrapper,
  DevConsoleWrapper,
  getMessageBubbleStyles,
  messageFooterStyle: {
    borderTop: 'none',
    paddingTop: 2,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  messageFooterClassName: 'flex items-center gap-2',
};
