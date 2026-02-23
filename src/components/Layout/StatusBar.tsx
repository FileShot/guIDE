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
  onAction?: (action: string) => void;
  onChatMessage?: (message: string) => void;
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
  onAction,
  onChatMessage,
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

  // Measure tokens/sec from streaming
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const tokenHandler = (_token: string) => {
      tokenCountRef.current++;
    };

    // Secondary listener just for speed measurement
    api.onLlmToken?.(tokenHandler);

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
    <div className="h-[24px] flex items-center justify-between px-2 text-[12px] select-none flex-shrink-0 overflow-hidden" style={{ backgroundColor: 'var(--theme-status-bar)', borderTop: '1px solid var(--theme-border)', color: 'var(--theme-status-bar-fg)' }}>
      {/* Left */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Git branch */}
        <div className="flex items-center gap-1 cursor-pointer hover:bg-[#ffffff10] px-1 rounded">
          <GitBranch size={12} />
          <span>main</span>
        </div>

        {/* Errors/Warnings */}
        <div className="flex items-center gap-1 cursor-pointer hover:bg-[#ffffff10] px-1 rounded">
          <AlertCircle size={12} />
          <span>0</span>
          <span className="mx-0.5">W</span>
          <span>0</span>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
        {/* RAG indexing */}
        {ragStatus.isIndexing && (
          <div className="flex items-center gap-1 animate-pulse text-[#dcdcaa]">
            <Loader2 size={12} className="animate-spin" />
            <span>Indexing {ragStatus.progress}%</span>
          </div>
        )}

        {/* Tokens/sec speed indicator */}
        {tokensPerSec > 0 && (
          <div className="flex items-center gap-1 text-[#4fc1ff]" title="Generation speed">
            <Zap size={10} />
            <span className="text-[11px]">{tokensPerSec} tok/s</span>
          </div>
        )}

        {/* Context usage ring */}
        {contextUsage.total > 0 && (
          <div className="flex items-center gap-1 cursor-pointer hover:bg-[#ffffff10] px-1 rounded"
               title={`Context: ${contextUsage.used.toLocaleString()} / ${contextUsage.total.toLocaleString()} tokens (${ctxPct}%)`}>
            <ContextRing used={contextUsage.used} total={contextUsage.total} />
            <span className="text-[11px]">{ctxPct}%</span>
          </div>
        )}

        {/* Compact GPU/CPU indicator — tooltip has full details */}
        {gpuInfo && (
          <div className="flex items-center gap-1 cursor-pointer hover:bg-[#ffffff10] px-1 rounded flex-shrink-0"
               title={`${gpuInfo.name}\nVRAM: ${gpuInfo.vramUsedGB}/${gpuInfo.vramTotalGB} GB (${gpuInfo.vramUsagePercent}%)\nGPU Util: ${gpuInfo.utilizationPercent}% • Temp: ${gpuInfo.temperatureC}°C\nCPU: ${systemResources?.cpu || 0}% • RAM: ${systemResources?.ram?.percent || 0}%\nLayers: ${gpuInfo.gpuLayers || 0} (${gpuInfo.backend || 'none'})`}>
            <span className={`text-[10px] font-medium ${gpuInfo.isActive ? 'text-[#89d185]' : 'text-[#f48771]'}`}>{gpuInfo.isActive ? 'GPU' : 'CPU'}</span>
            <ProgressRing percent={gpuInfo.vramUsagePercent} size={12} strokeWidth={1.5} />
            <span className="text-[10px] text-[#858585]">{gpuInfo.vramUsedGB}/{gpuInfo.vramTotalGB}G</span>
          </div>
        )}

        {/* Cursor position */}
        <div className="cursor-pointer hover:bg-[#ffffff10] px-1 rounded flex-shrink-0 whitespace-nowrap">
          Ln {cursorPosition.line}, Col {cursorPosition.column}
        </div>

        {/* Language */}
        <div className="cursor-pointer hover:bg-[#ffffff10] px-1 rounded capitalize flex-shrink-0">
          {language}
        </div>

        {/* LLM Status */}
        <div className="flex items-center gap-1 cursor-pointer hover:bg-[#ffffff10] px-1 rounded min-w-0 flex-shrink"
             title={llmStatus.modelInfo ? `${llmStatus.modelInfo.name}\nContext: ${llmStatus.modelInfo.contextSize || '?'} tokens\nGPU Layers: ${llmStatus.modelInfo.gpuLayers || '?'}\nBackend: ${llmStatus.modelInfo.gpuBackend || '?'}${llmStatus.modelInfo.flashAttention ? '\nFlash Attention: ON' : ''}` : llmStatus.message}>
          {getStatusIcon()}
          <span className="max-w-[250px] truncate">{getStatusText()}</span>
          {llmStatus.state === 'loading' && typeof llmStatus.progress === 'number' && llmStatus.progress > 0 && (
            <div className="w-[60px] h-[3px] bg-[#3c3c3c] rounded-full overflow-hidden flex-shrink-0">
              <div className="h-full bg-[#dcdcaa] rounded-full transition-all duration-300" style={{ width: `${Math.round(llmStatus.progress * 100)}%` }} />
            </div>
          )}
        </div>

        {/* Voice Command */}
        {onAction && (
          <VoiceCommandButton onAction={onAction} onChatMessage={onChatMessage} />
        )}

        {/* Terminal toggle */}
        <button
          className="flex items-center gap-1 hover:bg-[#ffffff10] px-1 rounded flex-shrink-0"
          onClick={onToggleTerminal}
        >
          <Terminal size={12} />
        </button>

        {/* Notifications */}
        <div className="cursor-pointer hover:bg-[#ffffff10] px-1 rounded flex-shrink-0">
          <Bell size={12} />
        </div>

        {/* Credit */}
        <div className="text-[10px] text-[#858585]/40 pl-1 border-l border-[#858585]/10 flex-shrink-0 whitespace-nowrap">
          by <a href="#" onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.('https://github.com/sponsors/FileShot'); }} className="hover:text-[#cccccc]/70 transition-colors cursor-pointer" title="Support Brendan Gray on GitHub Sponsors">Brendan Gray</a>
        </div>
      </div>
    </div>
  );
};
