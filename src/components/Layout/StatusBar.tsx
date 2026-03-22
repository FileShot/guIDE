import React, { useState, useEffect, useRef } from 'react';
import {
  GitBranch, AlertCircle, CheckCircle, Loader2, Terminal, Bell, Zap,
} from 'lucide-react';
import { VoiceCommandButton } from '../VoiceCommand/VoiceCommandButton';
import type { LLMStatusEvent, GPUInfo } from '@/types/electron';

interface StatusBarProps {
  cursorPosition: { line: number; column: number };
  language: string;
  llmStatus: LLMStatusEvent;
  ragStatus: { isIndexing: boolean; progress: number; totalFiles: number };
  currentFile: string;
  onToggleTerminal: () => void;
  onShowProblems?: () => void;
  onAction?: (action: string) => void;
  onChatMessage?: (message: string) => void;
  errorCount?: number;
  warningCount?: number;
}

// Circular progress ring SVG (reusable)
const ProgressRing: React.FC<{ percent: number; color?: string; size?: number; strokeWidth?: number }> = ({
  percent, color, size = 14, strokeWidth = 2,
}) => {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(percent, 100) / 100);
  const autoColor = color || (percent > 85 ? '#f48771' : percent > 60 ? '#dcdcaa' : '#89d185');
  const cx = size / 2, cy = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#3c3c3c" strokeWidth={strokeWidth} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={autoColor} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} className="transition-all duration-500" />
    </svg>
  );
};

// Legacy alias
const ContextRing: React.FC<{ used: number; total: number }> = ({ used, total }) => {
  const pct = total > 0 ? Math.min(used / total, 1) * 100 : 0;
  return <ProgressRing percent={pct} />;
};

export const StatusBar: React.FC<StatusBarProps> = ({
  cursorPosition,
  language,
  llmStatus,
  ragStatus,
  currentFile: _currentFile,
  onToggleTerminal,
  onShowProblems,
  onAction,
  onChatMessage,
  errorCount = 0,
  warningCount = 0,
}) => {
  const [contextUsage, setContextUsage] = useState({ used: 0, total: 0 });
  const [tokensPerSec, setTokensPerSec] = useState(0);
  const [systemResources, setSystemResources] = useState<{ cpu: number; ram: { used: number; total: number; percent: number } } | null>(null);
  const [gpuInfo, setGpuInfo] = useState<GPUInfo | null>(null);
  const tokenCountRef = useRef(0);
  const tokenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickRef = useRef(Date.now());
  const resourceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Listen for context usage updates from main process
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const handler = (data: { used: number; total: number }) => {
      setContextUsage(data);
    };
    const cleanup = api.onContextUsage?.(handler);

    return () => { cleanup?.(); };
  }, []);

  // Measure tokens/sec from streaming (including tool call generation)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const tokenHandler = (_token: string) => {
      tokenCountRef.current++;
    };

    // Track tool call params as token activity (just 1 token per event to show the model is active)
    const toolGeneratingHandler = (_data: { paramsText?: string }) => {
      tokenCountRef.current++;
    };

    // Secondary listener just for speed measurement
    const cleanupToken = api.onLlmToken?.(tokenHandler);
    const cleanupTool = api.onLlmToolGenerating?.(toolGeneratingHandler);

    // Sample every second
    tokenTimerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTickRef.current) / 1000;
      if (elapsed > 0 && tokenCountRef.current > 0) {
        setTokensPerSec(Math.round(tokenCountRef.current / elapsed));
      } else {
        setTokensPerSec(0);
      }
      tokenCountRef.current = 0;
      lastTickRef.current = now;
    }, 1000);

    return () => {
      if (tokenTimerRef.current) clearInterval(tokenTimerRef.current);
      if (typeof cleanupToken === 'function') cleanupToken();
      if (typeof cleanupTool === 'function') cleanupTool();
    };
  }, []);

  // Poll system resources every 3 seconds
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getSystemResources) return;

    const poll = async () => {
      try {
        const res = await api.getSystemResources!();
        setSystemResources(res);
      } catch { /* ignore */ }
    };

    poll(); // initial read
    resourceTimerRef.current = setInterval(poll, 3000);

    return () => {
      if (resourceTimerRef.current) clearInterval(resourceTimerRef.current);
    };
  }, []);

  // Poll GPU info every 5 seconds
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.gpuGetInfo) return;

    const gpuTimerRef = { current: null as ReturnType<typeof setInterval> | null };

    const pollGPU = async () => {
      try {
        const res = await api.gpuGetInfo();
        if (res?.success && res.gpu) {
          setGpuInfo(res.gpu);
        }
      } catch { /* ignore */ }
    };

    pollGPU(); // initial read
    gpuTimerRef.current = setInterval(pollGPU, 5000);

    return () => {
      if (gpuTimerRef.current) clearInterval(gpuTimerRef.current);
    };
  }, []);

  const getStatusIcon = () => {
    switch (llmStatus.state) {
      case 'ready': return <CheckCircle size={12} className="text-[#89d185]" />;
      case 'loading': return <Loader2 size={12} className="text-[#dcdcaa] animate-spin" />;
      case 'error': return <AlertCircle size={12} className="text-[#f48771]" />;
    }
  };

  const getStatusText = () => {
    switch (llmStatus.state) {
      case 'ready': {
        const info = llmStatus.modelInfo;
        if (info) {
          const ctx = info.contextSize ? `${Math.round(info.contextSize / 1024)}K` : '';
          const gpu = info.gpuLayers ? `${info.gpuLayers}L` : '';
          const parts = [info.name || 'AI Ready'];
          if (ctx) parts.push(ctx);
          if (gpu) parts.push(`GPU:${gpu}`);
          if ((llmStatus as any).cpuFallback) parts.push('[!] CPU');
          if ((llmStatus as any).thinkingWarning) parts.push('[!] Slow (thinking)');
          return parts.join(' • ');
        }
        return 'AI Ready';
      }
      case 'loading': return llmStatus.message || 'Loading...';
      case 'error': return 'AI Offline';
    }
  };

  const ctxPct = contextUsage.total > 0 ? Math.round((contextUsage.used / contextUsage.total) * 100) : 0;

  return (
    <div className="h-[20px] flex items-center justify-between px-1.5 text-[10px] select-none flex-shrink-0 overflow-hidden" style={{ backgroundColor: 'var(--theme-status-bar)', borderTop: '1px solid var(--theme-border)', color: 'var(--theme-status-bar-fg)' }}>
      {/* Left — git branch + errors/warnings */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <div className="flex items-center gap-1 cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded">
          <GitBranch size={10} />
          <span>main</span>
        </div>
        <div
          className="flex items-center gap-1 cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded"
          onClick={() => onShowProblems?.()}
          title="Show Problems panel"
        >
          <AlertCircle size={10} className={errorCount > 0 ? 'text-[#f48771]' : ''} />
          <span className={errorCount > 0 ? 'text-[#f48771]' : ''}>{errorCount}</span>
          <span className="mx-0.5" style={{ color: warningCount > 0 ? '#dcdcaa' : undefined }}>W</span>
          <span style={{ color: warningCount > 0 ? '#dcdcaa' : undefined }}>{warningCount}</span>
        </div>
      </div>

      {/* Right — tok/s, context%, GPU, cursor, language, AI status */}
      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden flex-nowrap">
        {/* RAG indexing */}
        {ragStatus.isIndexing && (
          <div className="flex items-center gap-1 animate-pulse text-[#dcdcaa]">
            <Loader2 size={10} className="animate-spin" />
            <span>Indexing {ragStatus.progress}%</span>
          </div>
        )}

        {/* Tokens/sec */}
        {tokensPerSec > 0 && (
          <div className="flex items-center gap-1 cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded" title="Generation speed">
            <Zap size={10} />
            <span>{tokensPerSec} tok/s</span>
          </div>
        )}

        {/* Context usage % (no ring, just number like concept) */}
        {contextUsage.total > 0 && (
          <div className="flex items-center gap-1 cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded"
               title={`Context: ${contextUsage.used.toLocaleString()} / ${contextUsage.total.toLocaleString()} tokens (${ctxPct}%)`}>
            <ContextRing used={contextUsage.used} total={contextUsage.total} />
            <span>{ctxPct}%</span>
          </div>
        )}

        {/* GPU memory inline (concept: "GPU 6.2/8.0G") */}
        {gpuInfo && (
          <div className="flex items-center gap-1 cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded flex-shrink-0"
               title={`${gpuInfo.name || 'GPU'}${gpuInfo.vramUsedGB != null && gpuInfo.vramTotalGB != null ? `\nVRAM: ${gpuInfo.vramUsedGB}/${gpuInfo.vramTotalGB} GB (${gpuInfo.vramUsagePercent ?? 0}%)` : ''}${gpuInfo.utilizationPercent != null ? `\nGPU Util: ${gpuInfo.utilizationPercent}%` : ''}${gpuInfo.temperatureC != null ? ` • Temp: ${gpuInfo.temperatureC}°C` : ''}\nCPU: ${systemResources?.cpu || 0}% • RAM: ${systemResources?.ram?.percent || 0}%${gpuInfo.gpuLayers != null ? `\nLayers: ${gpuInfo.gpuLayers}` : ''}${gpuInfo.backend ? ` (${gpuInfo.backend})` : ''}`}>
            {gpuInfo.vramUsedGB != null && gpuInfo.vramTotalGB != null ? (
              <span>GPU {gpuInfo.vramUsedGB}/{gpuInfo.vramTotalGB}G</span>
            ) : (
              <span>{gpuInfo.isActive ? 'GPU' : 'CPU'}</span>
            )}
          </div>
        )}

        {/* System resources fallback when no GPU */}
        {!gpuInfo && systemResources && (
          <div className="flex items-center gap-1 cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded flex-shrink-0"
               title={`CPU: ${systemResources.cpu}% • RAM: ${systemResources.ram?.percent}%`}>
            <span>CPU:{systemResources.cpu}% RAM:{systemResources.ram?.percent}%</span>
          </div>
        )}

        {/* Separator */}
        <div className="w-px h-2.5 flex-shrink-0" style={{ backgroundColor: 'rgba(0,0,0,0.2)' }} />

        {/* Cursor position */}
        <div className="cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded flex-shrink-0 whitespace-nowrap">
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </div>

        {/* Language */}
        <div className="cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded capitalize flex-shrink-0">
          {language}
        </div>

        {/* Separator */}
        <div className="w-px h-2.5 flex-shrink-0" style={{ backgroundColor: 'rgba(0,0,0,0.2)' }} />

        {/* AI status — compact like concept */}
        <div className="flex items-center gap-1 cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded min-w-0 flex-shrink-0"
             title={llmStatus.modelInfo ? `${llmStatus.modelInfo.name}\nContext: ${llmStatus.modelInfo.contextSize || '?'} tokens\nGPU Layers: ${llmStatus.modelInfo.gpuLayers || '?'}\nBackend: ${llmStatus.modelInfo.gpuBackend || '?'}${llmStatus.modelInfo.flashAttention ? '\nFlash Attention: ON' : ''}` : llmStatus.message}>
          {getStatusIcon()}
          <span>{llmStatus.state === 'ready' ? (llmStatus.modelInfo?.name ? llmStatus.modelInfo.name : 'AI Ready') : getStatusText()}</span>
          {llmStatus.state === 'loading' && typeof llmStatus.progress === 'number' && llmStatus.progress > 0 && (
            <div className="w-[60px] h-[3px] bg-[#3c3c3c] rounded-full overflow-hidden flex-shrink-0">
              <div className="h-full bg-[#dcdcaa] rounded-full transition-all duration-300" style={{ width: `${Math.round(llmStatus.progress * 100)}%` }} />
            </div>
          )}
        </div>

        {/* Voice Command — kept for functionality */}
        {onAction && (
          <VoiceCommandButton onAction={onAction} onChatMessage={onChatMessage} />
        )}

        {/* Terminal toggle */}
        <button
          className="flex items-center gap-1 hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded flex-shrink-0"
          onClick={onToggleTerminal}
          title="Toggle Terminal"
        >
          <Terminal size={10} />
        </button>

        {/* Notifications */}
        <div className="cursor-pointer hover:bg-[rgba(0,0,0,0.15)] px-0.5 rounded flex-shrink-0">
          <Bell size={10} />
        </div>

        {/* Credit */}
        <div className="text-[10px] pl-0.5 flex-shrink-0 whitespace-nowrap" style={{ opacity: 0.25 }}>
          by <a href="#" onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.('https://github.com/sponsors/FileShot'); }} className="hover:opacity-70 transition-opacity cursor-pointer" title="Support Brendan Gray on GitHub Sponsors">Brendan Gray</a>
        </div>
      </div>
    </div>
  );
};
