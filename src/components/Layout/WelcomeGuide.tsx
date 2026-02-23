import React, { useState } from 'react';
import {
  X, Keyboard, Sparkles, FolderOpen, Terminal, Globe, Search, Bug,
  Mic, Play, MessageSquare, GitBranch, Brain, Cpu, Code, Image,
  ChevronDown, ChevronRight, Compass, Settings, Paperclip, Volume2, FolderPlus,
} from 'lucide-react';

interface WelcomeGuideProps {
  onClose: () => void;
  onDontShowAgain: () => void;
  onAction?: (action: string) => void;
}

type Section = 'getting-started' | 'shortcuts' | 'ai-features' | 'editor' | 'tools' | 'tips';

const SECTIONS: { id: Section; title: string; icon: React.ElementType }[] = [
  { id: 'getting-started', title: 'Getting Started', icon: Compass },
  { id: 'shortcuts', title: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'ai-features', title: 'AI & Chat', icon: Sparkles },
  { id: 'editor', title: 'Editor & Code', icon: Code },
  { id: 'tools', title: 'Built-in Tools', icon: Settings },
  { id: 'tips', title: 'Tips & Tricks', icon: Brain },
];

export const WelcomeGuide: React.FC<WelcomeGuideProps> = ({ onClose, onDontShowAgain, onAction }) => {
  const [activeSection, setActiveSection] = useState<Section>('getting-started');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['all']));

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const Shortcut: React.FC<{ keys: string; desc: string }> = ({ keys, desc }) => (
    <div className="flex items-center justify-between py-1.5 px-2 hover:bg-[#ffffff08] rounded">
      <span className="text-[12px] text-[#cccccc]">{desc}</span>
      <kbd className="text-[11px] bg-[#3c3c3c] text-[#dcdcaa] px-1.5 py-0.5 rounded border border-[#555] font-mono ml-3 flex-shrink-0">{keys}</kbd>
    </div>
  );

  const FeatureCard: React.FC<{ icon: React.ElementType; title: string; desc: string }> = ({ icon: Icon, title, desc }) => (
    <div className="bg-[#2a2a2a] border border-[#3c3c3c] rounded-lg p-3 hover:border-[#007acc40] transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} className="text-[#007acc]" />
        <span className="text-[12px] font-semibold text-[#cccccc]">{title}</span>
      </div>
      <p className="text-[11px] text-[#858585] leading-relaxed">{desc}</p>
    </div>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'getting-started':
        return (
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-[#007acc20] to-[#00000000] border-l-2 border-[#007acc] p-3 rounded-r-lg">
              <h3 className="text-[13px] font-bold text-[#4fc1ff] mb-1">Welcome to <span className="brand-font">guIDE</span></h3>
              <p className="text-[12px] text-[#cccccc] leading-relaxed">
                Your AI-powered IDE with local & cloud LLMs, 53 MCP tools, browser automation,
                RAG-powered code intelligence, and much more — all running on your machine.
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="text-[12px] font-semibold text-[#dcdcaa] flex items-center gap-1">
                <span>Quick Start Steps</span>
              </h4>
              <div className="space-y-1.5">
                {[
                  { step: '1', text: 'Open a folder — File → Open Folder or drag a folder onto the window', icon: FolderOpen },
                  { step: '2', text: 'Start chatting — The AI chat panel is on the right. Ask anything about your code', icon: MessageSquare },
                  { step: '3', text: 'Use the Command Palette — Ctrl+Shift+P for quick access to all commands', icon: Search },
                  { step: '4', text: 'Run code — Click the Run button or press F5 to run the current file (25+ languages)', icon: Play },
                  { step: '5', text: 'Browse the web — Click the Globe icon in the sidebar to open the browser', icon: Globe },
                  { step: '6', text: 'New project — Create a project from template with one click', icon: FolderPlus, action: 'new-project' },
                ].map(item => (
                  <div key={item.step} className={`flex items-start gap-2 py-1.5 px-2 bg-[#2a2a2a] rounded ${(item as any).action ? 'cursor-pointer hover:bg-[#333333]' : ''}`}
                    onClick={() => { if ((item as any).action && onAction) { onAction((item as any).action); onClose(); } }}>
                    <div className="w-5 h-5 bg-[#007acc] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-white">{item.step}</span>
                    </div>
                    <span className="text-[12px] text-[#cccccc]">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <FeatureCard icon={Cpu} title="Local AI" desc="Runs LLMs on your GPU — no internet needed for code AI" />
              <FeatureCard icon={Globe} title="Cloud APIs" desc="16 providers supported: Groq and Cerebras pre-configured with free keys" />
              <FeatureCard icon={Brain} title="RAG Context" desc="Auto-indexes your project for intelligent code-aware answers" />
              <FeatureCard icon={Bug} title="Bug Finder" desc="Paste errors and stack traces for AI-powered debugging" />
            </div>
          </div>
        );

      case 'shortcuts':
        return (
          <div className="space-y-3">
            {[
              { title: 'General', items: [
                { keys: 'Ctrl+Shift+P', desc: 'Command Palette' },
                { keys: 'Ctrl+B', desc: 'Toggle Sidebar' },
                { keys: 'Ctrl+J', desc: 'Toggle Terminal' },
                { keys: 'Ctrl+`', desc: 'Toggle Terminal (alt)' },
              ]},
              { title: 'File Operations', items: [
                { keys: 'Ctrl+S', desc: 'Save File' },
                { keys: 'Ctrl+Shift+S', desc: 'Save All Files' },
                { keys: 'Ctrl+N', desc: 'New File' },
              ]},
              { title: 'Editor', items: [
                { keys: 'F5', desc: 'Run Current File' },
                { keys: 'Ctrl+F', desc: 'Find in File' },
                { keys: 'Ctrl+H', desc: 'Find & Replace' },
                { keys: 'Ctrl+G', desc: 'Go to Line' },
                { keys: 'Ctrl+D', desc: 'Select Next Occurrence' },
                { keys: 'Alt+↑/↓', desc: 'Move Line Up/Down' },
                { keys: 'Ctrl+/', desc: 'Toggle Comment' },
                { keys: 'Ctrl+Shift+K', desc: 'Delete Line' },
              ]},
              { title: 'Navigation', items: [
                { keys: 'Ctrl+Shift+E', desc: 'File Explorer' },
                { keys: 'Ctrl+Shift+F', desc: 'Search in Files' },
                { keys: 'Ctrl+Shift+G', desc: 'Source Control (Git)' },
                { keys: 'Ctrl+P', desc: 'Quick Open File' },
              ]},
              { title: 'AI & Chat', items: [
                { keys: 'Enter', desc: 'Send Message (in chat)' },
                { keys: 'Shift+Enter', desc: 'New Line (in chat)' },
              ]},
            ].map(group => (
              <div key={group.title}>
                <button
                  className="flex items-center gap-1 text-[11px] font-semibold text-[#dcdcaa] uppercase tracking-wider mb-1 hover:text-[#fff] w-full"
                  onClick={() => toggleSection(group.title)}
                >
                  {expandedSections.has(group.title) || expandedSections.has('all')
                    ? <ChevronDown size={12} />
                    : <ChevronRight size={12} />}
                  {group.title}
                </button>
                {(expandedSections.has(group.title) || expandedSections.has('all')) && (
                  <div className="bg-[#2a2a2a] rounded border border-[#3c3c3c]">
                    {group.items.map(item => (
                      <Shortcut key={item.keys} keys={item.keys} desc={item.desc} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        );

      case 'ai-features':
        return (
          <div className="space-y-3">
            <FeatureCard icon={MessageSquare} title="AI Chat Panel" desc="Chat with local or cloud AI. Select text in the editor, right-click, and choose 'Ask AI' to get contextual help." />
            <FeatureCard icon={Sparkles} title="Agentic Mode" desc="Enable the Agentic toggle for multi-step autonomous coding. The AI can read, write, search files, run commands, browse the web, and more." />
            <FeatureCard icon={Brain} title="RAG-Powered Context" desc="When you open a folder, guIDE auto-indexes your codebase. The AI uses this context to give better, project-aware answers." />
            <FeatureCard icon={Mic} title="Voice Input" desc="Click the mic button in chat to speak your prompt. Uses Whisper for reliable speech-to-text transcription." />
            <FeatureCard icon={Volume2} title="Text-to-Speech" desc="Toggle the speaker icon to have the AI read responses aloud using your system's speech synthesis." />
            <FeatureCard icon={Image} title="Image Input" desc="Attach images via the clip button, drag-and-drop, or paste from clipboard. Vision models can analyze screenshots and diagrams." />
            <FeatureCard icon={Globe} title="16 Cloud Providers" desc="Pre-configured: Groq (ultra-fast, 1000 RPM) and Cerebras (7-key rotation). Add your own keys for Google Gemini, OpenAI, Anthropic, and more." />
            <FeatureCard icon={Cpu} title="Local LLM" desc="Run models locally with GPU acceleration (CUDA/Vulkan). Drop .gguf files into the models folder." />
          </div>
        );

      case 'editor':
        return (
          <div className="space-y-3">
            <FeatureCard icon={Code} title="Monaco Editor" desc="Full VS Code editor experience with syntax highlighting, IntelliSense, multi-cursor, minimap, bracket matching, and more." />
            <FeatureCard icon={Play} title="Code Runner" desc="Run code in 25+ languages with one click. Supports Python, JavaScript, TypeScript, C/C++, Rust, Go, Java, Ruby, and more." />
            <FeatureCard icon={Search} title="Find & Replace" desc="Ctrl+F for in-file search, Ctrl+Shift+F for project-wide search across all files." />
            <FeatureCard icon={GitBranch} title="Git Integration" desc="Built-in source control: stage, commit, diff, branch management — all from the sidebar." />
            <FeatureCard icon={Terminal} title="Integrated Terminal" desc="Multiple terminal tabs with PowerShell/CMD support. Toggle with Ctrl+J or Ctrl+`." />

            <div className="bg-[#2a2a2a] border border-[#3c3c3c] rounded-lg p-3">
              <h4 className="text-[12px] font-semibold text-[#cccccc] mb-2">Supported Languages for Code Runner</h4>
              <div className="flex flex-wrap gap-1">
                {['Python', 'JavaScript', 'TypeScript', 'C', 'C++', 'Rust', 'Go', 'Java', 'Ruby', 'PHP', 'Perl', 'Lua', 'R', 'Swift', 'Kotlin', 'Dart', 'Julia', 'Scala', 'C#', 'Elixir', 'Shell', 'Batch', 'PowerShell'].map(lang => (
                  <span key={lang} className="text-[10px] bg-[#3c3c3c] text-[#dcdcaa] px-1.5 py-0.5 rounded">{lang}</span>
                ))}
              </div>
            </div>
          </div>
        );

      case 'tools':
        return (
          <div className="space-y-3">
            <div className="bg-gradient-to-r from-[#007acc20] to-[#00000000] border-l-2 border-[#007acc] p-3 rounded-r-lg">
              <p className="text-[12px] text-[#cccccc]">guIDE includes <strong className="text-[#4fc1ff]">53 MCP tools</strong> that the AI agent can use autonomously when Agentic mode is enabled.</p>
            </div>

            {[
              { title: 'File Operations', tools: 'read_file, write_file, edit_file, delete_file, rename_file, copy_file, append_to_file, list_directory, find_files, get_file_info, search_codebase, get_project_structure, diff_files, grep_search, search_in_file, replace_in_files, open_file_in_editor' },
              { title: 'Code Intelligence', tools: 'analyze_error, undo_edit, list_undoable, create_directory' },
              { title: 'Terminal & Execution', tools: 'run_command, install_packages, check_port, http_request' },
              { title: 'Browser Automation', tools: 'browser_navigate, browser_snapshot, browser_click, browser_type, browser_screenshot, browser_get_content, browser_evaluate, browser_list_elements, browser_wait_for_element, browser_scroll, browser_wait, browser_back, browser_select, browser_hover, browser_get_url, browser_get_links' },
              { title: 'Web & Research', tools: 'web_search, fetch_webpage' },
              { title: 'Git', tools: 'git_status, git_commit, git_diff, git_log, git_branch, git_stash, git_reset' },
              { title: 'Memory', tools: 'save_memory, get_memory, list_memories' },
            ].map(group => (
              <div key={group.title} className="bg-[#2a2a2a] border border-[#3c3c3c] rounded-lg p-3">
                <h4 className="text-[12px] font-semibold text-[#dcdcaa] mb-1">{group.title}</h4>
                <p className="text-[10px] text-[#858585] font-mono leading-relaxed">{group.tools}</p>
              </div>
            ))}
          </div>
        );

      case 'tips':
        return (
          <div className="space-y-3">
            {[
              { icon: Sparkles, title: 'Select & Ask', tip: 'Select code in the editor, then ask the AI to explain, refactor, or fix it. The selected text is automatically included as context.' },
              { icon: Paperclip, title: 'Attach Screenshots', tip: 'Paste screenshots directly into chat (Ctrl+V) for the AI to analyze. Great for debugging UI issues.' },
              { icon: Globe, title: 'Built-in Browser', tip: 'The browser panel syncs with the AI agent. When the agent browses in agentic mode, the browser panel opens automatically.' },
              { icon: Terminal, title: 'Code Runner', tip: 'Press F5 or click Run to run the current file. guIDE auto-detects the language and uses the right command.' },
              { icon: Brain, title: 'Memory System', tip: 'The AI remembers facts from your conversations. It learns your preferences, project structure, and common patterns.' },
              { icon: Search, title: 'Command Palette', tip: 'Ctrl+Shift+P opens the command palette. Type to quickly find and execute any command or open any file.' },
              { icon: Settings, title: 'Model Parameters', tip: 'Click the gear icon in chat to adjust temperature, top-p, and other generation parameters for fine-tuned responses.' },
              { icon: Cpu, title: 'Status Bar', tip: 'The bottom status bar shows CPU/RAM usage, token speed, context usage, cursor position, and AI model status.' },
            ].map(item => (
              <div key={item.title} className="flex gap-3 bg-[#2a2a2a] border border-[#3c3c3c] rounded-lg p-3">
                <item.icon size={16} className="text-[#007acc] flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-[12px] font-semibold text-[#cccccc] mb-0.5">{item.title}</h4>
                  <p className="text-[11px] text-[#858585] leading-relaxed">{item.tip}</p>
                </div>
              </div>
            ))}
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg shadow-2xl w-[720px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#3c3c3c] bg-[#252526] flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[#007acc] font-bold text-[18px]">⟨/⟩</span>
            <div>
              <h2 className="text-[14px] font-bold text-[#cccccc]">Welcome to <span className="brand-font">guIDE</span></h2>
              <p className="text-[10px] text-[#858585]">AI-Powered IDE by Brendan Gray</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#858585] hover:text-white p-1 rounded hover:bg-[#ffffff10]">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-[180px] bg-[#252526] border-r border-[#3c3c3c] py-2 flex-shrink-0">
            {SECTIONS.map(section => (
              <button
                key={section.id}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left transition-colors ${
                  activeSection === section.id
                    ? 'text-white bg-[#37373d] border-l-2 border-[#007acc]'
                    : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e] border-l-2 border-transparent'
                }`}
                onClick={() => setActiveSection(section.id)}
              >
                <section.icon size={14} />
                {section.title}
              </button>
            ))}
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-4">
            {renderContent()}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#3c3c3c] bg-[#252526] flex-shrink-0">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-[#007acc]"
              onChange={(e) => { if (e.target.checked) onDontShowAgain(); }}
            />
            <span className="text-[11px] text-[#858585]">Don't show on startup</span>
          </label>
          <button
            onClick={onClose}
            className="bg-[#007acc] text-white text-[12px] px-4 py-1.5 rounded hover:bg-[#006bb3] transition-colors"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
};
