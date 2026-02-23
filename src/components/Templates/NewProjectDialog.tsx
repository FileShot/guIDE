import React, { useState, useEffect, useRef } from 'react';
import {
  X, FolderOpen, Code2, Globe, Server, Terminal, Cpu, Bot, FileCode, Chrome,
  Sparkles, ChevronRight, Loader2, Check, AlertCircle,
  Triangle, Flame, FlaskConical, Brain, Network, Box,
} from 'lucide-react';

interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
}

interface NewProjectDialogProps {
  onClose: () => void;
  onProjectCreated: (projectDir: string) => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  react: <Code2 size={22} className="text-[#61dafb]" />,
  nextjs: <Globe size={22} className="text-white" />,
  nodejs: <Server size={22} className="text-[#68a063]" />,
  python: <FileCode size={22} className="text-[#3776ab]" />,
  electron: <Cpu size={22} className="text-[#47848f]" />,
  html: <FileCode size={22} className="text-[#e34c26]" />,
  chrome: <Chrome size={22} className="text-[#4285f4]" />,
  bot: <Bot size={22} className="text-[#5865f2]" />,
  terminal: <Terminal size={22} className="text-[#4ec9b0]" />,
  vue: <Triangle size={22} className="text-[#42b883]" />,
  svelte: <Flame size={22} className="text-[#ff3e00]" />,
  flask: <FlaskConical size={22} className="text-[#4ec9b0]" />,
  docker: <Box size={22} className="text-[#2496ed]" />,
  ai: <Brain size={22} className="text-[#a78bfa]" />,
  mcp: <Network size={22} className="text-[#4fc1ff]" />,
  folder: <FolderOpen size={22} className="text-[#e8a87c]" />,
};

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  frontend: 'Frontend',
  backend: 'Backend',
  desktop: 'Desktop',
  ai: 'AI',
  tools: 'Tools',
};

const CATEGORY_ORDER = ['general', 'frontend', 'backend', 'desktop', 'ai', 'tools'];

type Step = 'select' | 'configure' | 'creating' | 'done';

export const NewProjectDialog: React.FC<NewProjectDialogProps> = ({ onClose, onProjectCreated }) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [step, setStep] = useState<Step>('select');
  const [error, setError] = useState('');
  const [createdFiles, setCreatedFiles] = useState<string[]>([]);
  const [createdDir, setCreatedDir] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Load templates on mount
  useEffect(() => {
    const load = async () => {
      const api = window.electronAPI as any;
      if (api?.templateList) {
        const result = await api.templateList();
        setTemplates(result || []);
      }
      // Default parent to home directory
      if (api?.getHomeDir) {
        const home = await api.getHomeDir();
        setParentDir(home || '');
      }
    };
    load();
  }, []);

  // Focus name input when moving to configure step
  useEffect(() => {
    if (step === 'configure') {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [step]);

  const handleSelectTemplate = (id: string) => {
    setSelectedTemplate(id);
    const tmpl = templates.find(t => t.id === id);
    // Pre-fill project name from template
    setProjectName(tmpl ? `my-${tmpl.id.split('-')[0]}-app` : 'my-app');
    setStep('configure');
    setError('');
  };

  const handleBrowseFolder = async () => {
    const api = window.electronAPI as any;
    if (api?.showOpenDialog) {
      const result = await api.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Choose project location',
      });
      if (result?.filePaths?.[0]) {
        setParentDir(result.filePaths[0]);
      }
    }
  };

  const handleCreate = async () => {
    if (!selectedTemplate || !projectName.trim() || !parentDir.trim()) {
      setError('Please fill in all fields');
      return;
    }

    setStep('creating');
    setError('');

    try {
      const api = window.electronAPI as any;
      if (!api?.templateCreate) {
        setError('Template API not available');
        setStep('configure');
        return;
      }

      const result = await api.templateCreate({
        templateId: selectedTemplate,
        projectName: projectName.trim(),
        parentDir: parentDir.trim(),
      });

      if (result.success) {
        setCreatedFiles(result.filesCreated || []);
        setCreatedDir(result.projectDir);
        setStep('done');
      } else {
        setError(result.error || 'Failed to create project');
        setStep('configure');
      }
    } catch (e: any) {
      setError(e.message || 'Unexpected error');
      setStep('configure');
    }
  };

  const handleOpenProject = () => {
    if (createdDir) {
      onProjectCreated(createdDir);
    }
    onClose();
  };

  const categories = Array.from(new Set(templates.map(t => t.category)))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  const filteredTemplates = filterCategory
    ? templates.filter(t => t.category === filterCategory)
    : templates;

  const selectedTmpl = templates.find(t => t.id === selectedTemplate);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[780px] max-h-[620px] bg-[#1e1e1e] border border-[#3c3c3c] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#3c3c3c] bg-[#252526]">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[#007acc]" />
            <h2 className="text-[14px] font-semibold text-white">
              {step === 'select' && 'New Project'}
              {step === 'configure' && 'Configure Project'}
              {step === 'creating' && 'Creating Project...'}
              {step === 'done' && 'Project Created!'}
            </h2>
          </div>
          <button onClick={onClose} className="text-[#858585] hover:text-white p-1 rounded hover:bg-[#3c3c3c]">
            <X size={16} />
          </button>
        </div>

        {/* Step 1: Template Selection */}
        {step === 'select' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Category tabs */}
            <div className="flex items-center border-b border-[#333] px-3">
              {([null, ...categories] as (string | null)[]).map(cat => (
                <button
                  key={cat ?? 'all'}
                  className="relative text-[11px] px-3 py-2 transition-colors"
                  style={{ color: filterCategory === cat ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)' }}
                  onMouseEnter={e => { if (filterCategory !== cat) (e.currentTarget as HTMLElement).style.color = 'var(--theme-foreground)'; }}
                  onMouseLeave={e => { if (filterCategory !== cat) (e.currentTarget as HTMLElement).style.color = 'var(--theme-foreground-muted)'; }}
                  onClick={() => setFilterCategory(cat)}
                >
                  {cat === null ? 'All' : CATEGORY_LABELS[cat] || cat}
                  {filterCategory === cat && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t" style={{ backgroundColor: 'var(--theme-accent)' }} />
                  )}
                </button>
              ))}
            </div>

            {/* Template cards */}
            <div className="flex-1 overflow-auto p-4 grid grid-cols-3 gap-3">
              {filteredTemplates.map(tmpl => (
                <button
                  key={tmpl.id}
                  className="flex items-start gap-3 p-3 bg-[#252526] border border-[#3c3c3c] rounded-lg hover:border-[#007acc] hover:bg-[#2a2d2e] transition-all text-left group"
                  onClick={() => handleSelectTemplate(tmpl.id)}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {ICON_MAP[tmpl.icon] || <Code2 size={24} className="text-[#858585]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-white group-hover:text-[#4fc1ff] transition-colors">
                      {tmpl.name}
                    </div>
                    <div className="text-[11px] text-[#858585] mt-0.5 line-clamp-2">
                      {tmpl.description}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {tmpl.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="text-[9px] bg-[#3c3c3c] text-[#9cdcfe] px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-[#555] group-hover:text-[#007acc] flex-shrink-0 mt-1" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Configure */}
        {step === 'configure' && selectedTmpl && (
          <div className="flex-1 overflow-auto p-5 space-y-4">
            {/* Selected template summary */}
            <div className="flex items-center gap-3 p-3 bg-[#252526] border border-[#3c3c3c] rounded-lg">
              {ICON_MAP[selectedTmpl.icon] || <Code2 size={24} className="text-[#858585]" />}
              <div>
                <div className="text-[13px] font-medium text-white">{selectedTmpl.name}</div>
                <div className="text-[11px] text-[#858585]">{selectedTmpl.description}</div>
              </div>
              <button
                className="ml-auto text-[11px] text-[#007acc] hover:text-[#4fc1ff] px-2 py-1 rounded hover:bg-[#3c3c3c]"
                onClick={() => { setStep('select'); setSelectedTemplate(null); }}
              >
                Change
              </button>
            </div>

            {/* Project name */}
            <div>
              <label className="block text-[12px] text-[#cccccc] mb-1.5 font-medium">Project Name</label>
              <input
                ref={nameInputRef}
                className="w-full bg-[#3c3c3c] border border-[#555] text-[#cccccc] text-[13px] rounded-md px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                placeholder="my-awesome-app"
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>

            {/* Location */}
            <div>
              <label className="block text-[12px] text-[#cccccc] mb-1.5 font-medium">Location</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-[#3c3c3c] border border-[#555] text-[#cccccc] text-[13px] rounded-md px-3 py-2 outline-none focus:border-[#007acc] transition-colors"
                  value={parentDir}
                  onChange={e => setParentDir(e.target.value)}
                  placeholder="C:\Users\you\projects"
                />
                <button
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#3c3c3c] border border-[#555] text-[#cccccc] text-[12px] rounded-md hover:bg-[#4c4c4c] transition-colors"
                  onClick={handleBrowseFolder}
                >
                  <FolderOpen size={14} />
                  Browse
                </button>
              </div>
              {parentDir && projectName && (
                <div className="text-[11px] text-[#6a6a6a] mt-1.5">
                  Project will be created at: <span className="text-[#858585]">{parentDir}{parentDir.endsWith('\\') || parentDir.endsWith('/') ? '' : '\\'}{projectName.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').toLowerCase()}</span>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-2.5 bg-[#5a1d1d] border border-[#8b3a3a] rounded-md text-[12px] text-[#f48771]">
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                className="px-4 py-2 text-[12px] text-[#cccccc] bg-[#3c3c3c] rounded-md hover:bg-[#4c4c4c] transition-colors"
                onClick={() => { setStep('select'); setSelectedTemplate(null); }}
              >
                Back
              </button>
              <button
                className="px-4 py-2 text-[12px] text-white bg-[#007acc] rounded-md hover:bg-[#006bb3] transition-colors font-medium"
                onClick={handleCreate}
                disabled={!projectName.trim() || !parentDir.trim()}
              >
                Create Project
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Creating */}
        {step === 'creating' && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center space-y-3">
              <Loader2 size={32} className="text-[#007acc] animate-spin mx-auto" />
              <p className="text-[13px] text-[#cccccc]">Scaffolding your project...</p>
              <p className="text-[11px] text-[#858585]">Creating files and directories</p>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="flex-1 overflow-auto p-5 space-y-4">
            <div className="flex items-center gap-2 text-[#4ec9b0]">
              <Check size={20} />
              <span className="text-[14px] font-medium">Project created successfully!</span>
            </div>

            <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-3">
              <div className="text-[11px] text-[#858585] mb-2">Files created:</div>
              <div className="space-y-0.5 max-h-[150px] overflow-auto">
                {createdFiles.map(f => (
                  <div key={f} className="text-[12px] text-[#cccccc] flex items-center gap-1.5">
                    <FileCode size={12} className="text-[#858585] flex-shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#1b3a4b] border border-[#007acc40] rounded-lg p-3">
              <div className="text-[12px] text-[#4fc1ff] font-medium mb-1">Next steps:</div>
              <div className="text-[11px] text-[#cccccc] space-y-1">
                <div>1. Click "Open Project" to load it in guIDE</div>
                <div>2. Open the terminal (Ctrl+`) and run <code className="bg-[#3c3c3c] px-1 rounded">npm install</code></div>
                <div>3. Start coding!</div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                className="px-4 py-2 text-[12px] text-[#cccccc] bg-[#3c3c3c] rounded-md hover:bg-[#4c4c4c] transition-colors"
                onClick={onClose}
              >
                Close
              </button>
              <button
                className="px-4 py-2 text-[12px] text-white bg-[#007acc] rounded-md hover:bg-[#006bb3] transition-colors font-medium flex items-center gap-1.5"
                onClick={handleOpenProject}
              >
                <FolderOpen size={14} />
                Open Project
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
