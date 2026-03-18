/**
 * TodoPanel.tsx — Displays the agent's TODO/plan list in the chat panel.
 * Pinned above the input area (VS Code-style). Shows current in-progress task
 * in the header for at-a-glance visibility without expanding.
 */
import React, { useState } from 'react';
import { CheckCircle2, Circle, Loader2, ChevronDown, ChevronRight, ListTodo } from 'lucide-react';

export interface TodoItem {
  id: number;
  text: string;
  status: 'pending' | 'in-progress' | 'done';
}

interface TodoPanelProps {
  todos: TodoItem[];
}

const StatusIcon: React.FC<{ status: string; size?: number }> = ({ status, size = 11 }) => {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={size} className="flex-shrink-0" style={{ color: 'var(--theme-success, #89d185)' }} />;
    case 'in-progress':
      return <Loader2 size={size} className="animate-spin flex-shrink-0" style={{ color: 'var(--theme-accent)' }} />;
    default:
      return <Circle size={size} className="flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)' }} />;
  }
};

export const TodoPanel: React.FC<TodoPanelProps> = ({ todos }) => {
  const [expanded, setExpanded] = useState(true);

  if (!todos || todos.length === 0) return null;

  const done = todos.filter(t => t.status === 'done').length;
  const total = todos.length;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = done === total;
  const inProgress = todos.find(t => t.status === 'in-progress');

  // Truncate active task text to fit the header line
  const activeText = inProgress?.text
    ? inProgress.text.length > 42 ? inProgress.text.slice(0, 42) + '...' : inProgress.text
    : null;

  return (
    <div className="mx-2 mb-0.5 rounded overflow-hidden flex-shrink-0" style={{ border: '1px solid var(--theme-border)', backgroundColor: 'var(--theme-bg-secondary)' }}>
      {/* Header row - VS Code style: chevron + icon + active task + progress */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] transition-colors"
        style={{ color: 'var(--theme-foreground)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-selection)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
      >
        <span className="flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)' }}>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <ListTodo size={10} className="flex-shrink-0" style={{ color: allDone ? 'var(--theme-success, #89d185)' : 'var(--theme-accent)' }} />
        {activeText && !expanded ? (
          <>
            <span className="truncate min-w-0" style={{ color: '#dcdcaa' }}>{activeText}</span>
            <span className="flex-shrink-0 ml-auto pl-2" style={{ color: 'var(--theme-foreground-muted)' }}>{done}/{total}</span>
          </>
        ) : (
          <>
            <span className="font-medium flex-shrink-0" style={{ color: allDone ? 'var(--theme-success, #89d185)' : 'var(--theme-foreground)' }}>
              {allDone ? 'Plan complete' : 'Plan'}
            </span>
            <span className="ml-1 flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)' }}>{done}/{total}</span>
            <div className="flex-1 mx-2 h-[3px] rounded-full overflow-hidden min-w-[24px]" style={{ backgroundColor: 'var(--theme-selection)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%`, backgroundColor: allDone ? 'var(--theme-success, #89d185)' : 'var(--theme-accent)' }}
              />
            </div>
          </>
        )}
      </button>

      {/* Expanded item list — scrollable after ~8 items */}
      {expanded && (
        <div className="px-2 pb-1 pt-0.5 space-y-0 overflow-y-auto" style={{ borderTop: '1px solid var(--theme-border)', maxHeight: '150px' }}>
          {todos.map(todo => (
            <div
              key={todo.id}
              className="flex items-start gap-1.5 py-[1px] text-[10px] transition-all duration-200"
              style={{
                color: todo.status === 'done'
                  ? 'var(--theme-foreground-muted)'
                  : todo.status === 'in-progress'
                    ? '#dcdcaa'
                    : 'var(--theme-foreground)',
                textDecoration: todo.status === 'done' ? 'line-through' : 'none',
                opacity: todo.status === 'done' ? 0.6 : 1,
              }}
            >
              <StatusIcon status={todo.status} />
              <span className="leading-snug">{todo.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};