import React, { useState, useEffect } from 'react';
import { X, FileText, Code, Search, Wrench, FlaskConical, BookOpen, CheckCircle, Sparkles } from 'lucide-react';
import { taskQueueService } from '@/services/taskQueueService';
import { editorService } from '@/services/editorService';
import type { TaskType, TaskPriority, TaskInput } from '@/types/taskQueue';
import { cn } from '@/utils/helpers';

interface TaskCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate?: (task: any) => void;
}

export const TaskCreator: React.FC<TaskCreatorProps> = ({ isOpen, onClose, onCreate }) => {
  const [taskType, setTaskType] = useState<TaskType>('file_analysis');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [files, setFiles] = useState<string[]>([]);
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [isCreating, setIsCreating] = useState(false);

  const taskTypes: { type: TaskType; label: string; icon: React.ReactNode; description: string }[] = [
    {
      type: 'file_analysis',
      label: 'File Analysis',
      icon: <FileText className="w-4 h-4" />,
      description: 'Analyze code structure, dependencies, and quality'
    },
    {
      type: 'code_generation',
      label: 'Code Generation',
      icon: <Code className="w-4 h-4" />,
      description: 'Generate code based on requirements'
    },
    {
      type: 'refactoring',
      label: 'Refactoring',
      icon: <Wrench className="w-4 h-4" />,
      description: 'Improve code structure and maintainability'
    },
    {
      type: 'testing',
      label: 'Testing',
      icon: <FlaskConical className="w-4 h-4" />,
      description: 'Generate and run tests for your code'
    },
    {
      type: 'documentation',
      label: 'Documentation',
      icon: <BookOpen className="w-4 h-4" />,
      description: 'Generate documentation and comments'
    },
    {
      type: 'linting',
      label: 'Linting',
      icon: <CheckCircle className="w-4 h-4" />,
      description: 'Check code quality and style issues'
    },
    {
      type: 'formatting',
      label: 'Formatting',
      icon: <Sparkles className="w-4 h-4" />,
      description: 'Format code according to style guidelines'
    },
    {
      type: 'search_replace',
      label: 'Search & Replace',
      icon: <Search className="w-4 h-4" />,
      description: 'Search and replace text across files'
    }
  ];

  const priorities: { value: TaskPriority; label: string; color: string }[] = [
    { value: 'low', label: 'Low', color: 'bg-success/20 text-success border-success/30' },
    { value: 'medium', label: 'Medium', color: 'bg-info/20 text-info border-info/30' },
    { value: 'high', label: 'High', color: 'bg-warning/20 text-warning border-warning/30' },
    { value: 'urgent', label: 'Urgent', color: 'bg-error/20 text-error border-error/30' }
  ];

  const handleCreate = async () => {
    if (!title.trim()) {
      return;
    }

    setIsCreating(true);

    try {
      // Build task input
      const input: TaskInput = {
        files: files.length > 0 ? files : undefined,
        parameters: { ...parameters },
        context: {
          projectPath: '', // Could be extracted from editor
          selectedFiles: files,
          activeEditor: editorService.getActiveTab()?.filePath
        }
      };

      // Add specific parameters based on task type
      switch (taskType) {
        case 'code_generation':
          input.parameters = {
            ...input.parameters,
            language: parameters.language || 'javascript',
            prompt: parameters.prompt || title
          };
          break;
        case 'search_replace':
          input.parameters = {
            ...input.parameters,
            search: parameters.search,
            replace: parameters.replace
          };
          break;
      }

      const task = await taskQueueService.createTask(
        taskType,
        title,
        input,
        priority,
        description
      );

      onCreate?.(task);
      onClose();
      
      // Reset form
      setTitle('');
      setDescription('');
      setPriority('medium');
      setFiles([]);
      setParameters({});
      
    } catch (error) {
      console.error('Failed to create task:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddCurrentFile = () => {
    const activeTab = editorService.getActiveTab();
    if (activeTab && activeTab.filePath && !files.includes(activeTab.filePath)) {
      setFiles([...files, activeTab.filePath]);
    }
  };

  const handleAddOpenFiles = () => {
    const allTabs = editorService.getAllTabs();
    const openFiles = allTabs
      .map(tab => tab.filePath)
      .filter(Boolean) as string[];
    
    const newFiles = openFiles.filter(file => !files.includes(file));
    setFiles([...files, ...newFiles]);
  };

  const handleRemoveFile = (fileToRemove: string) => {
    setFiles(files.filter(file => file !== fileToRemove));
  };

  const renderParameterFields = () => {
    switch (taskType) {
      case 'code_generation':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Language
              </label>
              <select
                value={parameters.language || ''}
                onChange={(e) => setParameters({ ...parameters, language: e.target.value })}
                className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground"
              >
                <option value="">Select language...</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="cpp">C++</option>
                <option value="csharp">C#</option>
                <option value="go">Go</option>
                <option value="rust">Rust</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Prompt
              </label>
              <textarea
                value={parameters.prompt || ''}
                onChange={(e) => setParameters({ ...parameters, prompt: e.target.value })}
                placeholder="Describe what code you want to generate..."
                className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground placeholder-foreground-subtle resize-none"
                rows={3}
              />
            </div>
          </div>
        );
      
      case 'search_replace':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Search Pattern
              </label>
              <input
                type="text"
                value={parameters.search || ''}
                onChange={(e) => setParameters({ ...parameters, search: e.target.value })}
                placeholder="Text or regex pattern to search for..."
                className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground placeholder-foreground-subtle"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Replace With
              </label>
              <input
                type="text"
                value={parameters.replace || ''}
                onChange={(e) => setParameters({ ...parameters, replace: e.target.value })}
                placeholder="Replacement text..."
                className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground placeholder-foreground-subtle"
              />
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  // Hide BrowserView while this modal is open (native overlay sits above DOM)
  useEffect(() => {
    if (isOpen) {
      window.dispatchEvent(new Event('browser-overlay-show'));
      return () => { window.dispatchEvent(new Event('browser-overlay-hide')); };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-background/95 border border-border rounded-lg p-6 z-50 max-w-2xl mx-auto my-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">Create Task</h2>
        <button
          onClick={onClose}
          className="p-2 rounded hover:bg-background-tertiary transition-colors"
        >
          <X className="w-4 h-4 text-foreground" />
        </button>
      </div>

      <div className="space-y-6">
        {/* Task Type Selection */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-3">
            Task Type
          </label>
          <div className="grid grid-cols-2 gap-3">
            {taskTypes.map((task) => (
              <button
                key={task.type}
                onClick={() => setTaskType(task.type)}
                className={cn(
                  'p-3 border rounded-lg text-left transition-colors',
                  taskType === task.type
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-background-tertiary'
                )}
              >
                <div className="flex items-center space-x-2 mb-1">
                  {task.icon}
                  <span className="font-medium text-foreground">{task.label}</span>
                </div>
                <p className="text-xs text-foreground-subtle">{task.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Basic Information */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter task title..."
              className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground placeholder-foreground-subtle"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of what this task should accomplish..."
              className="w-full px-3 py-2 bg-background-input border border-border rounded text-sm text-foreground placeholder-foreground-subtle resize-none"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Priority
            </label>
            <div className="flex space-x-2">
              {priorities.map((priorityOption) => (
                <button
                  key={priorityOption.value}
                  onClick={() => setPriority(priorityOption.value)}
                  className={cn(
                    'px-3 py-1.5 text-sm rounded border transition-colors',
                    priorityOption.value === priority
                      ? priorityOption.color
                      : 'border-border hover:bg-background-tertiary'
                  )}
                >
                  {priorityOption.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Files */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Files
          </label>
          <div className="space-y-2">
            <div className="flex space-x-2">
              <button
                onClick={handleAddCurrentFile}
                className="px-3 py-1.5 text-sm bg-background-tertiary text-foreground rounded hover:bg-background transition-colors"
              >
                Add Current File
              </button>
              <button
                onClick={handleAddOpenFiles}
                className="px-3 py-1.5 text-sm bg-background-tertiary text-foreground rounded hover:bg-background transition-colors"
              >
                Add All Open Files
              </button>
            </div>
            
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((file) => (
                  <div
                    key={file}
                    className="flex items-center justify-between p-2 bg-background-tertiary rounded"
                  >
                    <span className="text-sm text-foreground truncate">{file}</span>
                    <button
                      onClick={() => handleRemoveFile(file)}
                      className="p-1 rounded hover:bg-background transition-colors"
                    >
                      <X className="w-3 h-3 text-foreground-subtle" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Type-specific Parameters */}
        {renderParameterFields()}

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-background-tertiary text-foreground rounded hover:bg-background transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || isCreating}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
};
