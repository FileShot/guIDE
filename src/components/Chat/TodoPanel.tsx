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

const StatusIcon: React.FC<{ status: string; size?: number }> = ({ status, size = 13 }) => {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={size} className="text-[#89d185] flex-shrink-0" />;
    case 'in-progress':
      return <Loader2 size={size} className="text-[#007acc] animate-spin flex-shrink-0" />;
    default:
      return <Circle size={size} className="text-[#555] flex-shrink-0" />;
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
    <div className="mx-2 mb-1 rounded border border-[#2d2d2d] bg-[#252526] overflow-hidden flex-shrink-0">
      {/* Header row - VS Code style: chevron + icon + active task + progress */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] hover:bg-[#2d2d2d] transition-colors"
      >
        <span className="flex-shrink-0 text-[#666]">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <ListTodo size={12} className={allDone ? 'text-[#89d185] flex-shrink-0' : 'text-[#007acc] flex-shrink-0'} />
        {activeText && !expanded ? (
          <>
            <span className="text-[#dcdcaa] truncate min-w-0">{activeText}</span>
            <span className="text-[#555] flex-shrink-0 ml-auto pl-2">{done}/{total}</span>
          </>
        ) : (
          <>
            <span className={`font-medium flex-shrink-0 ${allDone ? 'text-[#89d185]' : 'text-[#ccc]'}`}>
              {allDone ? 'Plan complete' : 'Plan'}
            </span>
            <span className="text-[#555] ml-1 flex-shrink-0">{done}/{total}</span>
            <div className="flex-1 mx-2 h-[3px] bg-[#333] rounded-full overflow-hidden min-w-[24px]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-[#89d185]' : 'bg-[#007acc]'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </>
        )}
      </button>

      {/* Expanded item list */}
      {expanded && (
        <div className="border-t border-[#2d2d2d] px-2.5 pb-1.5 pt-1 space-y-0.5">
          {todos.map(todo => (
            <div
              key={todo.id}
              className={`flex items-start gap-1.5 py-[2px] text-[11px] transition-all duration-200 ${
                todo.status === 'done'
                  ? 'text-[#555] line-through'
                  : todo.status === 'in-progress'
                    ? 'text-[#dcdcaa]'
                    : 'text-[#888]'
              }`}
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