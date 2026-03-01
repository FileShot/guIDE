import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { splitInlineToolCalls, parseToolCall, extractToolResults, stripTrailingPartialToolCall } from '@/utils/chatContentParser';
import {
  X, Cpu, Globe, Code, Bug, FileCode, Terminal, Plus,
  ChevronDown, Trash2, Key, Loader2,
  Sparkles, Brain, Mic, MicOff, Volume2, VolumeX, Cloud,
  Paperclip, ArrowUp, Square, Shield, Zap, Clock, Check,
  Image as ImageIcon, Download, XCircle, PlayCircle, AlertTriangle, Eye,
} from 'lucide-react';
import type { LLMStatusEvent, AvailableModel, AIChatContext, MCPToolResult } from '@/types/electron';
import { ModelPicker } from './ModelPicker';
import { AudioWaveAnimation, ThinkingBlock, CollapsibleToolBlock, ToolCallGroup, CodeBlock, MermaidDiagram, ApiKeyInput, InlineMarkdownText } from './ChatWidgets';
import { useChatSettings } from './hooks/useChatSettings';
import { useChatStreaming } from './hooks/useChatStreaming';
import { useVoiceInput } from './hooks/useVoiceInput';
import { useTTS } from './hooks/useTTS';
import { useChatSessions } from './hooks/useChatSessions';
import { TodoPanel, TodoItem } from './TodoPanel';
import { toast } from '@/components/Layout/Toast';

interface ChatPanelProps {
  rootPath: string;
  currentFile: string;
  selectedText: string;
  llmStatus: LLMStatusEvent;
  availableModels: AvailableModel[];
  onApplyCode: (filePath: string, code: string) => void;
  onOpenFile?: (filePath: string) => void;
  onClearCurrentFile?: () => void;
  onClose: () => void;
}

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
  isError?: boolean;
  isQuotaMessage?: boolean;
  checkpointId?: string;
  toolsUsed?: MCPToolResult[];
}

interface AttachedImage {
  name: string;
  data: string; // base64 data URL
  mimeType: string;
}

type CheckpointData = { turnId: string; timestamp: number; userMessage: string; files: { filePath: string; fileName: string; isNew: boolean }[] };

const CheckpointDivider: React.FC<{
  checkpoint: CheckpointData;
  isRestoring: boolean;
  onRestore: () => void;
}> = ({ checkpoint, isRestoring, onRestore }) => {
  const time = new Date(checkpoint.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const n = checkpoint.files.length;
  return (
    <div className="relative flex items-center gap-2 px-3 py-1 my-0.5 select-none">
      <div className="flex-1 border-t border-dashed border-[#3c3c3c]" />
      <div className="flex items-center gap-1.5 text-[10px] text-[#858585] whitespace-nowrap">
        <span className="text-[#569cd6]">{n} file{n !== 1 ? 's' : ''} changed</span>
        <span>·</span>
        <span>{time}</span>
      </div>
      <button
        className="text-[10px] px-1.5 py-0.5 rounded border border-[#3c3c3c] text-[#858585] hover:text-[#cccccc] hover:border-[#569cd6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onRestore}
        disabled={isRestoring}
        title={`Restore ${n} file${n !== 1 ? 's' : ''} to state before this turn`}
      >
        {isRestoring ? '…' : 'Restore'}
      </button>
      <div className="flex-1 border-t border-dashed border-[#3c3c3c]" />
    </div>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  rootPath, currentFile, selectedText, llmStatus, availableModels, onApplyCode, onOpenFile, onClearCurrentFile, onClose,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [executingTools, setExecutingTools] = useState<Array<{tool: string; params: any}>>([]);
  const [completedStreamingTools, setCompletedStreamingTools] = useState<Array<{tool: string; params: any}>>([]);
  // Ref so IPC callbacks (closed over at mount) can always read the latest executing list
  const executingToolsRef = useRef<Array<{tool: string; params: any}>>([]);
  const [agenticProgress, setAgenticProgress] = useState<{ iteration: number; maxIterations: number } | null>(null);
  const [agenticPhases, setAgenticPhases] = useState<Array<{ phase: string; label: string; status: 'running' | 'done' }>>([]);
  const [_showThinking, _setShowThinking] = useState(false);
  const [cloudProviders, setCloudProviders] = useState<{ provider: string; label: string; models: { id: string; name: string }[] }[]>([]);
  const [allCloudProviders, setAllCloudProviders] = useState<{ provider: string; label: string; models: { id: string; name: string }[]; hasKey: boolean }[]>([]);
  // Model favorites — persisted in localStorage for quick switching
  const [favoriteModels, setFavoriteModels] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('guide-favorite-models');
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [pendingFileChanges, setPendingFileChanges] = useState<{ filePath: string; fileName: string; timestamp: number; tool: string; isNew: boolean; linesAdded?: number; linesRemoved?: number }[]>([]);
  const [checkpoints, setCheckpoints] = useState<Map<string, CheckpointData>>(new Map());
  const [restoringCheckpoint, setRestoringCheckpoint] = useState<string | null>(null);
  const [fileChangesExpanded, setFileChangesExpanded] = useState(true);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; path: string; content: string }[]>([]);
  const [contextUsage, setContextUsage] = useState<{ used: number; total: number; model: string } | null>(null);
  const [showDevConsole, setShowDevConsole] = useState(false);
  const [devLogs, setDevLogs] = useState<Array<{ level: string; text: string; timestamp: number }>>([]);
  const devLogsRef = useRef<Array<{ level: string; text: string; timestamp: number }>>([]);
  const showDevConsoleRef = useRef(false);
  const devLogEndRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImproving, setIsImproving] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseStatus, setLicenseStatus] = useState<{ isActivated: boolean; license?: any } | null>(null);
  const [licenseMessage, setLicenseMessage] = useState('');
  const [licenseTab, setLicenseTab] = useState<'signin' | 'key'>('signin');
  const [licenseEmail, setLicenseEmail] = useState('');
  const [licensePassword, setLicensePassword] = useState('');
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [activeImageModel, setActiveImageModel] = useState<AvailableModel | null>(null);
  const [imageGenProgress, setImageGenProgress] = useState<{ current: number; total: number } | null>(null);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [editingQueueText, setEditingQueueText] = useState('');
  const messageQueueRef = useRef<string[]>([]);
  const generationStartRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const [generationStuck, setGenerationStuck] = useState(false);

  // ── Extracted hooks ──
  const settings = useChatSettings();
  const { temperature, maxTokens, contextSize, topP, topK, repeatPenalty, seed,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    reasoningEffort: _reasoningEffort, thinkingBudget: _thinkingBudget, maxIterations, gpuPreference: _gpuPreference, useWebSearch, useRAG: _useRAG,
    ttsEnabled, autoMode, planMode, cloudProvider, cloudModel,
    setUseWebSearch: _setUseWebSearch, setUseRAG: _setUseRAG, setTtsEnabled, setAutoMode, setPlanMode,
    setCloudProvider, setCloudModel,
  } = settings;

  const streaming = useChatStreaming();
  const { streamingText, thinkingSegments, setStreamingText, setThinkingSegments,
    streamBufferRef, thinkingSegmentsRef, wasRespondingRef, streamEpochRef, activeEpochRef } = streaming;

  const addSystemMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, {
      id: `msg-err-${Date.now()}`,
      role: 'system',
      content,
      timestamp: Date.now(),
    }]);
  }, []);

  const { isListening, isTranscribing, toggleListening, stopListening } = useVoiceInput({ setInput, addSystemMessage });
  const { isSpeaking, speakText, stopSpeaking } = useTTS(ttsEnabled);
  const { savedSessions, refreshSavedSessions, saveCurrentSession, deleteSession } = useChatSessions(messages);

  // Toggle a model as favorite and persist to localStorage
  const toggleFavorite = useCallback((modelKey: string) => {
    setFavoriteModels(prev => {
      const next = new Set(prev);
      if (next.has(modelKey)) next.delete(modelKey); else next.add(modelKey);
      localStorage.setItem('guide-favorite-models', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Select an image model — sets it as the active image generator for this session
  const handleSwitchImageModel = useCallback((model: AvailableModel) => {
    setActiveImageModel(model);
    setMessages(prev => [...prev, {
      id: `msg-imgmodel-${Date.now()}`,
      role: 'system',
      content: `Image model ready: **${model.name}** — type a description to generate an image locally.`,
      timestamp: Date.now(),
    }]);
  }, []);

  // Close all dropdowns/panels when clicking outside their trigger area
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking inside the chat panel's dropdown areas
      // Only close if clicking in the main content area (messages/input)
      if (!target.closest('.chat-dropdown-panel') && !target.closest('.chat-header-buttons')) {
        setShowSettings(false);
        setShowModelPicker(false);
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll — only if user is near the bottom (not manually scrolled up)
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const isGeneratingRef = useRef(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  // Track whether user intentionally scrolled up via wheel/touch (not height changes)
  const manualScrollUpRef = useRef(false);

  // Keep isGeneratingRef in sync
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);

  useEffect(() => {
    // Only scroll on message-count or generation-state changes.
    // During streaming, Virtuoso's followOutput handles auto-follow via
    // content-height change detection — no need to scrollToIndex every token.
    if (isGenerating && !manualScrollUpRef.current) {
      if (messages.length > 0 && virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({ index: messages.length, behavior: 'auto', align: 'end' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    } else if (!isGenerating && !userScrolledUpRef.current) {
      // Not generating — normal scroll-to-bottom for new messages
      if (messages.length > 0 && virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({ index: messages.length - 1, behavior: 'smooth', align: 'end' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
      // Reset manual scroll tracking when generation ends
      manualScrollUpRef.current = false;
    }
  }, [messages, isGenerating]);

  // ── Stuck generation detection: show warning if no activity for 2 minutes ──
  useEffect(() => {
    if (streamingText || thinkingSegments.length > 0 || agenticProgress) {
      lastActivityRef.current = Date.now();
      setGenerationStuck(false);
    }
  }, [streamingText, thinkingSegments, agenticProgress]);

  useEffect(() => {
    if (!isGenerating) {
      setGenerationStuck(false);
      return;
    }
    const STUCK_THRESHOLD = 2 * 60 * 1000; // 2 minutes
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > STUCK_THRESHOLD) {
        setGenerationStuck(true);
      }
    }, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [isGenerating]);

  // ── Context Window Usage Indicator — update after each message or on model change ──
  const updateContextUsage = useCallback(async () => {
    try {
      const api = window.electronAPI;
      if (!api?.getContextUsage) return;
      const usage = await api.getContextUsage();
      if (usage) {
        // Estimate tokens used from conversation history
        const allText = messages.map(m => m.content).join('\n');
        const tokenResult = await api.estimateTokens?.(allText);
        const estimatedUsed = (tokenResult && typeof tokenResult === 'object' ? tokenResult.tokens : tokenResult) || Math.ceil(allText.length / 4);
        setContextUsage({
          used: estimatedUsed,
          total: usage.contextSize || contextSize || 4096,
          model: usage.modelName || '',
        });
      }
    } catch { /* ignore — model may not be loaded */ }
  }, [messages, contextSize]);

  useEffect(() => {
    updateContextUsage();
  }, [messages.length, llmStatus.state, updateContextUsage]);

  // Fetch cloud providers when API keys panel closes or on mount
  const refreshCloudProviders = useCallback(async () => {
    try {
      const providers = await window.electronAPI?.cloudLLMGetProviders?.();
      if (providers && Array.isArray(providers)) {
        setCloudProviders(providers);
      }
    } catch { /* ignore */ }
  }, []);

  // Fetch ALL cloud providers (configured + unconfigured) for model picker
  const refreshAllProviders = useCallback(async () => {
    try {
      const all = await window.electronAPI?.cloudLLMGetAllProviders?.();
      if (all && Array.isArray(all)) {
        setAllCloudProviders(all);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshCloudProviders();
    refreshAllProviders();
  }, [refreshCloudProviders, refreshAllProviders]);

  // Refresh cloud providers when settings panel closes
  useEffect(() => {
    if (!showSettings) { refreshCloudProviders(); refreshAllProviders(); }
  }, [showSettings, refreshCloudProviders, refreshAllProviders]);

  // Load license status on mount
  useEffect(() => {
    (async () => {
      try {
        const status = await window.electronAPI?.licenseGetStatus?.();
        if (status) setLicenseStatus(status);
      } catch {}
    })();
  }, []);

  // Fetch OpenRouter live model catalog when OpenRouter provider is configured
  // Check if using cloud model
  const isUsingCloud = !!cloudProvider && !!cloudModel;

  // Refresh pending file changes (for undo bar)
  const refreshPendingChanges = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.fileUndoList) return;
    try {
      const files = await api.fileUndoList();
      setPendingFileChanges(files || []);
    } catch { setPendingFileChanges([]); }
  }, []);

  // Listen for live tool execution events
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    let executingTimeout: ReturnType<typeof setTimeout> | null = null;

    const cleanupExecuting = api.onToolExecuting?.((data: { tool: string; params: any }) => {
      const updated = [...executingToolsRef.current, { tool: data.tool, params: data.params }];
      executingToolsRef.current = updated;
      setExecutingTools(updated);
      // Safety timeout: clear executing status after 60s in case mcp-tool-results is missed
      if (executingTimeout) clearTimeout(executingTimeout);
      executingTimeout = setTimeout(() => {
        executingToolsRef.current = [];
        setExecutingTools([]);
      }, 60000);
    });

    const cleanupResults = api.onMcpToolResults?.(() => {
      if (executingTimeout) clearTimeout(executingTimeout);
      // BUG-NEW-A: Move currently-executing tools to completed so their pills stay visible
      // as ✓ checkmarks instead of vanishing the instant the tool finishes.
      const finished = executingToolsRef.current;
      if (finished.length > 0) {
        setCompletedStreamingTools(prev => [...prev, ...finished]);
      }
      executingToolsRef.current = [];
      setExecutingTools([]);
      // Refresh pending file changes after tools execute
      refreshPendingChanges();
    });

    const cleanupProgress = api.onAgenticProgress?.((data: { iteration: number; maxIterations: number }) => {
      setAgenticProgress(data);
    });

    const cleanupPhase = api.onAgenticPhase?.((data: { phase: string; status?: 'start' | 'done' | 'clear'; label?: string }) => {
      if (data.phase === 'clear' || data.status === 'clear') {
        setAgenticPhases([]);
        return;
      }
      if (data.status === 'start' && data.label) {
        setAgenticPhases(prev => {
          // Replace any existing entry for this phase (running OR done) rather than stacking.
          // A phase can fire start → done → start again (e.g. context compacted twice).
          // Filtering first ensures we never accumulate duplicate rows.
          const filtered = prev.filter(p => p.phase !== data.phase);
          return [...filtered, { phase: data.phase, label: data.label!, status: 'running' }];
        });
      } else if (data.status === 'done') {
        setAgenticPhases(prev => prev.map(p =>
          p.phase === data.phase ? { ...p, status: 'done' } : p
        ));
      }
    });

    const cleanupTodo = api.onTodoUpdate?.((data: any[]) => {
      setTodos(Array.isArray(data) ? data as TodoItem[] : []);
    });

    // Listen for background agent completions
    const cleanupAgentStatus = api.onAgentStatus?.((data: { id: number; status: string; task: string; result?: string; error?: string }) => {
      if (data.status === 'completed' || data.status === 'error' || data.status === 'cancelled') {
        const agentPrefix = data.status === 'completed' ? '[done]' : data.status === 'error' ? '[error]' : '[stopped]';
        setMessages(prev => [...prev, {
          id: `msg-agent-done-${Date.now()}`,
          role: 'assistant',
          content: `${agentPrefix} **Background Agent #${data.id} ${data.status}**\nTask: ${data.task}\n\n${
            data.status === 'completed' ? data.result || 'Completed successfully.' :
            data.status === 'error' ? `Error: ${data.error}` : 'Cancelled.'
          }`,
          timestamp: Date.now(),
        }]);
      }
    });

    const cleanupCheckpoint = api.onCheckpointReady?.((data: CheckpointData) => {
      setCheckpoints(prev => new Map(prev).set(data.turnId, data));
      setMessages(prev => {
        const lastIdx = prev.map((m, i) => (m.role === 'assistant' ? i : -1)).filter(i => i >= 0).pop();
        if (lastIdx === undefined) return prev;
        const updated = [...prev];
        updated[lastIdx] = { ...updated[lastIdx], checkpointId: data.turnId };
        return updated;
      });
    });

    return () => {
      if (executingTimeout) clearTimeout(executingTimeout);
      cleanupExecuting?.();
      cleanupResults?.();
      cleanupProgress?.();
      cleanupPhase?.();
      cleanupTodo?.();
      cleanupAgentStatus?.();
      cleanupCheckpoint?.();
    };
  }, []);

  // ── Developer Console: capture verbose backend logs ──
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onDevLog) return;

    const cleanupDevLog = api.onDevLog((entry: { level: string; text: string; timestamp: number }) => {
      // Store in ref to avoid re-renders when dev console is hidden
      const logs = devLogsRef.current;
      logs.push(entry);
      if (logs.length > 500) logs.splice(0, logs.length - 500);
      // Only trigger React re-render when dev console is visible
      if (showDevConsoleRef.current) {
        setDevLogs([...logs]);
      }
    });

    return () => { cleanupDevLog?.(); };
  }, []);

  // Auto-scroll dev console to bottom
  useEffect(() => {
    if (showDevConsole && devLogEndRef.current) {
      devLogEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [devLogs.length, showDevConsole]);

  // Auto-clear agentic phase indicators 1.5s after generation ends
  // This shows the final checkmarks briefly before clearing cleanly
  useEffect(() => {
    if (!isGenerating && agenticPhases.length > 0) {
      const timer = setTimeout(() => setAgenticPhases([]), 1500);
      return () => clearTimeout(timer);
    }
  }, [isGenerating]);

  const loadSession = useCallback((session: { messages: ChatMessage[] }) => {
    setMessages(session.messages);
    setShowHistory(false);
  }, []);

  // ── Image Attachment Handling ──
  const handleImageFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    for (const file of imageFiles) {
      if (file.size > 20 * 1024 * 1024) { // 20MB max
        console.warn(`Image ${file.name} too large (${(file.size / 1024 / 1024).toFixed(1)}MB), max 20MB`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setAttachedImages(prev => [...prev, {
          name: file.name,
          data: dataUrl,
          mimeType: file.type,
        }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const removeAttachedImage = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      const codeFiles = files.filter(f => !f.type.startsWith('image/'));

      if (imageFiles.length > 0) {
        handleImageFiles(imageFiles);
      }

      // Read non-image files as context attachments
      for (const file of codeFiles) {
        const reader = new FileReader();
        reader.onload = () => {
          const content = reader.result as string;
          setAttachedFiles(prev => {
            if (prev.some(f => f.name === file.name)) return prev;
            return [...prev, { name: file.name, path: (file as any).path || file.name, content: content.substring(0, 50000) }];
          });
        };
        reader.readAsText(file);
      }
    }

    // Handle text/path drag from file explorer
    const dragText = e.dataTransfer.getData('text/plain');
    if (dragText && !e.dataTransfer.files.length) {
      // Could be a file path dragged from the file explorer
      const api = window.electronAPI;
      if (api?.readFile && dragText.includes('/') || dragText.includes('\\')) {
        (async () => {
          try {
            const result = await api.readFile(dragText);
            if (result?.success && result.content) {
              const name = dragText.split(/[/\\]/).pop() || dragText;
              setAttachedFiles(prev => {
                if (prev.some(f => f.path === dragText)) return prev;
                return [...prev, { name, path: dragText, content: (result.content || '').substring(0, 50000) }];
              });
            }
          } catch {}
        })();
      }
    }
  }, [handleImageFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // "Improve with AI" — polish the user's prompt before sending
  const improvePrompt = useCallback(async () => {
    const text = input.trim();
    if (!text || isImproving || isGenerating) return;
    setIsImproving(true);
    try {
      const api = window.electronAPI;
      if (!api) throw new Error('No API');

      const improveInstruction = `Rewrite the following user prompt to be clearer, more specific, and well-structured for an AI coding assistant. Keep the same intent but make it easier to understand. Return ONLY the improved prompt text, nothing else — no explanation, no quotes, no markdown formatting around it.\n\nOriginal prompt:\n${text}`;

      const context: AIChatContext = {
        params: { temperature: 0.5, maxTokens: 1024, topP: 0.9, topK: 20, repeatPenalty: 1.1, seed: -1 },
        maxIterations: 1,
      };
      if (isUsingCloud && cloudProvider && cloudModel) {
        context.cloudProvider = cloudProvider;
        context.cloudModel = cloudModel;
      }

      const result = await api.aiChat(improveInstruction, context);
      if (result?.text) {
        // Clean up the result — remove surrounding quotes or backticks
        let improved = result.text.trim();
        if ((improved.startsWith('"') && improved.endsWith('"')) || (improved.startsWith("'") && improved.endsWith("'"))) {
          improved = improved.slice(1, -1);
        }
        setInput(improved);
        // Auto-resize textarea
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
          }
        }, 50);
      }
    } catch (err) {
      console.error('[Improve] Failed:', err);
    } finally {
      setIsImproving(false);
    }
  }, [input, isImproving, isGenerating, isUsingCloud, cloudProvider, cloudModel]);

  // Process next queued message after generation completes
  const processQueueRef = useRef<() => void>(() => {});

  const sendMessageDirect = async (text: string, images?: typeof attachedImages) => {
    const currentImages = images || [];

    // ── Local image generation path ──────────────────────────────────────────
    // When an image model is active, route directly to local image generation
    // instead of the LLM pipeline. No context or streaming needed.
    if (activeImageModel) {
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content: text || '(image prompt)',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, userMsg]);
      isGeneratingRef.current = true;
      setIsGenerating(true);
      setImageGenProgress(null);

      // Subscribe to per-step progress
      const cleanupProgress = (window.electronAPI as any)?.onLocalImageProgress?.((data: { current: number; total: number }) => {
        setImageGenProgress(data);
      });

      try {
        const api = window.electronAPI as any;
        const result = await api.localImageGenerate({
          prompt: text,
          modelPath: activeImageModel.path,
        });

        if (result?.success && result.imageBase64) {
          const imageData = JSON.stringify({
            type: 'generated-image',
            imageBase64: result.imageBase64,
            mimeType: result.mimeType || 'image/png',
            prompt: result.prompt || text,
            provider: 'local',
            model: activeImageModel.name,
          });
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}-img`,
            role: 'assistant',
            content: `<!--GENERATED_IMAGE:${imageData}-->`,
            timestamp: Date.now(),
            model: activeImageModel.name,
          }]);
          toast('Image generated', 'success');
        } else {
          setMessages(prev => [...prev, {
            id: `msg-err-${Date.now()}`,
            role: 'system',
            isError: true,
            content: `Image generation failed\n\n${result?.error || 'Unknown error'}`,
            timestamp: Date.now(),
          }]);
          toast(`Image generation failed — ${result?.error || 'Unknown error'}`.slice(0, 80), 'error');
        }
      } catch (e: any) {
        setMessages(prev => [...prev, {
          id: `msg-err-${Date.now()}`,
          role: 'system',
          isError: true,
          content: `Image generation error\n\n${e.message}`,
          timestamp: Date.now(),
        }]);
        toast(`Image generation error — ${e.message}`.slice(0, 80), 'error');
      } finally {
        cleanupProgress?.();
        setImageGenProgress(null);
        isGeneratingRef.current = false;
        setIsGenerating(false);
      }
      return;
    }
    // ── End local image generation path ──────────────────────────────────────

    // Plan Mode: prepend structured planning instruction
    const effectiveText = planMode
      ? `[PLAN MODE] Before making any changes, first create a detailed step-by-step plan. List each file to modify, what changes to make, and in what order. Present the plan as a numbered list with clear descriptions. Do NOT execute any changes yet — only output the plan. After I approve, I will ask you to execute it.\n\nUser request: ${text}`
      : text;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text || '(image)',
      timestamp: Date.now(),
      images: currentImages.length > 0 ? currentImages : undefined,
    };

    setMessages(prev => [...prev, userMsg]);
    // Set ref immediately — don't wait for useEffect (prevents React render race in queue guard)
    isGeneratingRef.current = true;
    setIsGenerating(true);
    generationStartRef.current = Date.now();
    lastActivityRef.current = Date.now();
    setGenerationStuck(false);
    // Sync active epoch to current epoch — re-enables token acceptance after clear/cancel
    activeEpochRef.current = streamEpochRef.current;
    streamBufferRef.current = '';
    thinkingSegmentsRef.current = [];
    wasRespondingRef.current = false;
    setStreamingText('');
    setThinkingSegments([]);
    setCompletedStreamingTools([]);
    executingToolsRef.current = [];

    try {
      const api = window.electronAPI;
      if (!api) throw new Error('Electron API not available');

      const context: AIChatContext = {
        projectPath: rootPath || undefined,
        params: { temperature, maxTokens, topP, topK, repeatPenalty, seed },
        maxIterations,
        autoMode,
      };

      // Cloud provider selection (skip if Auto Mode — backend will decide)
      if (!autoMode && isUsingCloud && cloudProvider && cloudModel) {
        context.cloudProvider = cloudProvider;
        context.cloudModel = cloudModel;
      }

      // Include recent conversation history for BOTH local and cloud.
      // Local models otherwise "forget" after llmResetSession() / model switches.
      const recentMessages = messages.slice(-20).filter(m => (m.role === 'user' || m.role === 'assistant') && !m.isQuotaMessage && !m.isError);
      context.conversationHistory = recentMessages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Add current file context
      if (currentFile) {
        const fileResult = await api.readFile(currentFile);
        context.currentFile = {
          path: currentFile,
          content: fileResult.success ? fileResult.content : undefined,
        };
      }

      // Add selected text
      if (selectedText) {
        context.selectedCode = selectedText;
      }

      // Web search
      if (useWebSearch) {
        context.webSearch = text;
      }

      // Attached images for vision models
      if (currentImages.length > 0) {
        context.images = currentImages.map(img => ({
          data: img.data,
          mimeType: img.mimeType,
          name: img.name,
        }));
      }

      // Detect error/bug patterns
      const errorPatterns = /error|exception|bug|crash|fail|traceback|stack trace/i;
      if (errorPatterns.test(effectiveText)) {
        // Extract potential error message
        const lines = effectiveText.split('\n');
        const errorLine = lines.find(l => errorPatterns.test(l)) || effectiveText;
        context.errorMessage = errorLine;
        context.stackTrace = effectiveText;
      }

      const result = await api.aiChat(effectiveText, context);

      // BUG-FIX: If the backend returned no text, yield one event-loop tick so any
      // in-flight llm-token IPC events finish processing before we read streamBufferRef.
      if (result.success && !result.text) {
        await new Promise(r => setTimeout(r, 0));
      }

      // BUG-026: If model is unavailable, clear the queue — retrying queued messages
      // is pointless until the user loads a model, and draining them causes a stampede.
      if (!result.success && /model not loaded|no model loaded/i.test(result.error || '')) {
        messageQueueRef.current = [];
        setMessageQueue([]);
      }

      // Handle license block
      if (!result.success && result.error === '__LICENSE_BLOCKED__') {
        setMessages(prev => [...prev, {
          id: `msg-license-${Date.now()}`,
          role: 'assistant',
          content: '**License Required** — Cloud AI features require an active subscription. Sign up at [graysoft.dev/account](https://graysoft.dev/account) (Pro $4.99/mo), then go to **Settings → License** to activate.\n\nLocal AI, editor, file explorer, and terminal remain fully functional on the free plan.',
          timestamp: Date.now(),
        }]);
        // Refresh license status
        const status = await window.electronAPI?.licenseGetStatus?.();
        if (status) setLicenseStatus(status);
        setIsGenerating(false);
        setStreamingText('');
        setThinkingSegments([]);
        setAgenticProgress(null);
        return;
      }

      // Handle Guide Cloud AI free-tier quota exceeded
      if (!result.success && (result.error === '__QUOTA_EXCEEDED__' || (result as any).isQuotaError)) {
        setMessages(prev => [...prev, {
          id: `msg-quota-${Date.now()}`,
          role: 'assistant',
          isQuotaMessage: true,
          content: "**Daily Guide Cloud AI limit reached** — You've used your 20 free messages for today.\n\nSign in for more free messages, upgrade to Pro for 500/day, or switch to a local model for unlimited offline use.",
          timestamp: Date.now(),
        }]);
        setIsGenerating(false);
        setStreamingText('');
        setThinkingSegments([]);
        setAgenticProgress(null);
        return;
      }

      // If the backend signals this request was superseded by a newer queued message,
      // skip adding a response bubble entirely — including any partially rendered thinking.
      // The superseding request will produce the real response.
      if ((result as any).superseded === true) {
        return;
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-resp`,
        role: 'assistant',
        content: result.success
          ? (() => {
              // Prefer what the backend explicitly computed (includes savedExplanationText prepend etc.)
              const backendText = result.text?.trim() ?? '';
              const bufferText = streamBufferRef.current.trim();
              const hasThinking = thinkingSegmentsRef.current.some(s => s.trim());
              // If backend and buffer are both empty but thinking exists, show empty bubble
              // (thinking block will render) rather than the misleading fallback string.
              // BUG-IMG2: bufferText wins — the committed bubble must match what the
              // typewriter showed. backendText can diverge when shouldAutoSummarize
              // silently appends a summary that was never streamed to the renderer.
              return bufferText || backendText || (hasThinking ? '' : 'No response generated.');
            })()
          : `Error: ${result.error}`,
        timestamp: Date.now(),
        model: result.model,
        webSearchUsed: useWebSearch,
        thinkingText: thinkingSegmentsRef.current.filter(s => s.trim()).join('\n\n---THINKING_SEGMENT---\n\n') || undefined,
        toolsUsed: result.toolResults && result.toolResults.length > 0 ? result.toolResults : undefined,
      };

      setMessages(prev => [...prev, assistantMsg]);

      // TTS: speak the response if enabled
      if (ttsEnabled && result.success && result.text) {
        speakText(result.text);
      }
    } catch (e: any) {
      // BUG-026: Clear queue on model-unavailable errors to prevent retry stampede
      if (/model not loaded|no model loaded/i.test(e.message || '')) {
        messageQueueRef.current = [];
        setMessageQueue([]);
      }
      setMessages(prev => [...prev, {
        id: `msg-err-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${e.message}. Make sure a model is loaded.`,
        timestamp: Date.now(),
      }]);
    } finally {
      // Clear ref immediately — don't wait for useEffect sync (prevents guard race)
      isGeneratingRef.current = false;
      setIsGenerating(false);
      setStreamingText('');
      setThinkingSegments([]);
      setCompletedStreamingTools([]);
      executingToolsRef.current = [];
      setAgenticProgress(null);
      setAgenticPhases([]);
      setGenerationStuck(false);
      generationStartRef.current = null;
      // Auto-send next queued message
      setTimeout(() => processQueueRef.current(), 100);
    }
  };

  const sendMessage = async () => {
    // Stop listening when sending
    if (isListening) {
      stopListening();
    }

    // Keep processQueueRef pointing at latest sendMessageDirect
    processQueueRef.current = async () => {
      // Guard: if a message is already being generated, bail out.
      // The finally block of that sendMessageDirect will fire this again when done.
      // Using isGeneratingRef (not state) to avoid React render race conditions.
      if (isGeneratingRef.current) return;
      const queue = messageQueueRef.current;
      if (queue.length === 0) return;
      const nextMsg = queue[0];
      const remaining = queue.slice(1);
      messageQueueRef.current = remaining;
      setMessageQueue(remaining);
      await new Promise(r => setTimeout(r, 300));
      sendMessageDirect(nextMsg);
    };

    const text = input.trim();
    if (!text && attachedImages.length === 0 && attachedFiles.length === 0) return;

    // If currently generating, queue the message instead of blocking
    // Use ref (not state) to avoid stale-closure race where setIsGenerating(true)
    // hasn't propagated through React's render cycle yet.
    if (isGeneratingRef.current) {
      const newQueue = [...messageQueueRef.current, text];
      messageQueueRef.current = newQueue;
      setMessageQueue(newQueue);
      setInput('');
      return;
    }

    const currentImages = [...attachedImages];
    const currentFiles = [...attachedFiles];
    setInput('');
    setAttachedImages([]);
    setAttachedFiles([]);

    // /agent command — spawn a background agent
    if (text.startsWith('/agent ')) {
      const agentTask = text.substring(7).trim();
      if (agentTask) {
        const api = window.electronAPI;
        if (api?.agentSpawn) {
          setMessages(prev => [...prev, {
            id: `msg-${Date.now()}`,
            role: 'user',
            content: text,
            timestamp: Date.now(),
          }]);
          const result = await api.agentSpawn(agentTask, { projectPath: rootPath }) as { success: boolean; id?: number; error?: string };
          setMessages(prev => [...prev, {
            id: `msg-agent-${Date.now()}`,
            role: 'assistant',
            content: result.success
              ? `🤖 **Background Agent #${result.id} spawned**\nTask: ${agentTask}\n\nThe agent is working in the background. You'll be notified when it completes.`
              : `Failed to spawn agent: ${result.error || 'Unknown error'}`,
            timestamp: Date.now(),
          }]);
        }
        return;
      }
    }

    // Prepend attached file contents as context
    let effectiveText = text;
    if (currentFiles.length > 0) {
      const fileContext = currentFiles.map(f =>
        `📎 **${f.name}** (${f.path}):\n\`\`\`\n${f.content}\n\`\`\``
      ).join('\n\n');
      effectiveText = `${fileContext}\n\n${text}`;
    }

    sendMessageDirect(effectiveText, currentImages);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const cancelGeneration = async () => {
    await window.electronAPI?.llmCancel();
    setIsGenerating(false);
    setAgenticProgress(null);
    setAgenticPhases([]);
  };

  const clearChat = async () => {
    // Cancel any ongoing generation first — prevents ghost responses resuming after clear
    if (isGenerating) {
      // AWAIT the cancel to ensure the backend fully stops before resetting.
      // llm-cancel already calls resetSession() internally, so we skip
      // the separate llmResetSession() call below to avoid a race.
      await window.electronAPI?.llmCancel();
      setIsGenerating(false);
    }
    // INCREMENT epoch — causes the token listener to discard any tokens still in the
    // IPC pipeline from the old generation. This is the definitive fix for ghost tokens
    // appearing in the new chat after pressing the trash can button.
    streamEpochRef.current++;
    // Clear streaming buffers
    streamBufferRef.current = '';
    thinkingSegmentsRef.current = [];
    wasRespondingRef.current = false;
    if (messages.length > 0) saveCurrentSession();
    setMessages([]);
    setStreamingText('');
    setThinkingSegments([]);
    setExecutingTools([]);
    setCompletedStreamingTools([]);
    executingToolsRef.current = [];
    setAgenticProgress(null);
    setAgenticPhases([]);
    setPendingFileChanges([]);
    setCheckpoints(new Map());
    setTodos([]);
    // Only call resetSession if we didn't already cancel (cancel does its own reset)
    if (!isGenerating) {
      await window.electronAPI?.llmResetSession();
    }
    // Clear conversation memory so new session doesn't inherit old context
    (window as any).electronAPI?.memoryClearConversations?.();
  };

  // Cancel any ongoing generation and reset all streaming state
  const cancelAndResetStream = useCallback(async () => {
    if (isGenerating) {
      await window.electronAPI?.llmCancel();
      setIsGenerating(false);
    }
    // Increment epoch to discard any stale tokens still in IPC pipeline
    streamEpochRef.current++;
    // Clear all stream buffers
    streamBufferRef.current = '';
    thinkingSegmentsRef.current = [];
    wasRespondingRef.current = false;
    setStreamingText('');
    setThinkingSegments([]);
    setExecutingTools([]);
    setCompletedStreamingTools([]);
    executingToolsRef.current = [];
    setAgenticProgress(null);
    setAgenticPhases([]);
  }, [isGenerating]);

  const switchModel = async (model: AvailableModel) => {
    setShowModelPicker(false);
    // Selecting an LLM exits image mode — the two are mutually exclusive
    setActiveImageModel(null);
    // BUG-028: capture before cancelAndResetStream — llmCancel (inside) already calls resetSession.
    // Only call llmResetSession separately if we weren't generating (cancel wasn't called).
    const wasGenerating = isGenerating;
    // Cancel any ongoing generation first — prevents "Object is disposed" errors
    await cancelAndResetStream();
    // Only reset session if cancel didn't already do it (avoids double reset race)
    if (!wasGenerating) {
      window.electronAPI?.llmResetSession?.();
    }
    // Clear todos from previous session — prevents ghost todos appearing from prior runs
    setTodos([]);
    // Show loading message - model loading can take several minutes
    const loadingMsgId = `msg-loading-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: loadingMsgId,
      role: 'system',
      content: `Loading model "${model.name}" (${model.sizeFormatted})...`,
      timestamp: Date.now(),
    }]);
    try {
      // Race model load against a generous timeout (2 minutes — loads are much faster now with gpuLayers:auto)
      const loadPromise = window.electronAPI?.llmLoadModel(model.path);
      const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, error: 'Model loading timed out after 2 minutes. Try a smaller model or restart guIDE.' }), 2 * 60 * 1000)
      );
      const result = await Promise.race([loadPromise, timeoutPromise]);
      // Remove loading message
      setMessages(prev => prev.filter(m => m.id !== loadingMsgId));
      if (result && !result.success) {
        setMessages(prev => [...prev, {
          id: `msg-err-${Date.now()}`,
          role: 'system',
          isError: true,
          content: `Failed to load "${model.name}"

${result.error || 'Unknown error'}`,
          timestamp: Date.now(),
        }]);
      } else if (result?.success) {
        setMessages(prev => [...prev, {
          id: `msg-success-${Date.now()}`,
          role: 'system',
          content: `Model "${model.name}" loaded successfully.`,
          timestamp: Date.now(),
        }]);
      }
    } catch (e: any) {
      // Remove loading message
      setMessages(prev => prev.filter(m => m.id !== loadingMsgId));
      console.error('Failed to switch model:', e);
      setMessages(prev => [...prev, {
        id: `msg-err-${Date.now()}`,
        role: 'system',
        isError: true,
        content: `Failed to load "${model.name}"

${e.message}`,
        timestamp: Date.now(),
      }]);
    }
  };

  // Generate a descriptive label for tool calls (show file paths when applicable)
  const getToolLabel = (toolCall: { tool: string; params?: Record<string, unknown> }, status?: 'ok' | 'fail' | 'running') => {
    const { tool, params } = toolCall;
    let detail = '';
    
    // Extract meaningful detail from params
    if (params) {
      if (params.filePath) {
        // Extract filename from path
        const fp = String(params.filePath);
        detail = fp.includes('/') ? fp.split('/').pop() || fp : fp.includes('\\') ? fp.split('\\').pop() || fp : fp;
      } else if (params.fileName) {
        detail = String(params.fileName);
      } else if (params.url) {
        // For browser navigation, show domain
        try {
          const u = new URL(String(params.url));
          detail = u.hostname;
        } catch { detail = String(params.url).substring(0, 30); }
      } else if (params.query) {
        detail = String(params.query).substring(0, 30);
      } else if (params.path) {
        const p = String(params.path);
        detail = p.includes('/') ? p.split('/').pop() || p : p.includes('\\') ? p.split('\\').pop() || p : p;
      }
    }

    const statusText = status === 'ok' ? ' [OK]' : status === 'fail' ? ' [FAIL]' : '';
    return detail ? `${tool}: ${detail}${statusText}` : `${tool}${statusText}`;
  };

  // Truncate tool call JSON content for display (especially large write_file content)
  const truncateToolContent = (content: string, maxLines = 15): string => {
    // Check if it's JSON with large content fields
    try {
      const parsed = JSON.parse(content);
      if (parsed.params?.content && typeof parsed.params.content === 'string' && parsed.params.content.length > 500) {
        const truncated = { ...parsed, params: { ...parsed.params, content: parsed.params.content.substring(0, 200) + '...[truncated]' } };
        return JSON.stringify(truncated, null, 2);
      }
    } catch { /* not JSON, truncate raw */ }
    
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      return lines.slice(0, maxLines).join('\n') + `\n...[${lines.length - maxLines} more lines]`;
    }
    return content;
  };

  // ── Generated Image Preview Component ──
  const GeneratedImagePreview: React.FC<{
    imageBase64: string;
    mimeType: string;
    prompt: string;
    provider: string;
    model: string;
  }> = ({ imageBase64, mimeType, prompt, provider, model }) => {
    const [saving, setSaving] = React.useState(false);
    const [saved, setSaved] = React.useState<string | null>(null);
    const [expanded, setExpanded] = React.useState(false);

    const dataUrl = `data:${mimeType};base64,${imageBase64}`;

    const handleSave = async () => {
      setSaving(true);
      try {
        const api = window.electronAPI as any;
        if (api?.imageSave) {
          const result = await api.imageSave(imageBase64, mimeType);
          if (result?.success) {
            setSaved(result.filePath);
          }
        }
      } catch (e) {
        console.error('Failed to save image:', e);
      }
      setSaving(false);
    };

    const handleQuickSave = async () => {
      setSaving(true);
      try {
        const api = window.electronAPI as any;
        if (api?.imageSaveToProject) {
          const result = await api.imageSaveToProject(imageBase64, mimeType);
          if (result?.success) {
            setSaved(result.filePath);
          }
        }
      } catch (e) {
        console.error('Failed to quick-save image:', e);
      }
      setSaving(false);
    };

    return (
      <div className="my-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] overflow-hidden max-w-[480px]">
        {/* Image preview */}
        <div
          className="relative cursor-pointer group"
          onClick={async () => {
            if (onOpenFile) {
              setSaving(true);
              try {
                const api = window.electronAPI as any;
                if (api?.imageSaveToProject) {
                  const result = await api.imageSaveToProject(imageBase64, mimeType, `generated-${Date.now()}.png`);
                  if (result?.success && result.filePath) {
                    onOpenFile(result.filePath);
                  }
                }
              } catch (_e) { /* ignore */ }
              setSaving(false);
            } else {
              setExpanded(!expanded);
            }
          }}
        >
          <img
            src={dataUrl}
            alt={prompt}
            className="w-full object-contain max-h-[300px]"
            style={{ imageRendering: 'auto' }}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 text-[11px] text-white px-2 py-1 rounded">
              {onOpenFile ? 'Open in editor' : 'Click to expand'}
            </span>
          </div>
        </div>

        {/* Info bar */}
        <div className="px-3 py-2 border-t border-[#3c3c3c]">

          {saved ? (
            <div className="flex items-center gap-1.5 text-[11px] text-[#89d185]">
              <Check size={12} />
              <span>Saved to {saved.split(/[/\\]/).slice(-2).join('/')}</span>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleQuickSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] bg-[#007acc] text-white hover:bg-[#0098ff] disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Save to Project
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] bg-[#333] text-[#ccc] hover:bg-[#444] disabled:opacity-50 transition-colors"
              >
                <Download size={12} />
                Save As…
              </button>
              {onOpenFile && (
                <button
                  onClick={async () => {
                    setSaving(true);
                    try {
                      const api = window.electronAPI as any;
                      if (api?.imageSaveToProject) {
                        const result = await api.imageSaveToProject(imageBase64, mimeType, `generated-${Date.now()}.png`);
                        if (result?.success && result.filePath) {
                          onOpenFile(result.filePath);
                        }
                      }
                    } catch (e) {
                      console.error('Failed to open image in viewport:', e);
                    }
                    setSaving(false);
                  }}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] bg-[#333] text-[#ccc] hover:bg-[#444] disabled:opacity-50 transition-colors"
                >
                  <Eye size={12} />
                  Open
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Generated Video Preview Component ──
  const GeneratedVideoPreview: React.FC<{
    videoBase64: string;
    mimeType: string;
    prompt: string;
    provider: string;
    model: string;
    duration?: string;
  }> = ({ videoBase64, mimeType, prompt: _videoPrompt, provider, model, duration }) => {
    const [saving, setSaving] = React.useState(false);
    const [saved, setSaved] = React.useState<string | null>(null);

    const dataUrl = `data:${mimeType};base64,${videoBase64}`;

    const handleSave = async () => {
      setSaving(true);
      try {
        const api = window.electronAPI as any;
        if (api?.videoSave) {
          const result = await api.videoSave(videoBase64, mimeType);
          if (result?.success) {
            setSaved(result.filePath);
          }
        }
      } catch (e) {
        console.error('Failed to save video:', e);
      }
      setSaving(false);
    };

    const handleQuickSave = async () => {
      setSaving(true);
      try {
        const api = window.electronAPI as any;
        if (api?.videoSaveToProject) {
          const result = await api.videoSaveToProject(videoBase64, mimeType);
          if (result?.success) {
            setSaved(result.filePath);
          }
        }
      } catch (e) {
        console.error('Failed to quick-save video:', e);
      }
      setSaving(false);
    };

    return (
      <div className="my-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] overflow-hidden max-w-[480px]">
        {/* Video preview */}
        <div className="relative">
          <video
            src={dataUrl}
            controls
            loop
            className="w-full max-h-[400px]"
            style={{ objectFit: 'contain' }}
          />
        </div>

        {/* Info bar */}
        <div className="px-3 py-2 border-t border-[#3c3c3c]">

          {saved ? (
            <div className="flex items-center gap-1.5 text-[11px] text-[#89d185]">
              <Check size={12} />
              <span>Saved to {saved.split(/[/\\]/).slice(-2).join('/')}</span>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleQuickSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] bg-[#c586c0] text-white hover:bg-[#d19fd1] disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Save to Project
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] bg-[#333] text-[#ccc] hover:bg-[#444] disabled:opacity-50 transition-colors"
              >
                <Download size={12} />
                Save As…
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Pollinations API Key Input (for video generation) ──
  const PollinationsKeyInput: React.FC = () => {
    const [value, setValue] = React.useState('');
    const [saved, setSaved] = React.useState(false);
    const [checking, setChecking] = React.useState(true);

    React.useEffect(() => {
      // Check if Pollinations key is already saved
      (window.electronAPI as any)?.imageGenStatus?.().then((status: any) => {
        if (status?.pollinationsKeysCount > 0) {
          setValue('••••••••••••••••');
          setSaved(true);
        }
        setChecking(false);
      }).catch(() => setChecking(false));
    }, []);

    const handleSave = async () => {
      if (!value || value === '••••••••••••••••') return;
      // Save via settings
      const api = window.electronAPI as any;
      const existing = await api?.loadSettings?.();
      const settings = existing?.settings || {};
      settings.pollinationsApiKey = value;
      await api?.saveSettings?.(settings);
      setSaved(true);
      setTimeout(() => setValue('••••••••••••••••'), 500);
    };

    const handleClear = async () => {
      const api = window.electronAPI as any;
      const existing = await api?.loadSettings?.();
      const settings = existing?.settings || {};
      settings.pollinationsApiKey = '';
      await api?.saveSettings?.(settings);
      setValue('');
      setSaved(false);
    };

    if (checking) return null;

    return (
      <div className="mb-2">
        <label className="text-[10px] text-[#858585] mb-0.5 block">Pollinations AI [Free] — Video Generation</label>
        <p className="text-[9px] text-[#585858] mb-1">
          Video gen works out of the box with built-in keys. Add your own for extra quota.{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); (window.electronAPI as any)?.openExternal?.('https://enter.pollinations.ai'); }} className="text-[#c586c0] hover:underline cursor-pointer">
            Get free key → enter.pollinations.ai
          </a>
        </p>
        <div className="flex gap-1">
          <input
            type="password"
            className="flex-1 bg-[#3c3c3c] text-[#cccccc] text-[11px] px-2 py-1 rounded border border-[#3c3c3c] focus:border-[#c586c0] outline-none"
            placeholder="pk_... or sk_..."
            value={value}
            onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          />
          <button
            className={`px-2 py-1 text-[10px] rounded ${saved ? 'bg-[#89d185] text-black' : 'bg-[#c586c0] text-white hover:bg-[#d19fd1]'}`}
            onClick={saved ? handleClear : handleSave}
            disabled={!value && !saved}
          >
            {saved ? 'Clear' : 'Save'}
          </button>
        </div>
      </div>
    );
  };

  // Render content with tool terminal and code block detection
  // Merges tool calls with their results into single collapsible blocks
  const renderContentParts = (content: string) => {
    // Pre-extract tool results for merging
    const toolResultMap = extractToolResults(content);

    const parts = content.split(/(```[\s\S]*?```)/g);
    const elements: React.ReactNode[] = [];
    // ALL tool blocks are collected here — appended as a single ToolCallGroup at the
    // bottom of the message. They are NEVER rendered inline in the text flow.
    const allToolElements: React.ReactElement[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (part.startsWith('```') && part.endsWith('```')) {
        const firstLine = part.indexOf('\n');
        const lang = part.substring(3, firstLine > 0 ? firstLine : 3).trim();
        const code = firstLine > 0 ? part.substring(firstLine + 1, part.length - 3) : part.substring(3, part.length - 3);

        // Tool call JSON block — collect into allToolElements (never inline)
        const toolCall = (lang === 'json' || lang === 'tool') ? parseToolCall(code) : null;
        if (toolCall) {
          const queue = toolResultMap.get(toolCall.tool);
          const result = queue?.length ? queue.shift() : undefined;
          if (result) {
            allToolElements.push(
              <CollapsibleToolBlock key={`t-${i}`} label={getToolLabel(toolCall, result.isOk ? 'ok' : 'fail')} icon={result.isOk ? '✓' : '✗'}>
                <div>
                  <div className="text-[10px] text-[#858585] mb-1 font-medium tracking-wide">PARAMETERS</div>
                  <pre className="whitespace-pre-wrap text-[11px] font-mono text-[#d4d4d4] bg-[#1e1e1e] rounded-md p-2 mb-2">{truncateToolContent(code)}</pre>
                  <div className="border-t border-[#333] pt-2">
                    <div className={`text-[10px] mb-1 font-medium tracking-wide ${result.isOk ? 'text-[#89d185]' : 'text-[#f14c4c]'}`}>RESULT</div>
                    <pre className="whitespace-pre-wrap text-[11px] font-mono text-[#d4d4d4] bg-[#1e1e1e] rounded-md p-2">{result.text}</pre>
                  </div>
                </div>
              </CollapsibleToolBlock>
            );
          } else {
            allToolElements.push(
              <CollapsibleToolBlock key={`t-${i}`} label={getToolLabel(toolCall, 'ok')} icon="✓">
                <div className="text-[11px] text-[#858585]">Completed</div>
              </CollapsibleToolBlock>
            );
          }
          continue;
        }

        // If this json/tool block failed parseToolCall (malformed, unknown tool, or tool result
        // output code block from inside ## Tool Execution Results section) — suppress it.
        // This prevents orphan CodeBlock renders for: (a) tool output wrapped in code fences,
        // (b) malformed/non-tool JSON from small models. Only suppress if it looks like a
        // tool-call attempt (has "tool": key) to preserve legitimate JSON explanation snippets.
        if (
          lang === 'tool' ||
          (lang === 'json' && (/"tool"\s*:/.test(code) || (/"name"\s*:/.test(code) && /"arguments"\s*:/.test(code)))) ||
          // Also catch plain (no-language) fences emitted by llama-style models: ``` {"tool":"..."} ```
          (lang === '' && /^\s*\{\s*"tool"\s*:/.test(code))
        ) {
          // tool-call fence that failed parseToolCall — suppress. Never render as a raw code bubble.
          // Legitimate code examples won't open with {"tool":; tool calls here are malformed/aliased
          // and already shown via ToolCallGroup (tool-executing events).
          continue;
        }

        // Tool result code block — skip (already merged into tool calls)
        if (lang === '' && (code.trim().startsWith('Tool Execution Results') || code.trim().startsWith('## Tool Execution Results'))) {
          continue;
        }

        // Mermaid diagram — render as SVG
        if (lang === 'mermaid') {
          elements.push(<MermaidDiagram key={i} code={code} />);
          continue;
        }

        // Regular code block
        elements.push(<CodeBlock key={i} code={code} language={lang} onApply={() => onApplyCode(currentFile, code)} />);
        continue;
      }

      // Plain text — strip tool execution results sections (already merged) and artifacts
      let text = part;
      // Strip "## Tool Execution Results" section but PRESERVE any trailing prose the
      // model wrote AFTER the last tool entry (e.g. a final summary paragraph).
      const toolResultsIdx = text.indexOf('## Tool Execution Results');
      if (toolResultsIdx !== -1) {
        const preTool = text.substring(0, toolResultsIdx).trimEnd();
        const toolSection = text.substring(toolResultsIdx);
        const trailingMatch = toolSection.match(/^([\s\S]*### \S+ \[(?:OK|FAIL)\][^\n]*\n[\s\S]*?)(\n\n(?!###)[\s\S]+)?$/);
        const trailingProse = trailingMatch?.[2]?.trim() ?? '';
        text = preTool + (preTool && trailingProse ? '\n\n' : '') + trailingProse;
      } else if (text.trim().startsWith('### Tool Execution Results')) {
        text = '';
      }
      // Strip any remaining standalone ### toolname [OK|FAIL] sections
      text = text.replace(/\n*### \S+ \[(?:OK|FAIL)\][\s\S]*/g, '');

      if (text.trim()) {
        // Check for generated image/video markers
        const mediaMarkerRegex = /<!--GENERATED_(?:IMAGE|VIDEO):([\s\S]*?)-->/g;
        const textParts = text.split(mediaMarkerRegex);
        
        for (let j = 0; j < textParts.length; j++) {
          const tp = textParts[j];
          
          if (j % 2 === 1) {
            try {
              const mediaData = JSON.parse(tp);
              if (mediaData.type === 'generated-image' && mediaData.imageBase64) {
                elements.push(
                  <GeneratedImagePreview
                    key={`genimg-${i}-${j}`}
                    imageBase64={mediaData.imageBase64}
                    mimeType={mediaData.mimeType || 'image/png'}
                    prompt={mediaData.prompt || ''}
                    provider={mediaData.provider || 'unknown'}
                    model={mediaData.model || 'unknown'}
                  />
                );
                continue;
              }
              if (mediaData.type === 'generated-video' && mediaData.videoBase64) {
                elements.push(
                  <GeneratedVideoPreview
                    key={`genvid-${i}-${j}`}
                    videoBase64={mediaData.videoBase64}
                    mimeType={mediaData.mimeType || 'video/mp4'}
                    prompt={mediaData.prompt || ''}
                    provider={mediaData.provider || 'unknown'}
                    model={mediaData.model || 'unknown'}
                    duration={mediaData.duration}
                  />
                );
                continue;
              }
            } catch {
              // Invalid JSON — render as text
            }
          }

          if (!tp.trim()) continue;

          // Inline JSON tool calls — route to allToolElements, never inline in text
          const segments = splitInlineToolCalls(tp);
          for (const seg of segments) {
            if (seg.type === 'tool' && seg.toolCall) {
              const queue = toolResultMap.get(seg.toolCall.tool);
              const result = queue?.length ? queue.shift() : undefined;
              if (result) {
                allToolElements.push(
                  <CollapsibleToolBlock key={`inline-${i}-${j}-${allToolElements.length}`} label={getToolLabel(seg.toolCall, result.isOk ? 'ok' : 'fail')} icon={result.isOk ? '✓' : '✗'}>
                    <div>
                      <div className="text-[10px] text-[#858585] mb-1 font-medium tracking-wide">PARAMETERS</div>
                      <pre className="whitespace-pre-wrap text-[11px] font-mono text-[#d4d4d4] bg-[#1e1e1e] rounded-md p-2 mb-2">{truncateToolContent(seg.content)}</pre>
                      <div className="border-t border-[#333] pt-2">
                        <div className={`text-[10px] mb-1 font-medium tracking-wide ${result.isOk ? 'text-[#89d185]' : 'text-[#f14c4c]'}`}>RESULT</div>
                        <pre className="whitespace-pre-wrap text-[11px] font-mono text-[#d4d4d4] bg-[#1e1e1e] rounded-md p-2">{result.text}</pre>
                      </div>
                    </div>
                  </CollapsibleToolBlock>
                );
              } else {
                allToolElements.push(
                  <CollapsibleToolBlock key={`inline-${i}-${j}-${allToolElements.length}`} label={getToolLabel(seg.toolCall, 'ok')} icon="✓">
                    <div className="text-[11px] text-[#858585]">Completed</div>
                  </CollapsibleToolBlock>
                );
              }
            } else {
              elements.push(<InlineMarkdownText key={`inline-${i}-${j}-${elements.length}`} content={seg.content} />);
            }
          }
        }
      }
    }

    // Single unified ToolCallGroup at the bottom — all tool calls in one place
    if (allToolElements.length > 0) {
      elements.push(
        <ToolCallGroup key="tcg-all" count={allToolElements.length}>
          {allToolElements}
        </ToolCallGroup>
      );
    }

    return elements;
  };

  const renderMessage = (msg: ChatMessage): React.ReactNode[] => {
    const parts = renderContentParts(msg.content);
    if (msg.toolsUsed && msg.toolsUsed.length > 0) {
      // Only add tool group if content parsing didn't already find inline tool calls
      const hasToolGroup = parts.some((p: any) => p?.key === 'tcg-all');
      if (!hasToolGroup) {
        const toolGroup = (
          <ToolCallGroup key="msg-tools" count={msg.toolsUsed.length}>
            {msg.toolsUsed.map((tu, i) => (
              <CollapsibleToolBlock
                key={`msg-tu-${i}`}
                label={getToolLabel(tu, tu.result?.success !== false ? 'ok' : 'fail')}
                icon={tu.result?.success !== false ? '✓' : '✗'}
              >
                <div className="text-[11px] text-[#858585]">Completed</div>
              </CollapsibleToolBlock>
            ))}
          </ToolCallGroup>
        );
        return [toolGroup, ...parts];
      }
    }
    return parts;
  };

  // For streaming: split on complete code blocks, render completed ones with full styling,
  // and leave the trailing incomplete block as plain text
  // Also merges tool calls with their results like renderContentParts
  const renderStreamingContent = (text: string) => {
    // Pre-extract tool results for merging (same as renderContentParts)
    const toolResultMap = extractToolResults(text);

    // Find all complete code blocks (``` ... ```)
    const completeBlockRegex = /```[\s\S]*?```/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let idx = 0;

    while ((match = completeBlockRegex.exec(text)) !== null) {
      // Text before this code block
      if (match.index > lastIndex) {
        let before = text.substring(lastIndex, match.index);
        // Strip everything from "## Tool Execution Results" to end of this text segment —
        // results are already merged into CollapsibleToolBlock via extractToolResults().
        before = before.replace(/\n*## Tool Execution Results[\s\S]*/g, '');
        // Strip any remaining standalone ### toolname [OK|FAIL] sections (greedy to end)
        before = before.replace(/\n*### \S+ \[(?:OK|FAIL)\][\s\S]*/g, '');
        if (before.trim() && !before.trim().startsWith('### Tool Execution Results')) {
          // Check for generated image/video markers in text before code blocks
          const imgMarkerRegex = /<!--GENERATED_(?:IMAGE|VIDEO):([\s\S]*?)-->/g;
          if (imgMarkerRegex.test(before)) {
            imgMarkerRegex.lastIndex = 0;
            const imgParts = before.split(/<!--GENERATED_(?:IMAGE|VIDEO):([\s\S]*?)-->/);
            for (let j = 0; j < imgParts.length; j++) {
              if (j % 2 === 1) {
                try {
                  const mediaData = JSON.parse(imgParts[j]);
                  if (mediaData.type === 'generated-image' && mediaData.imageBase64) {
                    parts.push(
                      <GeneratedImagePreview
                        key={`bgenimg-${idx}-${j}`}
                        imageBase64={mediaData.imageBase64}
                        mimeType={mediaData.mimeType || 'image/png'}
                        prompt={mediaData.prompt || ''}
                        provider={mediaData.provider || 'unknown'}
                        model={mediaData.model || 'unknown'}
                      />
                    );
                    continue;
                  }
                  if (mediaData.type === 'generated-video' && mediaData.videoBase64) {
                    parts.push(
                      <GeneratedVideoPreview
                        key={`bgenvid-${idx}-${j}`}
                        videoBase64={mediaData.videoBase64}
                        mimeType={mediaData.mimeType || 'video/mp4'}
                        prompt={mediaData.prompt || ''}
                        provider={mediaData.provider || 'unknown'}
                        model={mediaData.model || 'unknown'}
                        duration={mediaData.duration}
                      />
                    );
                    continue;
                  }
                } catch { /* render as text */ }
              }
              if (imgParts[j].trim()) {
                parts.push(<InlineMarkdownText key={`sb-${idx}-${j}`} content={imgParts[j]} />);
              }
            }
          } else {
          // Check for inline JSON tool calls in plain text
          // Strip any trailing partial tool-call JSON mid-stream before the regex can identify it
          const segments = splitInlineToolCalls(stripTrailingPartialToolCall(before));
          for (const seg of segments) {
            if (seg.type === 'tool') {
              // Suppress — tool calls are tracked in the ToolCallGroup (executingTools/completedStreamingTools)
              // Rendering them here too causes duplicate clutter in the stream.
            } else {
              parts.push(<InlineMarkdownText key={`s-${idx}`} content={seg.content} />);
            }
            idx++;
          }
          }
        } else {
          idx++;
        }
      }
      // The complete code block — render with full styling
      const block = match[0];
      const firstLine = block.indexOf('\n');
      const lang = block.substring(3, firstLine > 0 ? firstLine : 3).trim();
      const code = firstLine > 0 ? block.substring(firstLine + 1, block.length - 3) : block.substring(3, block.length - 3);
      const toolCall = (lang === 'json' || lang === 'tool') ? parseToolCall(code) : null;

      if (toolCall) {
        // Merge with result if available
        const queue = toolResultMap.get(toolCall.tool);
        const result = queue?.length ? queue.shift() : undefined;

        if (result) {
          // Suppress — completed tool calls are shown in the ToolCallGroup (completedStreamingTools).
          // Rendering them inline here too causes duplicate clutter in the stream.
          // (intentionally nothing pushed)
        } else {
          // Tool block complete but no result yet — executingTools already shows it in the ToolCallGroup.
          // (intentionally nothing pushed)
        }
      } else if (lang === '' && (code.trim().startsWith('Tool Execution Results') || code.trim().startsWith('## Tool Execution Results'))) {
        // Tool result code block — skip (merged into tool calls)
      } else if (
        lang === 'tool' ||
        (lang === 'json' && (/"tool"\s*:/.test(code) || (/"name"\s*:/.test(code) && /"arguments"\s*:/.test(code)))) ||
        // Also catch plain (no-language) fences from llama-style models: ``` {"tool":"..."} ```
        (lang === '' && /^\s*\{\s*"tool"\s*:/.test(code))
      ) {
        // tool-call fence that failed parseToolCall in streaming — suppress, not a code bubble.
        // Already shown via ToolCallGroup (tool-executing events). Malformed/aliased tool calls
        // have no business rendering as raw JSON to the user.
      } else if (lang === 'mermaid') {
        parts.push(<MermaidDiagram key={`b-${idx}`} code={code} />);
      } else {
        parts.push(<CodeBlock key={`b-${idx}`} code={code} language={lang} onApply={() => onApplyCode(currentFile, code)} />);
      }
      lastIndex = match.index + match[0].length;
      idx++;
    }

    // Remaining text after last complete block (may include an incomplete ``` block being typed)
    if (lastIndex < text.length) {
      let remaining = text.substring(lastIndex);

      // Strip everything from "## Tool Execution Results" to end — already in CollapsibleToolBlock
      remaining = remaining.replace(/\n*## Tool Execution Results[\s\S]*/g, '');
      // Strip any remaining standalone ### toolname [OK|FAIL] sections (greedy to end)
      remaining = remaining.replace(/\n*### \S+ \[(?:OK|FAIL)\][\s\S]*/g, '');
      // Strip stranded language identifier artifacts — e.g. "json\n" or "html\n" left over
      // when a prior `completeBlockRegex` match consumed the opening ``` of the next block,
      // leaving the language tag as the start of `remaining` with no backticks.
      remaining = remaining.replace(/^[ \t]*(json|html|css|javascript|typescript|python|bash|sh|xml|yaml|markdown|md|ts|js|py|jsx|tsx|sql|go|rust|cpp|c|java|ruby|php)\s*\n/, '');
      // Strip any trailing partial tool-call JSON mid-stream before the regex can identify it
      remaining = stripTrailingPartialToolCall(remaining);

      if (remaining.trim().startsWith('### Tool Execution Results')) {
        // Already merged — skip
      } else {
        // Detect incomplete tool call code blocks being streamed (```json\n{"tool":... without closing ```)
        // Matches as soon as the "tool" key appears in the block — the colon is not required so
        // the block is hidden 1-2 tokens earlier than before. Deliberately does NOT match generic
        // "name" keys to avoid false-positives on non-tool JSON (e.g. {"name": "John"}).
        const incompleteToolMatch = remaining.match(/```(?:json|tool)?\s*\n?\s*\{[\s\S]*?"tool"/);
        if (incompleteToolMatch) {
          // Suppress — incomplete tool block mid-stream is already tracked in executingTools/ToolCallGroup.
          // Only render any text that appeared before the opening ```.
          const beforeBlock = remaining.substring(0, remaining.indexOf('```'));
          if (beforeBlock.trim()) {
            parts.push(<InlineMarkdownText key={`s-${idx}`} content={beforeBlock} />);
            idx++;
          }
        } else if (remaining.trim()) {
          // Suppress incomplete non-tool fence artifact (e.g. ```html\n<div being typed)
          // — the raw backtick+language glyph shows as loose text until the block is complete.
          // Once the closing ``` arrives it becomes a proper CodeBlock via completeBlockRegex.
          const openFenceIdx = remaining.indexOf('```');
          const hasOpenFence = openFenceIdx !== -1;
          const hasClosingFence = hasOpenFence && remaining.indexOf('```', openFenceIdx + 3) !== -1;
          if (hasOpenFence && !hasClosingFence) {
            // Incomplete fence — render only whatever came before it
            const beforeFence = remaining.substring(0, openFenceIdx).trim();
            if (beforeFence) {
              parts.push(<InlineMarkdownText key={`s-${idx}`} content={beforeFence} />);
              idx++;
            }
            // The incomplete fence itself is not rendered until it's closed
          } else {
          // Check for generated image/video markers first
          const imgMarkerRegex = /<!--GENERATED_(?:IMAGE|VIDEO):([\s\S]*?)-->/g;
          if (imgMarkerRegex.test(remaining)) {
            imgMarkerRegex.lastIndex = 0;
            const imgParts = remaining.split(/<!--GENERATED_(?:IMAGE|VIDEO):([\s\S]*?)-->/);
            for (let j = 0; j < imgParts.length; j++) {
              if (j % 2 === 1) {
                try {
                  const mediaData = JSON.parse(imgParts[j]);
                  if (mediaData.type === 'generated-image' && mediaData.imageBase64) {
                    parts.push(
                      <GeneratedImagePreview
                        key={`sgenimg-${idx}-${j}`}
                        imageBase64={mediaData.imageBase64}
                        mimeType={mediaData.mimeType || 'image/png'}
                        prompt={mediaData.prompt || ''}
                        provider={mediaData.provider || 'unknown'}
                        model={mediaData.model || 'unknown'}
                      />
                    );
                    continue;
                  }
                  if (mediaData.type === 'generated-video' && mediaData.videoBase64) {
                    parts.push(
                      <GeneratedVideoPreview
                        key={`sgenvid-${idx}-${j}`}
                        videoBase64={mediaData.videoBase64}
                        mimeType={mediaData.mimeType || 'video/mp4'}
                        prompt={mediaData.prompt || ''}
                        provider={mediaData.provider || 'unknown'}
                        model={mediaData.model || 'unknown'}
                        duration={mediaData.duration}
                      />
                    );
                    continue;
                  }
                } catch { /* render as text */ }
              }
              if (imgParts[j].trim()) {
                parts.push(<InlineMarkdownText key={`sr-${idx}-${j}`} content={imgParts[j]} />);
              }
            }
          } else {
          // Inline tool calls in remaining text — suppress them (they're already in the
          // executingTools/completedStreamingTools ToolCallGroup). Use the cleaned text
          // segments from splitInlineToolCalls (which applies stripToolArtifacts).
          const segments = splitInlineToolCalls(remaining);
          for (const seg of segments) {
            if (seg.type === 'tool') {
              // Suppress — ToolCallGroup wrench already shows these
            } else if (seg.content.trim()) {
              parts.push(<InlineMarkdownText key={`sr-${idx}`} content={seg.content} />);
            }
            idx++;
          }
          }
          } // end incompleteAnyFence else
        }
      }
    }

    return parts;
  };

  return (
    <div className="h-full flex flex-col bg-[#252526] overflow-hidden relative">
      {/* Header — pr-[140px] reserves space for Electron window controls (min/max/close) */}
      <div className="h-[30px] flex items-center px-3 pr-[140px] border-b border-[#1e1e1e] flex-shrink-0">
        <Sparkles size={14} className="text-[#007acc] mr-2 flex-shrink-0" />
        <span className="text-[12px] font-semibold text-[#cccccc] whitespace-nowrap brand-font">gu<span className="text-[#007acc]">IDE</span> <span className="font-sans font-semibold">AI</span></span>
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-1 flex-shrink-0">

          <button
            className={`p-1 rounded text-[11px] flex items-center gap-1 ${ttsEnabled ? 'text-[#dcdcaa] bg-[#dcdcaa20]' : 'text-[#858585] hover:text-white'}`}
            onClick={() => { setTtsEnabled(!ttsEnabled); if (isSpeaking) stopSpeaking(); }}
            title={ttsEnabled ? 'TTS On (click to disable)' : 'TTS Off (click to enable)'}
            aria-label={ttsEnabled ? 'Disable text-to-speech' : 'Enable text-to-speech'}
            aria-pressed={ttsEnabled}
          >
            {ttsEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
          </button>

          <button
            className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
            onClick={() => setShowSettings(!showSettings)}
            title="API Keys &amp; License"
            aria-label="API Keys and License"
            aria-expanded={showSettings}
          >
            <Key size={12} />
          </button>
          <button
            className={`p-1 rounded hover:bg-[#3c3c3c] ${showDevConsole ? 'text-[#dcdcaa]' : 'text-[#858585] hover:text-white'}`}
            onClick={() => { const next = !showDevConsole; setShowDevConsole(next); showDevConsoleRef.current = next; if (next) setDevLogs([...devLogsRef.current]); }}
            title="Developer Console — view backend logs"
            aria-label="Developer console"
            aria-expanded={showDevConsole}
          >
            <Terminal size={12} />
          </button>
          <button
            className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
            onClick={clearChat}
            title="New Conversation"
            aria-label="New conversation"
          >
            <Plus size={12} />
          </button>
          <button
            className={`p-1 rounded hover:bg-[#3c3c3c] ${showHistory ? 'text-[#007acc]' : 'text-[#858585] hover:text-white'}`}
            onClick={() => { setShowHistory(!showHistory); if (!showHistory) refreshSavedSessions(); }}
            title="Chat History"
            aria-label="Chat history"
            aria-expanded={showHistory}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2H2.5C1.67 2 1 2.67 1 3.5v9C1 13.33 1.67 14 2.5 14h11c.83 0 1.5-.67 1.5-1.5v-9C15 2.67 14.33 2 13.5 2zM4 5h8v1H4V5zm0 3h8v1H4V8zm0 3h5v1H4v-1z"/></svg>
          </button>
          <button
            className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
            onClick={clearChat}
            title="Clear Chat History"
            aria-label="Clear chat"
          >
            <Trash2 size={12} />
          </button>
          <button
            className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
            onClick={onClose}
            title="Close"
            aria-label="Close chat panel"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Model picker dropdown */}
      <ModelPicker
        show={showModelPicker}
        onClose={() => setShowModelPicker(false)}
        cloudProvider={cloudProvider}
        cloudModel={cloudModel}
        setCloudProvider={setCloudProvider}
        setCloudModel={setCloudModel}
        cloudProviders={cloudProviders}
        allCloudProviders={allCloudProviders}
        favoriteModels={favoriteModels}
        toggleFavorite={toggleFavorite}
        availableModels={availableModels}
        isUsingCloud={isUsingCloud}
        llmStatus={llmStatus}
        switchModel={switchModel}
        switchImageModel={handleSwitchImageModel}
        activeImageModelPath={activeImageModel?.path ?? null}
        cancelAndResetStream={cancelAndResetStream}
        refreshAllProviders={refreshAllProviders}
        refreshCloudProviders={refreshCloudProviders}
        addSystemMessage={(content: string) => {
          setMessages(prev => [...prev, {
            id: `msg-cloud-${Date.now()}`,
            role: 'system',
            content,
            timestamp: Date.now(),
          }]);
        }}
      />
      {/* Session history panel */}
      {showHistory && (
        <div className="px-3 py-2 border-b border-[#1e1e1e] flex-shrink-0 max-h-[200px] overflow-auto chat-dropdown-panel">
          <p className="text-[10px] text-[#858585] mb-2 uppercase tracking-wider">Recent Sessions</p>
          {savedSessions.length === 0 ? (
            <p className="text-[11px] text-[#585858]">No saved sessions</p>
          ) : (
            savedSessions.map((session: any) => (
              <div key={session.id} className="flex items-center gap-1 mb-0.5">
                <button
                  className="flex-1 text-left px-2 py-1.5 text-[11px] hover:bg-[#094771] rounded flex items-center gap-2"
                  onClick={() => loadSession(session)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[#cccccc]">{session.title}</div>
                    <div className="text-[10px] text-[#858585]">
                      {session.messages.length} messages • {new Date(session.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                </button>
                <button
                  className="p-1 text-[#585858] hover:text-[#f44747] rounded flex-shrink-0"
                  title="Delete session"
                  onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                >
                  <X size={10} />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* API Keys panel */}
      {showSettings && (
        <div className="px-3 py-2 border-b border-[#1e1e1e] flex-shrink-0 max-h-[300px] overflow-auto chat-dropdown-panel">
          <p className="text-[10px] text-[#858585] mb-2 uppercase tracking-wider">Cloud API Keys</p>
          <p className="text-[10px] text-[#585858] mb-2">Enter API keys to use cloud LLM services.</p>
          <p className="text-[10px] text-[#3794ff] mb-2 font-medium">* Groq + Cerebras recommended — free, ultra-fast, pre-configured</p>
          <ApiKeyInput provider="groq" label="Groq [Free] Ultra-Fast" placeholder="gsk_..." />
          <ApiKeyInput provider="cerebras" label="Cerebras [Free] Ultra-Fast" placeholder="csk-..." />
          <p className="text-[10px] text-[#585858] mb-1 mt-1">
            <a href="#" onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.('https://console.groq.com/keys'); }} className="text-[#3794ff] hover:underline cursor-pointer">
              Get free Groq key → console.groq.com/keys
            </a>{' '}(1000 RPM, no credit card)
          </p>
          <div className="border-t border-[#3c3c3c] my-2" />
          <ApiKeyInput provider="google" label="Google Gemini [Free]" placeholder="AIza..." />
          <ApiKeyInput provider="nvidia" label="NVIDIA NIM [Free]" placeholder="nvapi-..." />
          <ApiKeyInput provider="cohere" label="Cohere [Free]" placeholder="trial key..." />
          <ApiKeyInput provider="mistral" label="Mistral AI [Free]" placeholder="key..." />
          <ApiKeyInput provider="huggingface" label="HuggingFace [Free]" placeholder="hf_..." />
          <ApiKeyInput provider="cloudflare" label="Cloudflare AI [Free]" placeholder="accountId:apiToken" />
          <ApiKeyInput provider="sambanova" label="SambaNova [Free]" placeholder="aaede..." />
          <ApiKeyInput provider="openrouter" label="OpenRouter [Free]" placeholder="sk-or-..." />
          <ApiKeyInput provider="apifreellm" label="APIFreeLLM [Free]" placeholder="apf_..." />
          <div className="border-t border-[#3c3c3c] my-2" />
          <ApiKeyInput provider="together" label="Together.ai" placeholder="..." />
          <ApiKeyInput provider="fireworks" label="Fireworks.ai" placeholder="..." />
          <ApiKeyInput provider="openai" label="OpenAI" placeholder="sk-..." />
          <ApiKeyInput provider="anthropic" label="Anthropic (Claude)" placeholder="sk-ant-..." />
          <ApiKeyInput provider="xai" label="xAI (Grok)" placeholder="xai-..." />

          {/* Pollinations API Key (for video generation) */}
          <div className="border-t border-[#3c3c3c] my-2" />
          <p className="text-[10px] text-[#858585] mb-2 uppercase tracking-wider flex items-center gap-1.5">
            <PlayCircle size={10} /> Video Generation
          </p>
          <PollinationsKeyInput />

          {/* License Activation */}
          <div className="border-t border-[#3c3c3c] my-2" />
          <p className="text-[10px] text-[#858585] mb-2 uppercase tracking-wider flex items-center gap-1.5">
            <Shield size={10} /> License
          </p>
          {licenseStatus?.isActivated ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-[#4ec9b0]">
                <Check size={10} /> License Active
              </div>
              {licenseStatus.license?.email && (
                <p className="text-[10px] text-[#858585]">Signed in as {licenseStatus.license.email}</p>
              )}
              {licenseStatus.license?.key && (
                <p className="text-[10px] text-[#585858] font-mono">{licenseStatus.license.key}</p>
              )}
              {licenseStatus.license?.plan && (
                <p className="text-[10px] text-[#858585]">Plan: {licenseStatus.license.plan}</p>
              )}
              <button
                onClick={async () => {
                  try {
                    await window.electronAPI?.licenseDeactivate?.();
                    setLicenseStatus({ isActivated: false });
                    setLicenseMessage('License deactivated');
                    setTimeout(() => setLicenseMessage(''), 3000);
                  } catch (e: any) {
                    setLicenseMessage(e.message || 'Deactivation failed');
                  }
                }}
                className="text-[10px] text-[#f44747] hover:text-[#ff6b6b] hover:underline cursor-pointer"
              >
                Deactivate License
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Tab selector */}
              <div className="flex border border-[#3c3c3c] rounded overflow-hidden">
                <button
                  onClick={() => setLicenseTab('signin')}
                  className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${licenseTab === 'signin' ? 'bg-[#007acc] text-white' : 'bg-[#1e1e1e] text-[#858585] hover:text-white'}`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => setLicenseTab('key')}
                  className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${licenseTab === 'key' ? 'bg-[#007acc] text-white' : 'bg-[#1e1e1e] text-[#858585] hover:text-white'}`}
                >
                  License Key
                </button>
              </div>

              {licenseTab === 'signin' ? (
                <div className="space-y-1.5">
                  <input
                    type="email"
                    value={licenseEmail}
                    onChange={(e) => setLicenseEmail(e.target.value)}
                    placeholder="Email"
                    className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2 py-1 text-[11px] text-[#cccccc] focus:border-[#007acc] outline-none"
                    spellCheck={false}
                  />
                  <input
                    type="password"
                    value={licensePassword}
                    onChange={(e) => setLicensePassword(e.target.value)}
                    placeholder="Password"
                    className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2 py-1 text-[11px] text-[#cccccc] focus:border-[#007acc] outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && licenseEmail && licensePassword && (async () => {
                      setLicenseMessage('Signing in...');
                      try {
                        const result = await window.electronAPI?.licenseActivateWithAccount?.(licenseEmail.trim(), licensePassword);
                        if (result?.success) {
                          setLicenseStatus({ isActivated: true, license: result.license });
                          setLicenseEmail('');
                          setLicensePassword('');
                          setLicenseMessage('✓ Signed in!');
                        } else {
                          setLicenseMessage(result?.error || 'Sign in failed');
                        }
                        setTimeout(() => setLicenseMessage(''), 4000);
                      } catch (e: any) {
                        setLicenseMessage(e.message || 'Sign in failed');
                        setTimeout(() => setLicenseMessage(''), 4000);
                      }
                    })()}
                  />
                  <button
                    onClick={async () => {
                      if (!licenseEmail.trim() || !licensePassword) return;
                      setLicenseMessage('Signing in...');
                      try {
                        const result = await window.electronAPI?.licenseActivateWithAccount?.(licenseEmail.trim(), licensePassword);
                        if (result?.success) {
                          setLicenseStatus({ isActivated: true, license: result.license });
                          setLicenseEmail('');
                          setLicensePassword('');
                          setLicenseMessage('✓ Signed in!');
                        } else {
                          setLicenseMessage(result?.error || 'Sign in failed');
                        }
                        setTimeout(() => setLicenseMessage(''), 4000);
                      } catch (e: any) {
                        setLicenseMessage(e.message || 'Sign in failed');
                        setTimeout(() => setLicenseMessage(''), 4000);
                      }
                    }}
                    className="w-full px-2 py-1.5 bg-[#007acc] hover:bg-[#1a8ad4] text-white text-[11px] rounded font-medium transition-colors"
                  >
                    Sign In
                  </button>
                  <p className="text-[10px] text-[#585858]">Sign in with your guIDE account to activate.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={licenseKey}
                      onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                      placeholder="GUIDE-XXXX-XXXX-XXXX-XXXX"
                      className="flex-1 bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2 py-1 text-[11px] text-[#cccccc] font-mono focus:border-[#007acc] outline-none"
                      spellCheck={false}
                    />
                    <button
                      onClick={async () => {
                        if (!licenseKey.trim()) return;
                        setLicenseMessage('Activating...');
                        try {
                          const result = await window.electronAPI?.licenseActivate?.(licenseKey.trim());
                          if (result?.success) {
                            setLicenseStatus({ isActivated: true, license: result.license });
                            setLicenseKey('');
                            setLicenseMessage('✓ Activated!');
                          } else {
                            setLicenseMessage(result?.error || 'Activation failed');
                          }
                          setTimeout(() => setLicenseMessage(''), 4000);
                        } catch (e: any) {
                          setLicenseMessage(e.message || 'Activation failed');
                          setTimeout(() => setLicenseMessage(''), 4000);
                        }
                      }}
                      className="px-2 py-1 bg-[#007acc] hover:bg-[#1a8ad4] text-white text-[10px] rounded font-medium"
                    >
                      Activate
                    </button>
                  </div>
                  <p className="text-[10px] text-[#585858]">Enter your license key to activate guIDE Pro.</p>
                </div>
              )}
            </div>
          )}
          {licenseMessage && (
            <p className={`text-[10px] mt-1 ${licenseMessage.includes('✓') || licenseMessage.includes('Active') ? 'text-[#4ec9b0]' : licenseMessage.includes('Activating') ? 'text-[#858585]' : 'text-[#f44747]'}`}>
              {licenseMessage}
            </p>
          )}
        </div>
      )}

      {/* Developer Console — verbose backend logs */}
      {showDevConsole && (
        <div className="border-b border-[#1e1e1e] bg-[#1a1a1a] flex flex-col" style={{ maxHeight: '200px', minHeight: '80px' }}>
          <div className="flex items-center justify-between px-2 py-1 border-b border-[#2b2b2b] flex-shrink-0">
            <span className="text-[10px] font-mono text-[#dcdcaa] uppercase tracking-wider">Developer Console</span>
            <div className="flex items-center gap-1">
              <button
                className="text-[10px] text-[#858585] hover:text-white px-1 rounded hover:bg-[#3c3c3c]"
                onClick={() => { setDevLogs([]); devLogsRef.current = []; }}
                title="Clear logs"
              >Clear</button>
              <button
                className="text-[10px] text-[#858585] hover:text-white px-1 rounded hover:bg-[#3c3c3c]"
                onClick={() => { setShowDevConsole(false); showDevConsoleRef.current = false; }}
              >
                <X size={10} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto font-mono text-[10px] px-2 py-1">
            {devLogs.length === 0 && (
              <div className="text-[#555] italic py-2">No logs yet. Interact with AI to see backend activity...</div>
            )}
            {devLogs.map((entry, i) => {
              const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const levelColor = entry.level === 'error' ? 'text-[#f48771]' : entry.level === 'warn' ? 'text-[#dcdcaa]' : 'text-[#858585]';
              return (
                <div key={i} className={`leading-[16px] ${levelColor} hover:bg-[#ffffff06]`}>
                  <span className="text-[#555] mr-1.5">{time}</span>
                  <span>{entry.text}</span>
                </div>
              );
            })}
            <div ref={devLogEndRef} />
          </div>
        </div>
      )}

      {/* Messages */}
      {messages.length === 0 ? (
        <div ref={chatContainerRef} className="flex-1 overflow-auto px-3 py-2 space-y-3 min-h-0">
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Sparkles size={32} className="text-[#007acc] opacity-30 mb-3" />
            <p className="text-[13px] text-[#858585] mb-1"><span className="brand-font">gu<span className="text-[#007acc]">IDE</span></span> AI Assistant</p>
            <p className="text-[11px] text-[#585858] mb-4">Local First AI Agent</p>
            <div className="space-y-1.5 w-full max-w-[260px]">
              {[
                { icon: <Bug size={12} />, label: 'Find and fix bugs' },
                { icon: <Code size={12} />, label: 'Explain this code' },
                { icon: <FileCode size={12} />, label: 'Refactor selection' },
                { icon: <Globe size={12} />, label: 'Search the web' },
              ].map((action, i) => (
                <button
                  key={i}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-[#858585] hover:text-white hover:bg-[#2a2d2e] rounded border border-[#3c3c3c] hover:border-[#007acc] transition-colors"
                  onClick={() => setInput(action.label)}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          </div>

          {/* License Status Banner */}
          {licenseStatus && !licenseStatus.isActivated && (
            <div className="mx-1 mb-2 px-3 py-2 rounded-lg border text-[11px] bg-[#007acc]/10 border-[#007acc]/30 text-[#858585]">
              <span>🔑 Cloud AI requires activation — <a href="https://graysoft.dev/account" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">Subscribe (Pro $4.99/mo)</a> or activate in Settings → License</span>
            </div>
          )}

          {/* Streaming indicator (empty state) */}
          {isGenerating && (
            <div className="bg-[#2d2d2d] rounded-lg px-3 py-2 text-[13px] text-[#cccccc] rounded-bl-sm">
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-[#007acc]" />
                <span className="text-[#858585]">
                  {generationStuck ? 'Generation may be stuck...' : 'Waiting for response...'}
                </span>
                {generationStuck && (
                  <button
                    onClick={async () => {
                      await window.electronAPI?.llmCancel?.();
                      setIsGenerating(false);
                      setStreamingText('');
                      setThinkingSegments([]);
                      setAgenticProgress(null);
                      setGenerationStuck(false);
                    }}
                    className="ml-2 px-2 py-0.5 bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded text-[10px]"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
          {/* BUG-037: CPU-only mode warning banner */}
          {isGenerating && (llmStatus as any)?.cpuFallback && (
            <div className="mx-1 mb-1 px-3 py-2 bg-[#dcdcaa15] border border-[#dcdcaa40] rounded text-[11px] text-[#dcdcaa] flex items-center gap-2">
              <AlertTriangle size={12} className="flex-shrink-0" />
              <span>CPU-only mode — inference is slow. Response may take several minutes.</span>
            </div>
          )}
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          className="flex-1 min-h-0"
          totalCount={messages.length + (isGenerating ? 1 : 0)}
          followOutput={(isAtBottom) => {
            // During generation, ALWAYS follow output unless user deliberately scrolled up.
            // This prevents the "jump" bug where expanding tool cards cause atBottom=false
            // momentarily, which would disable auto-scroll mid-generation.
            if (isGeneratingRef.current && !manualScrollUpRef.current) return 'smooth';
            // Not generating — standard behavior: follow only if at bottom
            return isAtBottom ? 'smooth' : false;
          }}
          atBottomStateChange={(atBottom) => {
            userScrolledUpRef.current = !atBottom;
          }}
          atBottomThreshold={150}
          // Detect genuine user scroll-up via wheel/touch — not content height changes
          onScroll={(e) => {
            const target = e.target as HTMLElement;
            if (!target) return;
            const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 200;
            if (!isAtBottom && isGeneratingRef.current) {
              // User is scrolling up during generation — respect their intent
              manualScrollUpRef.current = true;
            } else if (isAtBottom) {
              // User scrolled back down — re-engage auto-follow
              manualScrollUpRef.current = false;
            }
          }}
          components={{ Header: () => todos.length > 0 ? <TodoPanel todos={todos} /> : null }}
          itemContent={(index) => {
            // Last virtual item is the streaming indicator when generating
            if (index === messages.length && isGenerating) {
              return (
                <div className="px-3 py-1.5">
                  <div className="text-[13px] text-[#cccccc]">
                    {thinkingSegments.filter(s => s.trim()).length > 0 && (() => {
                      const segs = thinkingSegments.filter(s => s.trim());
                      const combined = segs.join('\n\n─── next reasoning step ───\n\n');
                      return <ThinkingBlock text={combined} isLive={true} segmentCount={segs.length} />;
                    })()}
                    {streamingText ? (
                      <div className="space-y-2">{renderStreamingContent(streamingText)}</div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin text-[#007acc]" />
                        <span className="text-[#858585]">
                          {generationStuck ? 'Generation may be stuck...' : thinkingSegments.some(s => s.trim()) ? 'Reasoning...' : 'Waiting for response...'}
                        </span>
                        {generationStuck && (
                          <button
                            onClick={async () => {
                              await window.electronAPI?.llmCancel?.();
                              setIsGenerating(false);
                              setStreamingText('');
                              setThinkingSegments([]);
                              setAgenticProgress(null);
                              setAgenticPhases([]);
                              setGenerationStuck(false);
                            }}
                            className="ml-2 px-2 py-0.5 bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded text-[10px]"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                    {agenticPhases.filter(p => p.phase !== 'generating-summary').length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {agenticPhases.filter(p => p.phase !== 'generating-summary').map((p) => (
                          <div key={p.phase} className="flex items-center gap-1.5">
                            {p.status === 'done' ? (
                              <Check size={11} className="text-[#4ec9b0] shrink-0" />
                            ) : (
                              <Loader2 size={11} className="animate-spin text-[#007acc] shrink-0" />
                            )}
                            <span className={`text-[10px] font-mono ${p.status === 'done' ? 'text-[#555]' : 'text-[#858585]'}`}>
                              {p.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {agenticProgress && agenticProgress.iteration > 1 && (
                      <div className="mt-1 text-[10px] text-[#555] text-right">
                        Step {agenticProgress.iteration}
                      </div>
                    )}
                    {imageGenProgress && (
                      <div className="mt-2">
                        <div className="text-[11px] text-[#858585] mb-1 flex items-center gap-2">
                          <ImageIcon size={11} className="text-[#c586c0]" />
                          Generating image… step {imageGenProgress.current}/{imageGenProgress.total}
                        </div>
                        <div className="h-1 bg-[#3c3c3c] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#c586c0] rounded-full transition-all duration-300"
                            style={{ width: `${Math.round((imageGenProgress.current / imageGenProgress.total) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {(completedStreamingTools.length > 0 || executingTools.length > 0) && (
                      <div className="mt-2">
                        <ToolCallGroup count={completedStreamingTools.length + executingTools.length}>
                          {completedStreamingTools.map((toolData, i) => (
                            <CollapsibleToolBlock key={`done-${i}`} label={getToolLabel(toolData, 'ok')} icon="✓">
                              <div className="text-[11px] text-[#858585]">Completed</div>
                            </CollapsibleToolBlock>
                          ))}
                          {executingTools.map((toolData, i) => {
                            const isCodeWriteTool = ['write_file', 'create_file', 'edit_file', 'append_to_file'].includes(toolData.tool);
                            const codeContent = toolData.params?.content as string | undefined;
                            const filePath = ((toolData.params?.filePath || toolData.params?.fileName || '') as string);
                            const ext = filePath.includes('.') ? filePath.split('.').pop()?.toLowerCase() || '' : '';
                            const langMap: Record<string, string> = {
                              ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
                              py: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
                              cpp: 'cpp', c: 'c', html: 'html', css: 'css', json: 'json',
                              yaml: 'yaml', yml: 'yaml', md: 'markdown', sh: 'bash',
                              bat: 'batch', txt: 'text', xml: 'xml', sql: 'sql',
                            };
                            const language = langMap[ext] || ext || 'code';
                            return (
                              <CollapsibleToolBlock key={`exec-${i}`} label={getToolLabel(toolData, 'running')} icon="⟳">
                                <div>
                                  <div className="flex items-center gap-2 mb-2">
                                    <Loader2 size={12} className="animate-spin text-[#007acc]" />
                                    <span className="text-[11px] text-[#858585]">Executing...</span>
                                  </div>
                                  {isCodeWriteTool && codeContent ? (
                                    <CodeBlock
                                      code={codeContent}
                                      language={language}
                                      onApply={() => {}}
                                      isToolCall={true}
                                    />
                                  ) : toolData.params && Object.keys(toolData.params).length > 0 ? (
                                    <>
                                      <div className="text-[10px] text-[#858585] mb-1 font-medium tracking-wide">PARAMETERS</div>
                                      <pre className="whitespace-pre-wrap text-[11px] font-mono text-[#d4d4d4] bg-[#1e1e1e] rounded-md p-2">{JSON.stringify(toolData.params, null, 2)}</pre>
                                    </>
                                  ) : null}
                                </div>
                              </CollapsibleToolBlock>
                            );
                          })}
                        </ToolCallGroup>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            const msg = messages[index];
            if (!msg) return null;
            return (
              <React.Fragment>
              <div className={`px-3 py-1.5 ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
                <div
                  className={`text-[13px] leading-relaxed overflow-hidden break-words ${
                    msg.role === 'user'
                      ? 'max-w-[85%] text-white rounded-lg rounded-br-sm px-3 py-2'
                      : msg.role === 'system' && msg.isError
                      ? 'w-full bg-[#2d1f1f] text-[#e8a09a] border border-[#6b2e2e] rounded-lg px-3 py-2.5'
                      : msg.role === 'system'
                      ? 'w-full bg-[#1e1e1e] text-[#858585] border border-[#3c3c3c] text-center rounded-lg px-3 py-2'
                      : 'w-full text-[#cccccc] py-1'
                  }`}
                  style={msg.role === 'user' ? { backgroundColor: 'var(--theme-chat-bubble)' } : undefined}
                >
                  {msg.role === 'assistant' && msg.thinkingText && (() => {
                    const segments = msg.thinkingText.includes('\n\n---THINKING_SEGMENT---\n\n')
                      ? msg.thinkingText.split('\n\n---THINKING_SEGMENT---\n\n').filter((s: string) => s.trim())
                      : [msg.thinkingText];
                    const combined = segments.join('\n\n─── next reasoning step ───\n\n');
                    return <ThinkingBlock text={combined} segmentCount={segments.length} />;
                  })()}
                  {msg.role === 'assistant' ? (
                    msg.isQuotaMessage ? (
                      <div className="space-y-3">
                        <div className="text-[13px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                          <span style={{ color: 'var(--theme-foreground)', fontWeight: 500 }}>Daily limit reached</span>
                          {' \u2014 You\'ve used your 20 free Guide Cloud AI messages for today.'}
                        </div>
                        <div className="flex flex-col gap-2">
                          {licenseStatus?.email ? (
                            // User is signed in but hit quota — show upgrade CTA, not sign-in
                            <button
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-all w-full"
                              style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }}
                              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-accent)'}
                              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-border)'}
                              onClick={() => window.electronAPI?.openExternal?.('https://graysoft.dev/account')}
                            >
                              <span style={{ fontSize: 13 }}>⬆</span>
                              <span>Upgrade your plan — graysoft.dev/account</span>
                            </button>
                          ) : (
                            // User is not signed in — show Google sign-in
                            <button
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-all w-full"
                              style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }}
                              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-accent)'}
                              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-border)'}
                              onClick={async () => {
                                try {
                                  const res = await window.electronAPI?.licenseOAuthSignIn?.('google');
                                  if (res?.success || (res as any)?.authenticated) {
                                    const status = await window.electronAPI?.licenseGetStatus?.();
                                    if (status) setLicenseStatus(status);
                                    setMessages(prev => prev.filter(m => !m.isQuotaMessage));
                                  }
                                } catch {}
                              }}
                            >
                              <svg viewBox="0 0 18 18" width="14" height="14" style={{ flexShrink: 0 }}>
                                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                                <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
                                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/>
                              </svg>
                              <span>Sign in with Google — get more free messages</span>
                            </button>
                          )}
                          <div className="text-[11px] text-center" style={{ color: 'var(--theme-foreground-muted)' }}>
                            Or{' '}
                            <button
                              className="underline cursor-pointer"
                              style={{ color: 'var(--theme-accent)', background: 'none', border: 'none', padding: 0, font: 'inherit' }}
                              onClick={() => window.dispatchEvent(new CustomEvent('app-action', { detail: { action: 'open-settings' } }))}
                            >
                              add a local model
                            </button>
                            {' '}for unlimited offline use — quota resets midnight.
                          </div>
                        </div>
                      </div>
                    ) : (
                    <div className="space-y-1">{renderMessage(msg)}</div>
                    )
                  ) : (
                    <>
                      {msg.images && msg.images.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {msg.images.map((img, i) => (
                            <img
                              key={i}
                              src={img.data}
                              alt={img.name}
                              className={`max-h-[120px] max-w-[200px] rounded border border-white/20 object-contain ${onOpenFile ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                              title={onOpenFile ? 'Click to open in viewport' : img.name}
                              onClick={async () => {
                                if (!onOpenFile) return;
                                try {
                                  const api = window.electronAPI as any;
                                  if (api?.imageSaveToProject) {
                                    // img.data is a data URL — strip the header to get base64
                                    const base64 = img.data.includes(',') ? img.data.split(',')[1] : img.data;
                                    const result = await api.imageSaveToProject(base64, img.mimeType, img.name);
                                    if (result?.success && result.filePath) {
                                      onOpenFile(result.filePath);
                                    }
                                  }
                                } catch { /* ignore */ }
                              }}
                            />
                          ))}
                        </div>
                      )}
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </>
                  )}
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-[#3c3c3c]">
                      {msg.model && <span className="text-[10px] text-[#858585]">{msg.model}</span>}
                      {msg.webSearchUsed && <Globe size={10} className="text-[#007acc]" />}
                      {msg.ragUsed && <Brain size={10} className="text-[#89d185]" />}
                    </div>
                  )}
                </div>
              </div>
              {msg.role === 'assistant' && msg.checkpointId && checkpoints.has(msg.checkpointId) && (
                <CheckpointDivider
                  checkpoint={checkpoints.get(msg.checkpointId)!}
                  isRestoring={restoringCheckpoint === msg.checkpointId}
                  onRestore={async () => {
                    const cpId = msg.checkpointId!;
                    setRestoringCheckpoint(cpId);
                    const result = await window.electronAPI?.checkpointRestore?.(cpId);
                    setRestoringCheckpoint(null);
                    if (result?.success) {
                      toast(`Restored ${result.restoredCount} file${result.restoredCount !== 1 ? 's' : ''}`, 'success');
                      setCheckpoints(prev => {
                        const next = new Map(prev);
                        // Remove this checkpoint and all later ones
                        let found = false;
                        for (const [id] of next) { if (id === cpId) found = true; if (found) next.delete(id); }
                        return next;
                      });
                      setMessages(prev => prev.map(m => m.checkpointId && m.checkpointId >= cpId ? { ...m, checkpointId: undefined } : m));
                    } else {
                      toast(`Restore failed: ${result?.error || 'unknown'}`, 'error');
                    }
                  }}
                />
              )}
              </React.Fragment>
            );
          }}
        />
      )}

      {/* Context indicator */}
      {(currentFile || selectedText) && (
        <div className="px-3 py-1 border-t border-[#1e1e1e] flex items-center gap-2 flex-shrink-0">
          {currentFile && (
            <span className="text-[10px] text-[#858585] bg-[#3c3c3c] px-1.5 py-0.5 rounded truncate max-w-[200px] inline-flex items-center gap-1 group">
              {currentFile.split(/[/\\]/).pop()}
              {onClearCurrentFile && (
                <button
                  className="text-[#858585] hover:text-[#f44747] text-[10px] opacity-0 group-hover:opacity-100 transition-opacity leading-none"
                  onClick={onClearCurrentFile}
                  title="Remove file context"
                >✕</button>
              )}
            </span>
          )}
          {selectedText && (
            <span className="text-[10px] text-[#858585] bg-[#3c3c3c] px-1.5 py-0.5 rounded">
              Selection ({selectedText.length} chars)
            </span>
          )}
        </div>
      )}

      {/* Pending file changes — Keep / Undo bar */}
      {pendingFileChanges.length > 0 && (
        <div className="px-3 py-1.5 border-t border-[#1e1e1e] flex-shrink-0 bg-[#2d2d30]">
          <div className="flex items-center gap-2 mb-1">
            <button
              className="flex items-center gap-1.5 text-[10px] text-[#dcdcaa] font-semibold hover:text-white"
              onClick={() => setFileChangesExpanded(!fileChangesExpanded)}
              title={fileChangesExpanded ? 'Collapse file list' : 'Expand file list'}
            >
              <span style={{ display: 'inline-block', transform: fileChangesExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', fontSize: '8px' }}>▶</span>
              {pendingFileChanges.length} file{pendingFileChanges.length > 1 ? 's' : ''} changed
              {(() => {
                const totalAdded = pendingFileChanges.reduce((sum, f) => sum + (f.linesAdded || 0), 0);
                const totalRemoved = pendingFileChanges.reduce((sum, f) => sum + (f.linesRemoved || 0), 0);
                return (totalAdded > 0 || totalRemoved > 0) ? (
                  <span className="ml-1">
                    {totalAdded > 0 && <span className="text-[#89d185]">+{totalAdded}</span>}
                    {totalAdded > 0 && totalRemoved > 0 && <span className="text-[#858585] mx-0.5">/</span>}
                    {totalRemoved > 0 && <span className="text-[#f44747]">-{totalRemoved}</span>}
                  </span>
                ) : null;
              })()}
            </button>
            <div className="flex-1" />
            <button
              className="text-[10px] px-2 py-0.5 rounded bg-[#89d185] text-[#1e1e1e] hover:bg-[#7bc275] font-medium"
              onClick={async () => {
                await window.electronAPI?.fileAcceptChanges?.();
                setPendingFileChanges([]);
              }}
              title="Accept all changes"
            >
              Keep
            </button>
            <button
              className="text-[10px] px-2 py-0.5 rounded bg-[#f44747] text-white hover:bg-[#d43c3c] font-medium"
              onClick={async () => {
                await window.electronAPI?.fileUndoAll?.();
                setPendingFileChanges([]);
              }}
              title="Undo all changes"
            >
              Undo
            </button>
          </div>
          {fileChangesExpanded && (
            <div className="space-y-0.5 max-h-[120px] overflow-y-auto">
              {pendingFileChanges.map((f) => (
                <div key={f.filePath} className="flex items-center gap-1.5 text-[10px] text-[#cccccc]">
                  <span className={`${f.isNew ? 'text-[#89d185]' : 'text-[#dcdcaa]'} w-3 text-center`}>
                    {f.isNew ? '+' : '~'}
                  </span>
                  <span className="truncate flex-1 cursor-pointer hover:underline hover:text-[#4fc1ff]" title={`Click to open ${f.filePath}`} onClick={() => onOpenFile?.(f.filePath)}>{f.fileName}</span>
                  {((f.linesAdded || 0) > 0 || (f.linesRemoved || 0) > 0) && (
                    <span className="text-[9px] font-mono whitespace-nowrap">
                      {(f.linesAdded || 0) > 0 && <span className="text-[#89d185]">+{f.linesAdded}</span>}
                      {(f.linesAdded || 0) > 0 && (f.linesRemoved || 0) > 0 && <span className="text-[#858585] mx-0.5">/</span>}
                      {(f.linesRemoved || 0) > 0 && <span className="text-[#f44747]">-{f.linesRemoved}</span>}
                    </span>
                  )}
                  <button
                    className="text-[#858585] hover:text-[#89d185] px-1"
                    onClick={async () => {
                      await window.electronAPI?.fileAcceptChanges?.([f.filePath]);
                      refreshPendingChanges();
                    }}
                    title="Keep this change"
                  ><Check size={11} /></button>
                  <button
                    className="text-[#858585] hover:text-[#f44747] px-1"
                    onClick={async () => {
                      await window.electronAPI?.fileUndo?.(f.filePath);
                      refreshPendingChanges();
                    }}
                    title="Undo this change"
                  ><X size={11} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 border-t border-[#1e1e1e] flex-shrink-0">
        {/* Hidden file input for image selection */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files) handleImageFiles(e.target.files); e.target.value = ''; }}
        />
        {/* Unified input container */}
        <div
          className="rounded-lg border focus-within:border-[var(--theme-accent)] transition-colors"
          style={{ backgroundColor: 'var(--theme-input-bg)', borderColor: 'var(--theme-input-border)' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {/* Attached image previews — inside the container */}
          {attachedImages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
              {attachedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img.data}
                    alt={img.name}
                    className="h-[40px] w-[40px] object-cover rounded border border-[#555]"
                  />
                  <button
                    className="absolute -top-1 -right-1 bg-[#f44747] text-white rounded-full w-3.5 h-3.5 flex items-center justify-center text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeAttachedImage(i)}
                    title="Remove"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
          {/* Attached file context previews */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
              {attachedFiles.map((file, i) => (
                <div key={i} className="relative group flex items-center gap-1 rounded px-2 py-1 border border-[#555]" style={{ backgroundColor: 'var(--theme-input-bg)' }}>
                  <span className="text-[11px] text-[#cccccc] max-w-[120px] truncate">{file.name}</span>
                  <button
                    className="text-[#858585] hover:text-[#f44747] text-[10px] ml-0.5"
                    onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                    title="Remove"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
          {/* Queued messages display */}
          {messageQueue.length > 0 && (
            <div className="px-2.5 pt-1.5 flex flex-col gap-1">
              {messageQueue.map((qMsg, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] group" style={{ backgroundColor: 'var(--theme-input-bg)' }}>
                  <Clock size={10} className="text-[#dcdcaa] flex-shrink-0" />
                  <span className="text-[#858585] flex-shrink-0">#{i + 1}</span>
                  {editingQueueIndex === i ? (
                    <input
                      className="flex-1 bg-[#1e1e1e] text-[#cccccc] text-[11px] px-1.5 py-0.5 rounded outline-none border border-[#007acc]"
                      value={editingQueueText}
                      onChange={e => setEditingQueueText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const updated = [...messageQueue];
                          updated[i] = editingQueueText.trim() || updated[i];
                          messageQueueRef.current = updated;
                          setMessageQueue(updated);
                          setEditingQueueIndex(null);
                        } else if (e.key === 'Escape') {
                          setEditingQueueIndex(null);
                        }
                      }}
                      onBlur={() => {
                        const updated = [...messageQueue];
                        updated[i] = editingQueueText.trim() || updated[i];
                        messageQueueRef.current = updated;
                        setMessageQueue(updated);
                        setEditingQueueIndex(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="flex-1 text-[#cccccc] truncate cursor-pointer hover:text-white"
                      onClick={() => { setEditingQueueIndex(i); setEditingQueueText(qMsg); }}
                      title="Click to edit"
                    >{qMsg}</span>
                  )}
                  <button
                    className="text-[#858585] hover:text-[#007acc] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={() => {
                      // Force-send: interrupt current generation and send this queued message immediately
                      const msg = messageQueue[i];
                      const updated = messageQueue.filter((_, idx) => idx !== i);
                      messageQueueRef.current = updated;
                      setMessageQueue(updated);
                      if (editingQueueIndex === i) setEditingQueueIndex(null);
                      // Stop current generation and send immediately
                      window.electronAPI?.llmCancel?.();
                      setTimeout(() => sendMessageDirect(msg), 500);
                    }}
                    title="Force send now (interrupts current response)"
                  >
                    <Zap size={10} />
                  </button>
                  <button
                    className="text-[#858585] hover:text-[#f44747] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={() => {
                      const updated = messageQueue.filter((_, idx) => idx !== i);
                      messageQueueRef.current = updated;
                      setMessageQueue(updated);
                      if (editingQueueIndex === i) setEditingQueueIndex(null);
                    }}
                    title="Remove from queue"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Image mode indicator — shown when an image model is active */}
          {activeImageModel && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[#3c3c3c] bg-[#1e1e1e]">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 text-[#c586c0]">
                <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="5.5" cy="6.5" r="1" fill="currentColor"/>
                <path d="M1.5 12L5 8.5l2.5 2.5 2.5-2.5L14.5 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-[11px] text-[#c586c0] font-medium truncate min-w-0 flex-1">
                Image mode &mdash; {activeImageModel.name}
              </span>
              <button
                className="flex-shrink-0 text-[#555] hover:text-[#cccccc] transition-colors"
                onClick={() => setActiveImageModel(null)}
                title="Exit image mode"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {/* Textarea */}
          <textarea
            ref={inputRef}
            className="w-full bg-transparent text-[#cccccc] text-[13px] px-3 py-2 outline-none resize-none placeholder-[#6e6e6e]"
            placeholder={isGenerating ? (messageQueue.length > 0 ? `${messageQueue.length} queued -- type to add more...` : 'Type to queue a message...') : 'Ask anything (Ctrl+L)'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label="Chat message input"
            style={{ height: '32px', overflowY: 'hidden' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              if (!target.value) {
                target.style.height = '32px';
                target.style.overflowY = 'hidden';
              } else {
                target.style.height = '32px';
                const scrollH = target.scrollHeight;
                const maxH = 200; // Allow taller input for long messages
                target.style.height = Math.min(scrollH, maxH) + 'px';
                // Enable scrolling once content exceeds max height
                target.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
              }
            }}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (items) {
                const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
                if (imageItems.length > 0) {
                  e.preventDefault();
                  const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
                  handleImageFiles(files);
                }
              }
            }}
          />
          {/* Bottom toolbar row — icons left, send right */}
          <div className="flex items-center justify-between px-2 pb-1.5 min-w-0 gap-1 overflow-hidden">
            <div className="flex items-center gap-0.5 min-w-0 overflow-hidden flex-shrink flex-nowrap">
              <button
                className="p-1 rounded text-[#858585] hover:text-white hover:bg-[#4c4c4c] transition-colors"
                onClick={() => fileInputRef.current?.click()}
                title="Attach image"
              >
                <Paperclip size={14} />
              </button>
              {/* AI Improve button removed */}
              <button
                className={`p-1 rounded transition-colors ${
                  isListening
                    ? 'text-[#f44747]'
                    : isTranscribing
                      ? 'text-[#dcdcaa] animate-pulse cursor-wait'
                      : 'text-[#858585] hover:text-white hover:bg-[#4c4c4c]'
                }`}
                onClick={toggleListening}
                disabled={isTranscribing}
                title={isListening ? 'Stop & transcribe' : isTranscribing ? 'Transcribing...' : 'Voice input'}
                aria-label={isListening ? 'Stop recording' : 'Voice input'}
              >
                {isTranscribing ? <Loader2 size={14} className="animate-spin" /> : isListening ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
              {/* Audio wave animation when recording */}
              <AudioWaveAnimation isActive={isListening} />
              {/* Separator */}
              <div className="w-px h-4 bg-[#555] mx-0.5" />
              {/* Auto Mode toggle — inline */}
              <button
                className={`flex items-center gap-0.5 text-[11px] px-1 py-0.5 rounded transition-colors ${
                  autoMode
                    ? 'bg-[#007acc] text-white hover:bg-[#006bb3]'
                    : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#4c4c4c]'
                }`}
                onClick={() => setAutoMode(!autoMode)}
                title={autoMode ? 'Auto Mode ON — guIDE picks the best model per task' : 'Auto Mode OFF — Click to enable'}
                aria-label={autoMode ? 'Disable auto mode' : 'Enable auto mode'}
                aria-pressed={autoMode}
              >
                <Zap size={10} className={autoMode ? 'text-[#ffd700]' : ''} />
                <span className="hidden sm:inline">Auto</span>
              </button>
              {/* Plan Mode toggle — inline */}
              <button
                className={`flex items-center gap-0.5 text-[11px] px-1 py-0.5 rounded transition-colors ${
                  planMode
                    ? 'bg-[#c586c0] text-white hover:bg-[#b070a0]'
                    : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#4c4c4c]'
                }`}
                onClick={() => setPlanMode(!planMode)}
                title={planMode ? 'Plan Mode ON — AI creates a plan before executing' : 'Plan Mode OFF — AI executes directly'}
                aria-label={planMode ? 'Disable plan mode' : 'Enable plan mode'}
                aria-pressed={planMode}
              >
                <FileCode size={10} className={planMode ? 'text-white' : ''} />
                <span className="hidden sm:inline">Plan</span>
              </button>
              {/* Model picker — inline */}
              <button
                className="flex items-center gap-1 text-[11px] text-[#858585] hover:text-[#cccccc] px-1 py-0.5 rounded hover:bg-[#4c4c4c] transition-colors chat-dropdown-panel max-w-[120px]"
                onClick={() => setShowModelPicker(!showModelPicker)}
                title="Change model"
                aria-label="Change model"
                aria-expanded={showModelPicker}
              >
                {autoMode ? (
                  <Zap size={10} className="text-[#ffd700] flex-shrink-0" />
                ) : isUsingCloud ? <Cloud size={10} className="text-[#3794ff] flex-shrink-0" /> : <Cpu size={10} className="flex-shrink-0" />}
                {!autoMode && (
                  <span className="truncate">
                    {isUsingCloud
                      ? (['cerebras', 'groq', 'sambanova', 'google', 'openrouter'].includes(cloudProvider || '')
                        ? 'guIDE Cloud AI'
                        : (cloudProviders.find(p => p.provider === cloudProvider)?.models.find(m => m.id === cloudModel)?.name || cloudModel || '').split(' ')[0])
                      : llmStatus.state === 'ready'
                      ? (llmStatus.modelInfo?.name || 'Model').split('-').slice(0, 2).join('-')
                      : llmStatus.state === 'loading'
                      ? 'Loading...'
                      : 'No model'
                    }
                  </span>
                )}
                <ChevronDown size={8} className="flex-shrink-0" />
              </button>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Queue counter badge */}
              {messageQueue.length > 0 && (
                <div className="flex items-center gap-0.5 text-[10px] text-[#dcdcaa] bg-[#2d2d2d] px-1.5 py-0.5 rounded"
                     title={`${messageQueue.length} message${messageQueue.length > 1 ? 's' : ''} queued`}>
                  <Clock size={9} />
                  <span>{messageQueue.length}</span>
                </div>
              )}
              {isGenerating && (
                <button
                  className="p-1 bg-[#f44747] text-white rounded-md hover:bg-[#d43c3c] transition-colors"
                  onClick={() => {
                    messageQueueRef.current = [];
                    setMessageQueue([]);
                    cancelGeneration();
                  }}
                  title="Stop generating and clear queue"
                  aria-label="Stop generating"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              )}
              <button
                className={`p-1 rounded-md transition-colors ${
                  isGenerating
                    ? 'bg-[#dcdcaa] text-[#1e1e1e] hover:bg-[#e8e8b0]'
                    : 'bg-[#007acc] text-white hover:bg-[#006bb3] disabled:opacity-30 disabled:bg-[#555]'
                }`}
                onClick={sendMessage}
                disabled={!input.trim() && attachedImages.length === 0 && attachedFiles.length === 0}
                title={isGenerating ? 'Queue message (Enter)' : 'Send (Enter)'}
                aria-label={isGenerating ? 'Queue message' : 'Send message'}
              >
                {isGenerating ? <Clock size={14} /> : <ArrowUp size={14} strokeWidth={2.5} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Components ApiKeyInput, MermaidDiagram, CollapsibleToolBlock, CodeBlock
// are now imported from './ChatWidgets'
