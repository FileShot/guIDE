/**
 * Concept 1: Minimal Studio
 *
 * Ultra-clean, borderless design. Transparent header, no assistant bubbles,
 * thin accent-border blockquote style for assistant messages, pill-shaped
 * user messages, floating popover dropdowns.
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
  const btn = (active: boolean) => ({
    color: active ? 'var(--theme-accent)' : 'var(--theme-foreground-subtle)',
    backgroundColor: active ? 'color-mix(in srgb, var(--theme-accent) 8%, transparent)' : 'transparent',
    borderRadius: 6,
    transition: 'all 0.15s ease',
  });

  return (
    <div
      className="h-[34px] flex items-center px-3 pr-[140px] flex-shrink-0"
      style={{ backgroundColor: 'transparent', borderBottom: '1px solid color-mix(in srgb, var(--theme-border) 40%, transparent)' }}
    >
      <span
        className="text-[11px] font-medium tracking-wide uppercase brand-font"
        style={{ color: 'var(--theme-foreground-muted)', letterSpacing: '0.08em' }}
      >
        gu<span style={{ color: 'var(--theme-accent)' }}>IDE</span>
      </span>

      <div className="flex-1 min-w-0" />

      <div className="flex items-center gap-0.5 flex-shrink-0 chat-header-buttons">
        <button
          className="w-[24px] h-[24px] flex items-center justify-center"
          style={btn(ttsEnabled)}
          onClick={() => { onToggleTts(); if (isSpeaking) onStopSpeaking(); }}
          title={ttsEnabled ? 'TTS On' : 'TTS Off'}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = btn(ttsEnabled).color; }}
        >
          {ttsEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
        </button>

        <button
          className="w-[24px] h-[24px] flex items-center justify-center"
          style={btn(showSettings)}
          onClick={onToggleSettings}
          title="API Keys"
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = btn(showSettings).color; }}
        >
          <Key size={13} />
        </button>

        <button
          className="w-[24px] h-[24px] flex items-center justify-center"
          style={btn(showDevConsole)}
          onClick={onToggleDevConsole}
          title="Developer Console"
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = btn(showDevConsole).color; }}
        >
          <Terminal size={12} />
        </button>

        <button
          className="w-[24px] h-[24px] flex items-center justify-center"
          style={btn(false)}
          onClick={onNew}
          title="New Conversation"
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-foreground-subtle)'; }}
        >
          <Plus size={13} />
        </button>

        <button
          className="w-[24px] h-[24px] flex items-center justify-center"
          style={btn(showHistory)}
          onClick={() => { onToggleHistory(); if (!showHistory) onRefreshSessions(); }}
          title="Chat History"
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = btn(showHistory).color; }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2H2.5C1.67 2 1 2.67 1 3.5v9C1 13.33 1.67 14 2.5 14h11c.83 0 1.5-.67 1.5-1.5v-9C15 2.67 14.33 2 13.5 2zM4 5h8v1H4V5zm0 3h8v1H4V8zm0 3h5v1H4v-1z"/></svg>
        </button>

        <button
          className="w-[24px] h-[24px] flex items-center justify-center"
          style={btn(false)}
          onClick={onClear}
          title="Clear Chat"
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-foreground-subtle)'; }}
        >
          <Trash2 size={12} />
        </button>

        <div style={{ width: 1, height: 14, backgroundColor: 'color-mix(in srgb, var(--theme-border) 50%, transparent)', margin: '0 4px' }} />

        <button
          className="w-[24px] h-[24px] flex items-center justify-center"
          style={btn(false)}
          onClick={onClose}
          title="Close"
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-foreground-subtle)'; }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
};

/* ── Empty State ────────────────────────────────────────────────────── */
const EmptyState: React.FC<ConceptEmptyStateProps> = ({ onSetInput, licenseStatus }) => (
  <div className="flex flex-col items-center justify-center h-full text-center px-6">
    <p
      className="text-[18px] font-light mb-1"
      style={{ color: 'var(--theme-foreground-muted)' }}
    >
      Start a conversation
    </p>
    <p
      className="text-[11px] mb-6"
      style={{ color: 'var(--theme-foreground-subtle)' }}
    >
      Local-first AI, no cloud required
    </p>

    <div className="grid grid-cols-2 gap-2 w-full max-w-[280px]">
      {[
        { icon: <Bug size={13} />, label: 'Find bugs', desc: 'Detect issues' },
        { icon: <Code size={13} />, label: 'Explain code', desc: 'Understand logic' },
        { icon: <FileCode size={13} />, label: 'Refactor', desc: 'Improve structure' },
        { icon: <Globe size={13} />, label: 'Web search', desc: 'Find answers' },
      ].map((action, i) => (
        <button
          key={i}
          className="flex flex-col items-start px-3 py-2.5 rounded-lg text-left transition-all"
          style={{
            backgroundColor: 'transparent',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-foreground-muted)',
          }}
          onClick={() => onSetInput(action.label)}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--theme-accent)';
            e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--theme-accent) 5%, transparent)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--theme-border)';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <span style={{ color: 'var(--theme-accent)', marginBottom: 4 }}>{action.icon}</span>
          <span className="text-[12px] font-medium" style={{ color: 'var(--theme-foreground)' }}>{action.label}</span>
          <span className="text-[10px]" style={{ color: 'var(--theme-foreground-subtle)' }}>{action.desc}</span>
        </button>
      ))}
    </div>

    {licenseStatus && !licenseStatus.isActivated && (
      <div
        className="mt-5 px-3 py-2 rounded-lg text-[11px] max-w-[280px]"
        style={{
          color: 'var(--theme-foreground-muted)',
          backgroundColor: 'color-mix(in srgb, var(--theme-accent) 6%, transparent)',
          border: '1px solid color-mix(in srgb, var(--theme-accent) 20%, transparent)',
        }}
      >
        Cloud AI requires activation &mdash;{' '}
        <a href="https://graysoft.dev/account" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--theme-accent)' }}>
          Subscribe
        </a>{' '}
        or activate in Settings
      </div>
    )}
  </div>
);

/* ── Dropdown Wrapper (floating popover style) ──────────────────────── */
const DropdownWrapper: React.FC<ConceptDropdownWrapperProps> = ({ children, type }) => (
  <div
    className="flex-shrink-0 overflow-auto chat-dropdown-panel"
    style={{
      maxHeight: type === 'settings' ? 320 : 200,
      backgroundColor: 'var(--theme-bg)',
      borderBottom: '1px solid color-mix(in srgb, var(--theme-border) 60%, transparent)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
    }}
  >
    <div className="px-3 py-2.5">
      {children}
    </div>
  </div>
);

/* ── Dev Console Wrapper ────────────────────────────────────────────── */
const DevConsoleWrapper: React.FC<ConceptDevConsoleWrapperProps> = ({ children, onClose }) => (
  <div
    className="flex flex-col flex-shrink-0"
    style={{
      maxHeight: 200,
      minHeight: 80,
      borderBottom: '1px solid color-mix(in srgb, var(--theme-border) 40%, transparent)',
      backgroundColor: 'color-mix(in srgb, var(--theme-bg) 96%, black)',
    }}
  >
    <div className="flex items-center justify-between px-3 py-1 flex-shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
      <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--theme-foreground-muted)' }}>Console</span>
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
      outerClassName: 'px-3 py-1.5 flex justify-end',
      outerStyle: {},
      innerClassName: 'max-w-[85%] rounded-full px-4 py-2 text-[13px] leading-relaxed break-words',
      innerStyle: {
        backgroundColor: 'var(--theme-chat-bubble)',
        color: 'white',
      },
    };
  }
  if (role === 'system') {
    if (isError) {
      return {
        outerClassName: 'px-3 py-1.5',
        outerStyle: {},
        innerClassName: 'w-full rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed break-words',
        innerStyle: {
          backgroundColor: 'color-mix(in srgb, #f44747 10%, var(--theme-bg))',
          color: '#e8a09a',
          border: '1px solid color-mix(in srgb, #f44747 25%, transparent)',
        },
      };
    }
    return {
      outerClassName: 'px-3 py-1.5',
      outerStyle: {},
      innerClassName: 'w-full text-center rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed break-words',
      innerStyle: {
        backgroundColor: 'var(--theme-bg-secondary)',
        color: 'var(--theme-foreground-subtle)',
        border: '1px solid var(--theme-border)',
      },
    };
  }
  // assistant — borderless, left accent border only
  return {
    outerClassName: 'px-3 py-1.5',
    outerStyle: {},
    innerClassName: 'w-full text-[13px] leading-relaxed overflow-hidden break-words pl-3',
    innerStyle: {
      color: 'var(--theme-foreground)',
      borderLeft: '2px solid var(--theme-accent)',
    },
  };
}

/* ── Export ──────────────────────────────────────────────────────────── */
export const MinimalStudio: ConceptLayout = {
  Header,
  EmptyState,
  DropdownWrapper,
  DevConsoleWrapper,
  getMessageBubbleStyles,
  messageFooterStyle: {
    borderTop: 'none',
    paddingTop: 4,
    marginTop: 6,
  },
  messageFooterClassName: 'flex items-center gap-2',
};
