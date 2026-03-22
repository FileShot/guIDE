/**
 * Concept index — exports all concept layouts and provides a selector.
 *
 * To switch concepts, change the value of `activeConcept` in localStorage
 * key `guIDE-chat-concept`. Valid values: 'minimal-studio', 'command-center',
 * 'glass-card', 'default' (uses the original ChatPanel rendering).
 */
import { MinimalStudio } from './MinimalStudio';
import { CommandCenter } from './CommandCenter';
import { GlassCard } from './GlassCard';
import type { ConceptLayout } from './types';

export type ConceptName = 'minimal-studio' | 'command-center' | 'glass-card' | 'default';

const conceptMap: Record<string, ConceptLayout> = {
  'minimal-studio': MinimalStudio,
  'command-center': CommandCenter,
  'glass-card': GlassCard,
};

/**
 * Returns the active concept layout, or null if 'default' / unknown.
 * ChatPanel checks: if null, render original JSX; otherwise use concept components.
 */
export function getActiveConcept(): ConceptLayout | null {
  try {
    const stored = localStorage.getItem('guIDE-chat-concept');
    if (stored && conceptMap[stored]) return conceptMap[stored];
  } catch { /* SSR / no localStorage */ }
  return null;
}

export function setActiveConcept(name: ConceptName): void {
  try { localStorage.setItem('guIDE-chat-concept', name); } catch {}
}

export { MinimalStudio, CommandCenter, GlassCard };
export type { ConceptLayout } from './types';
