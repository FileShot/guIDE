/**
 * Concept Layout Types — shared interface for all UI redesign concepts.
 * Each concept exports components satisfying this interface.
 * ChatPanel imports the active concept and renders using these components,
 * keeping all logic in one place while allowing total visual redesign.
 */
import type React from 'react';

export interface ConceptHeaderProps {
  ttsEnabled: boolean;
  onToggleTts: () => void;
  isSpeaking: boolean;
  onStopSpeaking: () => void;
  showSettings: boolean;
  onToggleSettings: () => void;
  showDevConsole: boolean;
  onToggleDevConsole: () => void;
  showHistory: boolean;
  onToggleHistory: () => void;
  onRefreshSessions: () => void;
  onNew: () => void;
  onClear: () => void;
  onClose: () => void;
}

export interface ConceptEmptyStateProps {
  onSetInput: (text: string) => void;
  licenseStatus: { isActivated: boolean; license?: any } | null;
}

export interface ConceptDropdownWrapperProps {
  children: React.ReactNode;
  type: 'settings' | 'history';
}

export interface ConceptDevConsoleWrapperProps {
  children: React.ReactNode;
  onClose: () => void;
}

export interface MessageBubbleStyles {
  outerClassName: string;
  outerStyle: React.CSSProperties;
  innerClassName: string;
  innerStyle: React.CSSProperties;
}

export interface ConceptLayout {
  /** The top header bar — brand, action buttons */
  Header: React.FC<ConceptHeaderProps>;
  /** Welcome screen shown when message list is empty */
  EmptyState: React.FC<ConceptEmptyStateProps>;
  /** Wrapper for dropdown panels (settings, history) */
  DropdownWrapper: React.FC<ConceptDropdownWrapperProps>;
  /** Wrapper for the developer console panel */
  DevConsoleWrapper: React.FC<ConceptDevConsoleWrapperProps>;
  /** Returns CSS classes/styles for a message bubble based on role */
  getMessageBubbleStyles: (role: 'user' | 'assistant' | 'system', isError?: boolean) => MessageBubbleStyles;
  /** Returns CSS for the assistant message footer (model name, icons) */
  messageFooterStyle: React.CSSProperties;
  messageFooterClassName: string;
}
