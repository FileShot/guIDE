import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  Plus, 
  Settings, 
  List, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Filter,
  Search,
  RefreshCw
} from 'lucide-react';
import { taskQueueService } from '@/services/taskQueueService';
import type { Task, TaskStatus, TaskPriority, TaskFilter, TaskSort } from '@/types/taskQueue';
import { cn } from '@/utils/helpers';

interface TaskQueuePanelProps {
  className?: string;
}

export const TaskQueuePanel: React.FC<TaskQueuePanelProps> = ({ className }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState<TaskFilter>({});
  const [sort, _setSort] = useState<TaskSort>({ field: 'createdAt', direction: 'desc' });
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadTasks();
    
    // Listen for task events
    const handleTaskEvent = () => {
      loadTasks();
    };
    
    taskQueueService.onTaskEvent(handleTaskEvent);
    
    return () => {
      taskQueueService.removeAllListeners('taskEvent');
    };
  }, [filter, sort]);

  const loadTasks = async () => {
    try {
      const result = taskQueueService.getTasks(filter, sort);
      setTasks(result.tasks);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadTasks();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleTaskAction = async (taskId: string, action: 'pause' | 'resume' | 'cancel') => {
    try {
      let success = false;
      
      switch (action) {
        case 'pause':
          success = await taskQueueService.pauseTask(taskId);
          break;
        case 'resume':
          success = await taskQueueService.resumeTask(taskId);
          break;
        case 'cancel':
          success = await taskQueueService.cancelTask(taskId);
          break;
      }
      
      if (success) {
        await loadTasks();
      }
    } catch (error) {
      console.error(`Failed to ${action} task:`, error);
    }
  };

  const getStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-foreground-subtle" />;
      case 'queued':
        return <List className="w-4 h-4 text-info" />;
      case 'running':
        return <RefreshCw className="w-4 h-4 text-primary animate-spin" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-warning" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-success" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-error" />;
      case 'cancelled':
        return <Square className="w-4 h-4 text-foreground-subtle" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-warning" />;
    }
  };

  const getPriorityColor = (priority: TaskPriority) => {
    switch (priority) {
      case 'urgent':
        return 'bg-error/20 text-error border-error/30';
      case 'high':
        return 'bg-warning/20 text-warning border-warning/30';
      case 'medium':
        return 'bg-info/20 text-info border-info/30';
      case 'low':
        return 'bg-success/20 text-success border-success/30';
      default:
        return 'bg-background-tertiary text-foreground border-border';
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleString();
  };

  const formatDuration = (start?: Date, end?: Date) => {
    if (!start) return '-';
    const endTime = end || new Date();
    const duration = (endTime.getTime() - start.getTime()) / 1000;
    
    if (duration < 60) return `${Math.round(duration)}s`;
    if (duration < 3600) return `${Math.round(duration / 60)}m`;
    return `${Math.round(duration / 3600)}h`;
  };

  const getTaskStats = () => {
    const stats = tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {} as Record<TaskStatus, number>);

    return stats;
  };

  const stats = getTaskStats();

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center space-x-2">
          <List className="w-5 h-5 text-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Task Queue</h2>
          <div className="flex items-center space-x-1 text-xs text-foreground-subtle">
            <span className="px-2 py-1 bg-info/20 text-info rounded">
              {stats.queued || 0} Queued
            </span>
            <span className="px-2 py-1 bg-primary/20 text-primary rounded">
              {stats.running || 0} Running
            </span>
            <span className="px-2 py-1 bg-success/20 text-success rounded">
              {stats.completed || 0} Done
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 rounded hover:bg-background-tertiary transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
          </button>
          <button
            onClick={() => setShowCreateTask(true)}
            className="p-2 rounded hover:bg-background-tertiary transition-colors"
            title="Create Task"
          >
            <Plus className="w-4 h-4 text-foreground" />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded hover:bg-background-tertiary transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4 text-foreground" />
          </button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="p-4 border-b border-border space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-foreground-subtle" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-background-input border border-border rounded text-sm text-foreground placeholder-foreground-subtle focus:outline-none focus:ring-1 focus:ring-border-focus"
          />
        </div>

        {/* Quick Filters */}
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-foreground-subtle" />
          <div className="flex space-x-1">
            {(['all', 'running', 'queued', 'completed', 'failed'] as const).map((status) => (
              <button
                key={status}
                onClick={() => {
                  if (status === 'all') {
                    setFilter({});
                  } else {
                    setFilter({ status: [status as TaskStatus] });
                  }
                }}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  'border',
                  (status === 'all' && !filter.status) || (filter.status?.includes(status as TaskStatus))
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background-tertiary text-foreground border-border hover:bg-background'
                )}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
                {status !== 'all' && ` (${stats[status as TaskStatus] || 0})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="text-center py-8">
            <List className="w-12 h-12 text-foreground-subtle mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No Tasks</h3>
            <p className="text-sm text-foreground-subtle mb-4">
              Create a task to get started with background processing.
            </p>
            <button
              onClick={() => setShowCreateTask(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
            >
              Create Task
            </button>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className={cn(
                  'p-3 rounded-lg border cursor-pointer transition-colors',
                  'hover:bg-background-tertiary',
                  selectedTask?.id === task.id && 'bg-primary/10 border-primary'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      {getStatusIcon(task.status)}
                      <h4 className="text-sm font-medium text-foreground truncate">
                        {task.title}
                      </h4>
                      <span className={cn(
                        'px-1.5 py-0.5 text-xs rounded border',
                        getPriorityColor(task.priority)
                      )}>
                        {task.priority}
                      </span>
                    </div>
                    
                    {task.description && (
                      <p className="text-xs text-foreground-subtle mb-2 line-clamp-2">
                        {task.description}
                      </p>
                    )}

                    <div className="flex items-center space-x-4 text-xs text-foreground-subtle">
                      <span>{task.type}</span>
                      <span>Created {formatDate(task.createdAt)}</span>
                      {task.startedAt && (
                        <span>Duration {formatDuration(task.startedAt, task.completedAt)}</span>
                      )}
                      {task.progress && task.progress.total > 0 && (
                        <span>{task.progress.percentage}%</span>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {task.status === 'running' && task.progress && (
                      <div className="mt-2">
                        <div className="w-full bg-background-tertiary rounded-full h-1.5">
                          <div
                            className="bg-primary h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${task.progress.percentage}%` }}
                          />
                        </div>
                        {task.progress.message && (
                          <p className="text-xs text-foreground-subtle mt-1">
                            {task.progress.message}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Error Message */}
                    {task.status === 'failed' && task.error && (
                      <div className="mt-2 p-2 bg-error/10 border border-error/20 rounded">
                        <p className="text-xs text-error">
                          {task.error.message}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-1 ml-2">
                    {task.status === 'running' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTaskAction(task.id, 'pause');
                        }}
                        className="p-1 rounded hover:bg-background transition-colors"
                        title="Pause"
                      >
                        <Pause className="w-3 h-3 text-foreground-subtle" />
                      </button>
                    )}
                    {task.status === 'paused' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTaskAction(task.id, 'resume');
                        }}
                        className="p-1 rounded hover:bg-background transition-colors"
                        title="Resume"
                      >
                        <Play className="w-3 h-3 text-foreground-subtle" />
                      </button>
                    )}
                    {(task.status === 'queued' || task.status === 'pending' || task.status === 'paused') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTaskAction(task.id, 'cancel');
                        }}
                        className="p-1 rounded hover:bg-background transition-colors"
                        title="Cancel"
                      >
                        <XCircle className="w-3 h-3 text-error" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Task Modal */}
      {showCreateTask && (
        <div className="absolute inset-0 bg-background/95 border border-border rounded-lg p-4 z-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Create Task</h3>
            <button
              onClick={() => setShowCreateTask(false)}
              className="p-1 rounded hover:bg-background-tertiary transition-colors"
            >
              ×
            </button>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Task Type
              </label>
              <select className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground">
                <option value="file_analysis">File Analysis</option>
                <option value="code_generation">Code Generation</option>
                <option value="refactoring">Refactoring</option>
                <option value="testing">Testing</option>
                <option value="documentation">Documentation</option>
                <option value="linting">Linting</option>
                <option value="formatting">Formatting</option>
                <option value="search_replace">Search & Replace</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Title
              </label>
              <input
                type="text"
                placeholder="Enter task title..."
                className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground placeholder-foreground-subtle"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Priority
              </label>
              <select className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            
            <div className="flex justify-end space-x-2 pt-4">
              <button
                onClick={() => setShowCreateTask(false)}
                className="px-4 py-2 bg-background-tertiary text-foreground rounded hover:bg-background transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // Handle task creation
                  setShowCreateTask(false);
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className="absolute inset-0 bg-background/95 border border-border rounded-lg p-4 z-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Queue Settings</h3>
            <button
              onClick={() => setShowSettings(false)}
              className="p-1 rounded hover:bg-background-tertiary transition-colors"
            >
              ×
            </button>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Max Concurrent Tasks
              </label>
              <input
                type="number"
                defaultValue="3"
                min="1"
                max="10"
                className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Max Queue Size
              </label>
              <input
                type="number"
                defaultValue="100"
                min="10"
                max="1000"
                className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground"
              />
            </div>
            
            <div>
              <label className="flex items-center space-x-2">
                <input type="checkbox" defaultChecked className="rounded" />
                <span className="text-sm text-foreground">Enable auto-retry</span>
              </label>
            </div>
            
            <div>
              <label className="flex items-center space-x-2">
                <input type="checkbox" defaultChecked className="rounded" />
                <span className="text-sm text-foreground">Priority preemption</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
