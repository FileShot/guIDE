/**
 * TodoPanel.tsx — Displays the agent's TODO/plan list in the chat panel.
 * Receives todo updates via IPC from the backend when the model calls write_todos/update_todo.
 * Collapsible, compact, and visually integrated with the chat UI.
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

const statusIcon = (status: string) => {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />;
    case 'in-progress':
      return <Loader2 size={14} className="text-blue-400 animate-spin flex-shrink-0" />;
    default:
      return <Circle size={14} className="text-[#666] flex-shrink-0" />;
  }
};

export const TodoPanel: React.FC<TodoPanelProps> = ({ todos }) => {
  const [expanded, setExpanded] = useState(true);

  if (!todos || todos.length === 0) return null;

  const done = todos.filter(t => t.status === 'done').length;
  const total = todos.length;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mx-2 mb-2 rounded-md border border-[#333] bg-[#1e1e1e] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#2a2a2a] transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <ListTodo size={13} className="text-blue-400" />
        <span className="font-medium">Plan</span>
        <span className="text-[#888] ml-auto">{done}/{total}</span>
        {/* Progress bar */}
        <div className="w-16 h-1.5 bg-[#333] rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </button>

      {/* Items */}
      {expanded && (
        <div className="px-3 pb-2 space-y-0.5">
          {todos.map(todo => (
            <div
              key={todo.id}
              className={`flex items-start gap-2 py-0.5 text-xs transition-all duration-300 ${
                todo.status === 'done'
                  ? 'text-[#666] line-through opacity-60'
                  : todo.status === 'in-progress'
                    ? 'text-[#dcdcaa]'
                    : 'text-[#ccc]'
              }`}
            >
              {statusIcon(todo.status)}
              <span className="leading-tight">{todo.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
