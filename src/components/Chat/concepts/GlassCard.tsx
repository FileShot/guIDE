/**
 * Concept 3: Glass Card
 *
 * Glassmorphic design with backdrop-blur effects, translucent surfaces,
 * circular action buttons, card-based message bubbles with subtle borders,
 * layered geometric empty state, floating glass card dropdown panels.
 */
import React from 'react';
import {
  X, Bug, Code, FileCode, Globe, Terminal, Plus, Trash2, Key,
  Sparkles, Volume2, VolumeX, Zap,
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
  const circleBtn = (active: boolean): React.CSSProperties => ({
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: active ? 'var(--theme-accent)' : 'var(--theme-foreground-subtle)',
    backgroundColor: active
      ? 'color-mix(in srgb, var(--theme-accent) 15%, transparent)'
      : 'color-mix(in srgb, var(--theme-foreground) 5%, transparent)',
    border: active ? '1px solid color-mix(in srgb, var(--theme-accent) 30%, transparent)' : '1px solid transparent',
    transition: 'all 0.2s ease',
    cursor: 'pointer',
  });

  return (
    <div
      className="h-[36px] flex items-center px-3 pr-[140px] flex-shrink-0"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 85%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid color-mix(in srgb, var(--theme-border) 50%, transparent)',
      }}
    >
      <Zap size={13} className="mr-1.5 flex-shrink-0" style={{ color: 'var(--theme-accent)' }} />
      <span className="text-[12px] font-semibold brand-font" style={{ color: 'var(--theme-foreground)' }}>
        gu<span style={{ color: 'var(--theme-accent)' }}>IDE</span>
      </span>
      <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded-full" style={{
        color: 'var(--theme-foreground-muted)',
        backgroundColor: 'color-mix(in srgb, var(--theme-foreground) 6%, transparent)',
        fontSize: 9,
      }}>
        AI
      </span>

      <div className="flex-1 min-w-0" />

      <div className="flex items-center gap-1.5 flex-shrink-0 chat-header-buttons">
        {([
          { active: ttsEnabled, icon: ttsEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />, onClick: () => { onToggleTts(); if (isSpeaking) onStopSpeaking(); }, title: 'TTS' },
          { active: showSettings, icon: <Key size={12} />, onClick: onToggleSettings, title: 'API Keys' },
          { active: showDevConsole, icon: <Terminal size={11} />, onClick: onToggleDevConsole, title: 'Console' },
          { active: false, icon: <Plus size={12} />, onClick: onNew, title: 'New' },
          { active: showHistory, icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2H2.5C1.67 2 1 2.67 1 3.5v9C1 13.33 1.67 14 2.5 14h11c.83 0 1.5-.67 1.5-1.5v-9C15 2.67 14.33 2 13.5 2zM4 5h8v1H4V5zm0 3h8v1H4V8zm0 3h5v1H4v-1z"/></svg>, onClick: () => { onToggleHistory(); if (!showHistory) onRefreshSessions(); }, title: 'History' },
          { active: false, icon: <Trash2 size={11} />, onClick: onClear, title: 'Clear' },
        ] as const).map((b, i) => (
          <button
            key={i}
            style={circleBtn(b.active)}
            onClick={b.onClick}
            title={b.title}
            onMouseEnter={e => {
              e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--theme-accent) 20%, transparent)';
              e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--theme-accent) 40%, transparent)';
              e.currentTarget.style.color = 'var(--theme-foreground)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.backgroundColor = circleBtn(b.active).backgroundColor as string;
              e.currentTarget.style.borderColor = circleBtn(b.active).border ? (b.active ? 'color-mix(in srgb, var(--theme-accent) 30%, transparent)' : 'transparent') : 'transparent';
              e.currentTarget.style.color = circleBtn(b.active).color as string;
            }}
          >
            {b.icon}
          </button>
        ))}

        <div style={{ width: 1, height: 16, backgroundColor: 'color-mix(in srgb, var(--theme-border) 40%, transparent)', margin: '0 2px' }} />

        <button
          style={circleBtn(false)}
          onClick={onClose}
          title="Close"
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'color-mix(in srgb, #f44747 15%, transparent)';
            e.currentTarget.style.color = '#f44747';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = circleBtn(false).backgroundColor as string;
            e.currentTarget.style.color = 'var(--theme-foreground-subtle)';
          }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
};

/* ── Empty State ────────────────────────────────────────────────────── */
const EmptyState: React.FC<ConceptEmptyStateProps> = ({ onSetInput, licenseStatus }) => (
  <div className="flex flex-col items-center justify-center h-full text-center px-5">
    {/* Geometric layered accent shape */}
    <div className="relative mb-5" style={{ width: 60, height: 60 }}>
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--theme-accent) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--theme-accent) 15%, transparent)',
          transform: 'rotate(12deg)',
        }}
      />
      <div
        className="absolute inset-1 rounded-xl flex items-center justify-center"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--theme-accent) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--theme-accent) 20%, transparent)',
          transform: 'rotate(-6deg)',
        }}
      >
        <Sparkles size={22} style={{ color: 'var(--theme-accent)', opacity: 0.7 }} />
      </div>
    </div>

    <p className="text-[14px] font-medium mb-0.5" style={{ color: 'var(--theme-foreground)' }}>
      <span className="brand-font">gu<span style={{ color: 'var(--theme-accent)' }}>IDE</span></span> AI
    </p>
    <p className="text-[11px] mb-5" style={{ color: 'var(--theme-foreground-subtle)' }}>
      Local-first intelligence
    </p>

    <div className="space-y-1.5 w-full max-w-[260px]">
      {[
        { icon: <Bug size={12} />, label: 'Find and fix bugs' },
        { icon: <Code size={12} />, label: 'Explain this code' },
        { icon: <FileCode size={12} />, label: 'Refactor selection' },
        { icon: <Globe size={12} />, label: 'Search the web' },
      ].map((action, i) => (
        <button
          key={i}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] rounded-xl transition-all"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-foreground) 3%, transparent)',
            border: '1px solid color-mix(in srgb, var(--theme-border) 60%, transparent)',
            color: 'var(--theme-foreground-muted)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => onSetInput(action.label)}
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--theme-accent) 8%, transparent)';
            e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--theme-accent) 30%, transparent)';
            e.currentTarget.style.color = 'var(--theme-foreground)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--theme-foreground) 3%, transparent)';
            e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--theme-border) 60%, transparent)';
            e.currentTarget.style.color = 'var(--theme-foreground-muted)';
          }}
        >
          <span style={{ color: 'var(--theme-accent)' }}>{action.icon}</span>
          {action.label}
        </button>
      ))}
    </div>

    {licenseStatus && !licenseStatus.isActivated && (
      <div
        className="mt-5 px-3 py-2 rounded-xl text-[11px] max-w-[260px]"
        style={{
          color: 'var(--theme-foreground-muted)',
          backgroundColor: 'color-mix(in srgb, var(--theme-accent) 5%, transparent)',
          border: '1px solid color-mix(in srgb, var(--theme-accent) 15%, transparent)',
          backdropFilter: 'blur(4px)',
        }}
      >
        Cloud AI requires activation &mdash;{' '}
        <a href="https://graysoft.dev/account" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--theme-accent)' }}>
          Subscribe
        </a>
      </div>
    )}
  </div>
);

/* ── Dropdown Wrapper (glass card style) ────────────────────────────── */
const DropdownWrapper: React.FC<ConceptDropdownWrapperProps> = ({ children, type }) => (
  <div
    className="flex-shrink-0 overflow-auto chat-dropdown-panel"
    style={{
      maxHeight: type === 'settings' ? 320 : 200,
      backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 90%, transparent)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid color-mix(in srgb, var(--theme-border) 50%, transparent)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
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
      borderBottom: '1px solid color-mix(in srgb, var(--theme-border) 50%, transparent)',
      backgroundColor: 'color-mix(in srgb, var(--theme-bg) 95%, transparent)',
      backdropFilter: 'blur(8px)',
    }}
  >
    <div
      className="flex items-center justify-between px-3 py-1 flex-shrink-0"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--theme-border) 40%, transparent)' }}
    >
      <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--theme-foreground-muted)' }}>
        Console
      </span>
      <button
        className="w-[18px] h-[18px] rounded-full flex items-center justify-center transition-colors"
        style={{
          color: 'var(--theme-foreground-muted)',
          backgroundColor: 'color-mix(in srgb, var(--theme-foreground) 5%, transparent)',
        }}
        onClick={onClose}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, #f44747 15%, transparent)'; e.currentTarget.style.color = '#f44747'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--theme-foreground) 5%, transparent)'; e.currentTarget.style.color = 'var(--theme-foreground-muted)'; }}
      >
        <X size={9} />
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
      innerClassName: 'max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-[13px] leading-relaxed break-words',
      innerStyle: {
        backgroundColor: 'var(--theme-chat-bubble)',
        color: 'white',
        boxShadow: '0 2px 8px color-mix(in srgb, var(--theme-chat-bubble) 30%, transparent)',
      },
    };
  }
  if (role === 'system') {
    if (isError) {
      return {
        outerClassName: 'px-3 py-1.5',
        outerStyle: {},
        innerClassName: 'w-full rounded-xl px-3 py-2 text-[13px] leading-relaxed break-words',
        innerStyle: {
          backgroundColor: 'color-mix(in srgb, #f44747 8%, transparent)',
          color: '#e8a09a',
          border: '1px solid color-mix(in srgb, #f44747 20%, transparent)',
          backdropFilter: 'blur(4px)',
        },
      };
    }
    return {
      outerClassName: 'px-3 py-1.5',
      outerStyle: {},
      innerClassName: 'w-full text-center rounded-xl px-3 py-2 text-[13px] leading-relaxed break-words',
      innerStyle: {
        backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 80%, transparent)',
        color: 'var(--theme-foreground-subtle)',
        border: '1px solid color-mix(in srgb, var(--theme-border) 50%, transparent)',
        backdropFilter: 'blur(4px)',
      },
    };
  }
  // assistant — glass card style
  return {
    outerClassName: 'px-3 py-1.5',
    outerStyle: {},
    innerClassName: 'w-full rounded-xl px-3 py-2 text-[13px] leading-relaxed overflow-hidden break-words',
    innerStyle: {
      color: 'var(--theme-foreground)',
      backgroundColor: 'color-mix(in srgb, var(--theme-foreground) 3%, transparent)',
      border: '1px solid color-mix(in srgb, var(--theme-border) 40%, transparent)',
      backdropFilter: 'blur(4px)',
    },
  };
}

/* ── Export ──────────────────────────────────────────────────────────── */
export const GlassCard: ConceptLayout = {
  Header,
  EmptyState,
  DropdownWrapper,
  DevConsoleWrapper,
  getMessageBubbleStyles,
  messageFooterStyle: {
    borderTop: '1px solid color-mix(in srgb, var(--theme-border) 30%, transparent)',
    paddingTop: 6,
    marginTop: 8,
  },
  messageFooterClassName: 'flex items-center gap-2',
};
