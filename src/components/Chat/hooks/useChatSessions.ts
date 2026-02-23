/**
 * useChatSessions — Chat session persistence (disk-based via IPC).
 * Extracted from ChatPanel.
 */
import { useState, useEffect, useCallback } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
  webSearchUsed?: boolean;
  ragUsed?: boolean;
  thinkingText?: string;
  images?: { name: string; data: string; mimeType: string }[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  timestamp: number;
}

const MAX_SESSIONS = 10;

export function useChatSessions(messages: ChatMessage[]) {
  const [savedSessions, setSavedSessions] = useState<ChatSession[]>([]);

  const refreshSavedSessions = useCallback(async () => {
    try {
      const result = await window.electronAPI?.loadChatSessions?.();
      if (result?.success && result.sessions) {
        setSavedSessions(result.sessions);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshSavedSessions();
  }, [refreshSavedSessions]);

  const saveCurrentSession = useCallback(async () => {
    if (messages.length === 0) return;
    try {
      const result = await window.electronAPI?.loadChatSessions?.();
      const sessions: ChatSession[] = result?.success && result.sessions ? result.sessions : [];
      const title = messages.find(m => m.role === 'user')?.content.slice(0, 50) || 'Chat session';
      const newSession: ChatSession = {
        id: `session-${Date.now()}`,
        title,
        messages: messages,
        timestamp: Date.now(),
      };
      const updated = [newSession, ...sessions].slice(0, MAX_SESSIONS);
      await window.electronAPI?.saveChatSessions?.(updated);
      setSavedSessions(updated);
    } catch { /* ignore */ }
  }, [messages]);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await (window as any).electronAPI?.deleteChatSession?.(sessionId);
      setSavedSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch { /* ignore */ }
  }, []);

  // Auto-save session when messages change
  useEffect(() => {
    if (messages.length > 0) {
      const timeout = setTimeout(() => saveCurrentSession(), 2000);
      return () => clearTimeout(timeout);
    }
  }, [messages, saveCurrentSession]);

  return { savedSessions, refreshSavedSessions, saveCurrentSession, deleteSession };
}
