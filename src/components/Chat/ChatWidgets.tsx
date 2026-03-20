/**
 * ChatWidgets.tsx — Pure presentational components extracted from ChatPanel.
 * These components have no shared state with ChatPanel — they receive everything via props.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Loader2, Copy, Check, Play, Wrench, X as XIcon, Save } from 'lucide-react';
import { sanitizeSVG, markdownInlineToHTML } from '@/utils/sanitize';

// ── Animated ellipsis dots for tool call in-progress state ──
const AnimatedDots: React.FC = () => {
  const [dots, setDots] = React.useState('');
  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.');
    }, 400);
    return () => clearInterval(interval);
  }, []);
  return <span className="inline-block w-[18px] text-left opacity-70">{dots}</span>;
};

// ── Audio Waveform Animation (active microphone indicator) ──
export const AudioWaveAnimation: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  if (!isActive) return null;
  return (
    <div className="flex items-center gap-[2px] h-[14px] px-1">
      {[0, 1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="w-[2px] bg-[#f44747] rounded-full"
          style={{
            animation: `audioWave 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
            height: '4px',
          }}
        />
      ))}
      <style>{`
        @keyframes audioWave {
          0% { height: 3px; opacity: 0.4; }
          50% { height: 10px; opacity: 0.8; }
          100% { height: 14px; opacity: 1; }
        }
      `}</style>
    </div>
  );
};

// ── Inline Tool Call — VS Code-style compact tool call element ──
// Rendered chronologically in the message flow, not grouped at the bottom.
export const InlineToolCall: React.FC<{
  label: string;
  icon?: string;
  detail?: string;
  diffStats?: { added?: number; removed?: number };
  children?: React.ReactNode;
}> = ({ label, icon, detail, diffStats, children }) => {
  const [expanded, setExpanded] = useState(false);
  const isOk = icon === '✓';
  const isFail = icon === '✗';
  return (
    <div className="my-1 rounded overflow-hidden"
      style={{ backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 60%, transparent)' }}
    >
      <button
        className="w-full flex items-center gap-1.5 px-2 py-[3px] text-[11px] transition-colors leading-snug min-h-0"
        style={{ color: 'var(--theme-foreground-muted)' }}
        onClick={() => children && setExpanded(!expanded)}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--theme-selection) 50%, transparent)'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        {children && (
          <span className={`text-[8px] transition-transform duration-150 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} style={{ color: 'var(--theme-foreground-muted)' }}>▶</span>
        )}
        {isOk ? (
          <Check size={12} className="text-[#89d185] flex-shrink-0" />
        ) : isFail ? (
          <XIcon size={12} className="text-[#f14c4c] flex-shrink-0" />
        ) : (
          <Loader2 size={11} className="animate-spin text-[#dcdcaa] flex-shrink-0" />
        )}
        <span className="font-medium truncate" style={{ color: 'var(--theme-foreground-muted)' }}>{label}</span>
        {detail && (
          <span className="truncate text-[10px]" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.7 }}>{detail}</span>
        )}
        {diffStats && (diffStats.added || diffStats.removed) ? (
          <span className="ml-auto flex gap-1.5 flex-shrink-0 text-[10px] font-mono">
            {diffStats.added ? <span className="text-[#89d185]">+{diffStats.added}</span> : null}
            {diffStats.removed ? <span className="text-[#f14c4c]">-{diffStats.removed}</span> : null}
          </span>
        ) : null}
      </button>
      {expanded && children && (
        <div className="px-2 py-1.5 text-[10px]" style={{ borderTop: '1px solid color-mix(in srgb, var(--theme-border) 50%, transparent)', color: 'var(--theme-foreground-muted)' }}>
          {children}
        </div>
      )}
    </div>
  );
};

// ── Collapsible Thinking/Reasoning Block ──
export const ThinkingBlock: React.FC<{ text: string; isLive?: boolean; segmentCount?: number }> = ({ text, isLive, segmentCount }) => {
  const [expanded, setExpanded] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const wasLiveRef = useRef(false);
  const wasEverLiveRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lines = text.split('\n').filter(l => l.trim());
  const count = segmentCount || 1;

  useEffect(() => {
    if (isLive && text.length > 0) {
      setExpanded(true);
      if (!wasLiveRef.current) {
        startTimeRef.current = Date.now();
        wasEverLiveRef.current = true;
      }
      wasLiveRef.current = true;
    }
    // When thinking completes, record elapsed time but do NOT auto-collapse (user can manually collapse)
    if (!isLive && wasLiveRef.current) {
      if (startTimeRef.current !== null) {
        setElapsedSeconds(Math.round((Date.now() - startTimeRef.current) / 1000));
      }
      wasLiveRef.current = false;
    }
  }, [isLive, text.length > 0]);

  useEffect(() => {
    if (isLive && expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text, isLive, expanded]);

  const label = isLive
    ? 'Reasoning...'
    : wasEverLiveRef.current
      ? `Thought for ${elapsedSeconds < 1 ? '<1' : elapsedSeconds}s`
      : `Thought for ${lines.length} line${lines.length !== 1 ? 's' : ''}`;

  return (
    <div className="mb-0 overflow-hidden">
      <button
        className="w-full flex items-center gap-1 py-0.5 text-[10px] transition-colors leading-tight min-h-0"
        style={{ color: 'var(--theme-foreground-muted)' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`text-[8px] transition-transform duration-150 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} style={{ color: 'var(--theme-foreground-muted)' }}>▶</span>
        <span className="font-medium whitespace-nowrap flex-shrink-0" style={{ color: 'var(--theme-foreground)' }}>
          <em>{label}</em>
        </span>
        {count > 1 && <span className="text-[8px] px-1 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-foreground-muted)' }}>{count} steps</span>}
        {isLive
          ? <Loader2 size={8} className="animate-spin ml-auto flex-shrink-0" style={{ color: 'var(--theme-foreground)' }} />
          : wasEverLiveRef.current && <Check size={9} className="text-[#4ec9b0] ml-auto flex-shrink-0" />
        }
      </button>
      {expanded && (
        <div ref={contentRef} className="px-2 pb-1.5 text-[10px] whitespace-pre-wrap leading-relaxed max-h-[180px] overflow-y-auto" style={{ borderTop: '1px solid var(--theme-border)', color: 'var(--theme-foreground-muted)' }}>
          {text}
        </div>
      )}
    </div>
  );
};

// ── API Key Input Component ──
export const ApiKeyInput: React.FC<{ provider: string; label: string; placeholder: string }> = ({ provider, label, placeholder }) => {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.electronAPI?.cloudLLMGetStatus?.().then((status: any) => {
      if (status?.providers?.includes(provider)) {
        setValue('••••••••••••••••');
        setSaved(true);
      }
    }).catch(() => {});
  }, [provider]);

  const handleSave = async () => {
    if (!value || value === '••••••••••••••••') return;
    await window.electronAPI?.cloudLLMSetKey?.(provider, value);
    setSaved(true);
    setTimeout(() => setValue('••••••••••••••••'), 500);
  };

  const handleClear = async () => {
    await window.electronAPI?.cloudLLMSetKey?.(provider, '');
    setValue('');
    setSaved(false);
  };

  return (
    <div className="mb-2">
      <label className="text-[10px] text-[#858585] mb-0.5 block">{label}</label>
      <div className="flex gap-1">
        <input
          type="password"
          className="flex-1 bg-[#3c3c3c] text-[#cccccc] text-[11px] px-2 py-1 rounded border border-[#3c3c3c] focus:border-[#007acc] outline-none"
          placeholder={placeholder}
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        />
        <button
          className={`px-2 py-1 text-[10px] rounded ${saved ? 'bg-[#89d185] text-black' : 'bg-[#007acc] text-white hover:bg-[#006bb3]'}`}
          onClick={saved ? handleClear : handleSave}
          disabled={!value && !saved}
        >
          {saved ? 'Clear' : 'Save'}
        </button>
      </div>
    </div>
  );
};

// ── Mermaid Diagram Renderer ──
export const MermaidDiagram: React.FC<{ code: string }> = ({ code }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: '#1e1e1e',
            primaryColor: '#264f78',
            primaryTextColor: '#cccccc',
            lineColor: '#858585',
          },
          securityLevel: 'strict',
        });
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const { svg: renderedSvg } = await mermaid.render(id, code.trim());
        if (!cancelled) setSvg(renderedSvg);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to render diagram');
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="rounded-md p-3 my-1.5" style={{ backgroundColor: 'color-mix(in srgb, #f14c4c 8%, transparent)', border: '1px solid color-mix(in srgb, #f14c4c 25%, transparent)' }}>
        <div className="text-[11px] text-[#f14c4c] mb-1 font-medium">Mermaid diagram error</div>
        <pre className="text-[11px] font-mono whitespace-pre-wrap" style={{ color: 'var(--theme-foreground)' }}>{code}</pre>
        <div className="text-[10px] mt-1" style={{ color: 'var(--theme-foreground-muted)' }}>{error}</div>
      </div>
    );
  }

  return (
    <div className="rounded-md my-1.5 overflow-hidden" style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ backgroundColor: 'var(--theme-bg-secondary)', borderBottom: '1px solid var(--theme-border)' }}>
        <span className="text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>Mermaid Diagram</span>
        <button
          className="text-[10px] px-2 py-0.5 rounded-md transition-colors"
          style={{ color: 'var(--theme-foreground-muted)' }}
          onClick={() => setShowSource(!showSource)}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; e.currentTarget.style.backgroundColor = 'var(--theme-selection)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-foreground-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {showSource ? 'Hide Source' : 'Show Source'}
        </button>
      </div>
      {showSource && (
        <pre className="text-[11px] font-mono p-3 whitespace-pre-wrap" style={{ color: 'var(--theme-foreground)', borderBottom: '1px solid var(--theme-border)' }}>{code}</pre>
      )}
      {svg ? (
        <div
          ref={containerRef}
          className="p-3 flex justify-center overflow-auto max-h-[400px]"
          dangerouslySetInnerHTML={{ __html: sanitizeSVG(svg) }}
        />
      ) : (
        <div className="p-3 text-center text-[12px]" style={{ color: 'var(--theme-foreground-muted)' }}>Rendering diagram...</div>
      )}
    </div>
  );
};

// ── Collapsible Tool Block ──
export const CollapsibleToolBlock: React.FC<{ label: string; icon?: string; children: React.ReactNode; defaultOpen?: boolean; _isGrouped?: boolean }> = ({ label, icon, children, defaultOpen = false, _isGrouped = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const isOk = icon === '✓';
  const isFail = icon === '✗';
  const isRunning = icon === '>' || icon === '▸' || (!isOk && !isFail);
  return (
    <div className={`overflow-hidden rounded ${_isGrouped ? 'my-0' : 'my-0.5'}`}
      style={{
        borderLeft: `2px solid ${isOk ? '#89d185' : isFail ? '#f14c4c' : 'var(--theme-accent)'}`,
        backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 80%, transparent)',
      }}
    >
      <button
        className="w-full flex items-center gap-1.5 px-2 py-[3px] text-[10px] transition-colors leading-snug min-h-0"
        style={{ color: 'var(--theme-foreground)' }}
        onClick={() => setOpen(!open)}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--theme-selection)'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <span className={`text-[8px] transition-transform duration-150 flex-shrink-0 ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--theme-foreground-muted)' }}>▶</span>
        {isOk ? (
          <Check size={11} className="text-[#89d185] flex-shrink-0" />
        ) : isFail ? (
          <XIcon size={11} className="text-[#f14c4c] flex-shrink-0" />
        ) : (
          <Loader2 size={10} className="animate-spin text-[#dcdcaa] flex-shrink-0" />
        )}
        <span className="font-medium truncate" style={{ color: 'var(--theme-foreground)' }}>{label}</span>
        {isRunning && !isOk && !isFail && (
          <span className="ml-auto text-[9px] text-[#dcdcaa] animate-pulse flex-shrink-0 font-medium">running</span>
        )}
      </button>
      {open && (
        <div className="pl-3 pr-2 py-1.5 text-[10px]" style={{ borderTop: '1px solid var(--theme-border)', color: 'var(--theme-foreground-muted)' }}>
          {children}
        </div>
      )}
    </div>
  );
};

// ── Stacked Tool Group — collapses consecutive identical tool calls into "tool x3" ──
const StackedToolGroup: React.FC<{ toolName: string; children: React.ReactNode[]; count: number }> = ({ toolName, children, count }) => {
  const [expanded, setExpanded] = useState(false);
  const okCount = children.filter((c: any) => c?.props?.icon === '✓').length;
  const failCount = children.filter((c: any) => c?.props?.icon === '✗').length;
  const isAllOk = failCount === 0 && okCount === count;
  const hasFail = failCount > 0;
  return (
    <div className="my-0">
      <button
        className="w-full flex items-center gap-1.5 px-2 py-[3px] text-[10px] transition-colors leading-snug min-h-0"
        style={{ color: 'var(--theme-foreground)', borderLeft: `2px solid ${hasFail ? '#f14c4c' : isAllOk ? '#89d185' : 'var(--theme-accent)'}`, backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 80%, transparent)' }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--theme-selection)'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--theme-bg-secondary) 80%, transparent)'; }}
      >
        <span className={`text-[8px] transition-transform duration-150 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} style={{ color: 'var(--theme-foreground-muted)' }}>▶</span>
        {isAllOk ? (
          <Check size={11} className="text-[#89d185] flex-shrink-0" />
        ) : hasFail ? (
          <XIcon size={11} className="text-[#f14c4c] flex-shrink-0" />
        ) : (
          <Loader2 size={10} className="animate-spin text-[#dcdcaa] flex-shrink-0" />
        )}
        <span className="font-medium truncate" style={{ color: 'var(--theme-foreground)' }}>{toolName}</span>
        <span className="ml-1 text-[9px] font-medium px-1 py-0 rounded flex-shrink-0"
          style={{ backgroundColor: 'color-mix(in srgb, var(--theme-accent) 20%, transparent)', color: 'var(--theme-accent)' }}
        >x{count}</span>
      </button>
      {expanded && (
        <div className="pl-2 flex flex-col gap-0">
          {children.map((child: any) => {
            if (child?.type === CollapsibleToolBlock) {
              return React.cloneElement(child, { _isGrouped: true });
            }
            return child;
          })}
        </div>
      )}
    </div>
  );
};

// ── Tool Call Group — flat container showing individual tool blocks, stacks consecutive identical calls ──
export const ToolCallGroup: React.FC<{ children: React.ReactNode; count: number }> = ({ children, count }) => {
  const childArray = React.Children.toArray(children);
  const okCount = childArray.filter((c: any) => c?.props?.icon === '✓').length;
  const failCount = childArray.filter((c: any) => c?.props?.icon === '✗').length;
  const runningCount = count - okCount - failCount;
  const isRunning = runningCount > 0;
  const allOk = failCount === 0 && !isRunning;
  const hasFail = failCount > 0;

  const summaryParts: string[] = [];
  if (okCount > 0) summaryParts.push(`${okCount} passed`);
  if (failCount > 0) summaryParts.push(`${failCount} failed`);
  const summary = summaryParts.join(', ') || `${count} tools`;

  // Group consecutive children with the same tool name for stacking
  const groupedChildren: React.ReactNode[] = [];
  let i = 0;
  while (i < childArray.length) {
    const child = childArray[i] as any;
    // Extract tool name from label (format: "tool_name: detail [OK]" or "tool_name [OK]")
    const label = child?.props?.label || '';
    const toolName = label.split(':')[0].replace(/\s*\[(OK|FAIL)\]\s*$/, '').trim();
    
    if (toolName) {
      // Count consecutive children with same tool name
      let j = i + 1;
      while (j < childArray.length) {
        const nextChild = childArray[j] as any;
        const nextLabel = nextChild?.props?.label || '';
        const nextToolName = nextLabel.split(':')[0].replace(/\s*\[(OK|FAIL)\]\s*$/, '').trim();
        if (nextToolName === toolName) j++;
        else break;
      }
      const groupSize = j - i;
      if (groupSize >= 2) {
        const groupChildren = childArray.slice(i, j) as React.ReactNode[];
        groupedChildren.push(
          <StackedToolGroup key={`stack-${i}`} toolName={toolName} count={groupSize}>
            {groupChildren}
          </StackedToolGroup>
        );
        i = j;
        continue;
      }
    }
    // Single item — render normally
    if (child?.type === CollapsibleToolBlock) {
      groupedChildren.push(React.cloneElement(child, { _isGrouped: true }));
    } else {
      groupedChildren.push(child);
    }
    i++;
  }

  return (
    <div className="my-1 overflow-hidden rounded" style={{ border: '1px solid var(--theme-border)', backgroundColor: 'color-mix(in srgb, var(--theme-bg-secondary) 50%, transparent)' }}>
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] leading-snug min-h-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
        {isRunning ? (
          <Loader2 size={11} className="text-[#dcdcaa] flex-shrink-0 animate-spin" />
        ) : (
          <Wrench size={11} className={`flex-shrink-0 ${allOk ? 'text-[#89d185]' : hasFail ? 'text-[#f14c4c]' : 'text-[#dcdcaa]'}`} />
        )}
        {isRunning ? (
          <span className="font-medium" style={{ color: 'var(--theme-foreground)' }}>{count} tool call{count !== 1 ? 's' : ''}<AnimatedDots /></span>
        ) : (
          <span className="font-medium" style={{ color: 'var(--theme-foreground)' }}>{count} tool call{count !== 1 ? 's' : ''}</span>
        )}
        {!isRunning && (
          <span className={`ml-auto text-[10px] font-medium flex-shrink-0 px-1.5 py-0.5 rounded ${hasFail ? 'text-[#f14c4c]' : allOk ? 'text-[#89d185]' : 'text-[#dcdcaa]'}`}
            style={{ backgroundColor: hasFail ? 'color-mix(in srgb, #f14c4c 10%, transparent)' : allOk ? 'color-mix(in srgb, #89d185 10%, transparent)' : 'transparent' }}
          >{summary}</span>
        )}
      </div>
      <div className="px-1.5 py-1 flex flex-col gap-0">
        {groupedChildren}
      </div>
    </div>
  );
};

// ── Code Block with Copy/Apply ──
const COLLAPSE_LINE_THRESHOLD = 6; // Collapse code blocks taller than this many lines

export const CodeBlock: React.FC<{ code: string; language: string; onApply: () => void; isToolCall?: boolean; isStreaming?: boolean; isAlreadyWritten?: boolean; onSaveAsFile?: (code: string, language: string) => void; defaultCollapsed?: boolean }> = ({ code, language, onApply, isToolCall, isStreaming, isAlreadyWritten, onSaveAsFile, defaultCollapsed }) => {
  const [copied, setCopied] = useState(false);
  const lineCount = code.split('\n').length;
  const isLong = lineCount > COLLAPSE_LINE_THRESHOLD;
  // Default to collapsed for long blocks; keep streaming blocks expanded so users can watch generation
  // defaultCollapsed forces collapsed on first render (used for live tool call generation bubbles)
  const [expanded, setExpanded] = useState(defaultCollapsed ? false : !!isStreaming || !isLong);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // For collapsed view, show first N lines + indicator
  const displayCode = expanded ? code : code.split('\n').slice(0, COLLAPSE_LINE_THRESHOLD).join('\n');

  return (
    <div className="mt-1.5 mb-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--theme-border)' }}>
      <div className="flex items-center justify-between px-2.5 py-1" style={{ backgroundColor: 'var(--theme-bg-secondary)', borderBottom: '1px solid var(--theme-border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-accent) 15%, transparent)', color: 'var(--theme-accent)' }}>{language || 'code'}</span>
          {(isLong || defaultCollapsed) && (
            <span className="text-[9px]" style={{ color: 'var(--theme-foreground-muted)' }}>({lineCount} lines)</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {(isLong || defaultCollapsed) && (
            <button
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ color: 'var(--theme-foreground-muted)' }}
              onClick={() => setExpanded(!expanded)}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; e.currentTarget.style.backgroundColor = 'var(--theme-selection)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-foreground-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {expanded ? '▼ Collapse' : '▶ Expand'}
            </button>
          )}
          <button
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors"
            style={{ color: 'var(--theme-foreground-muted)' }}
            onClick={handleCopy}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--theme-foreground)'; e.currentTarget.style.backgroundColor = 'var(--theme-selection)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--theme-foreground-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {!isStreaming && (
            isAlreadyWritten ? (
              <span className="flex items-center gap-1 text-[10px] px-2 py-1 text-[#89d185] font-medium">
                <Check size={10} />
                Written
              </span>
            ) : (
              <>
                {onSaveAsFile && (
                  <button
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-all font-medium"
                    style={{ color: '#c586c0' }}
                    onClick={() => onSaveAsFile(code, language)}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#c586c0'; e.currentTarget.style.color = 'white'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#c586c0'; }}
                  >
                    <Save size={10} />
                    Save as File
                  </button>
                )}
                <button
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-all font-medium"
                  style={{ color: isToolCall ? '#89d185' : 'var(--theme-accent)' }}
                  onClick={onApply}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = isToolCall ? '#89d185' : 'var(--theme-accent)'; e.currentTarget.style.color = isToolCall ? '#1e1e1e' : 'white'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = isToolCall ? '#89d185' : 'var(--theme-accent)'; }}
                >
                  <Play size={10} />
                  {isToolCall ? 'Run' : 'Apply'}
                </button>
              </>
            )
          )}
        </div>
      </div>
      <div className="relative">
        <pre className={`px-2.5 py-2 overflow-x-auto text-[12px] font-mono leading-relaxed ${!expanded ? 'max-h-[100px] overflow-hidden' : ''}`} style={{ backgroundColor: 'var(--theme-bg)' }}>
          <code style={{ color: 'var(--theme-foreground)' }}>{displayCode}</code>
        </pre>
        {isLong && !expanded && (
          <div
            className="absolute bottom-0 left-0 right-0 h-8 flex items-end justify-center pb-1 cursor-pointer"
            style={{ background: 'linear-gradient(to top, var(--theme-bg), transparent)' }}
            onClick={() => setExpanded(true)}
          >
            <span className="text-[10px] px-3 py-1 rounded-md font-medium transition-colors" style={{ color: 'var(--theme-foreground-muted)', backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)' }}>
              Show all {lineCount} lines
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Rich Text Span — renders plain text with source bubbles + inline markdown ──
export const RichTextSpan: React.FC<{ content: string }> = ({ content }) => {
  // Parse source/reference patterns and markdown links into rich elements
  const sourceRegex = /(?:Source|Reference|Citation|Via):\s*(https?:\/\/[^\s<]+)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyIdx = 0;
  
  while ((match = sourceRegex.exec(content)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(<span key={keyIdx++} className="whitespace-pre-wrap">{content.slice(lastIndex, match.index)}</span>);
    }
    
    if (match[1]) {
      // "Source: https://..." pattern
      const url = match[1];
      const domain = url.replace(/^https?:\/\/(?:www\.)?/, '').split('/')[0];
      parts.push(
        <a key={keyIdx++} href={url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-[rgba(86,156,214,0.12)] border border-[rgba(86,156,214,0.25)] rounded-xl text-[11px] text-[#569cd6] no-underline hover:bg-[rgba(86,156,214,0.22)] hover:border-[rgba(86,156,214,0.45)] transition-all align-middle max-w-[200px] cursor-pointer"
          title={url}
        >
          <span className="text-[10px] flex-shrink-0">🔗</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{domain}</span>
        </a>
      );
    } else if (match[2] && match[3]) {
      // [text](url) markdown link pattern
      const text = match[2];
      const url = match[3];
      const domain = url.replace(/^https?:\/\/(?:www\.)?/, '').split('/')[0];
      parts.push(
        <a key={keyIdx++} href={url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 bg-[rgba(86,156,214,0.12)] border border-[rgba(86,156,214,0.25)] rounded-xl text-[11px] text-[#569cd6] no-underline hover:bg-[rgba(86,156,214,0.22)] hover:border-[rgba(86,156,214,0.45)] transition-all align-middle max-w-[200px] cursor-pointer"
          title={url}
        >
          <span className="text-[10px] flex-shrink-0">🔗</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{text || domain}</span>
        </a>
      );
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(<span key={keyIdx++} className="whitespace-pre-wrap">{content.slice(lastIndex)}</span>);
  }
  
  return <>{parts.length > 0 ? parts : <span className="whitespace-pre-wrap">{content}</span>}</>;
};

// ── Inline Markdown Text — renders *italic*, **bold**, and `code` in plain text ──
export const InlineMarkdownText: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
  // Collapse 3+ consecutive newlines to 2 (max one blank line) to avoid excessive vertical gaps
  const normalized = content.replace(/\n{3,}/g, '\n\n');
  const html = markdownInlineToHTML(normalized);
  return (
    <span 
      className={`whitespace-pre-wrap ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
