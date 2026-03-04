/**
 * ChatWidgets.tsx — Pure presentational components extracted from ChatPanel.
 * These components have no shared state with ChatPanel — they receive everything via props.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Loader2, Copy, Check, Play, Wrench, X as XIcon } from 'lucide-react';
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
    // Collapse when thinking completes (was live, now not)
    if (!isLive && wasLiveRef.current) {
      setExpanded(false);
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
    <div className="mb-0.5 overflow-hidden">
      <button
        className="w-full flex items-center gap-1 py-0.5 text-[11px] text-[#d0d0d0] transition-colors leading-snug min-h-0"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`text-[8px] transition-transform duration-150 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-white font-medium whitespace-nowrap flex-shrink-0">
          <em>{label}</em>
        </span>
        {count > 1 && <span className="text-[8px] bg-[#505050] text-[#d0d0d0] px-1 rounded-full flex-shrink-0">{count} steps</span>}
        {isLive
          ? <Loader2 size={8} className="animate-spin text-white ml-auto flex-shrink-0" />
          : wasEverLiveRef.current && <Check size={9} className="text-[#4ec9b0] ml-auto flex-shrink-0" />
        }
      </button>
      {expanded && (
        <div ref={contentRef} className="px-2 pb-1.5 text-[10px] text-[#b0b0b0] whitespace-pre-wrap leading-relaxed border-t border-[#3c3c3c] max-h-[200px] overflow-y-auto">
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
      <div className="bg-[#2d1515] border border-[#5a2020] rounded-md p-3 my-1.5">
        <div className="text-[11px] text-[#f14c4c] mb-1">Mermaid diagram error</div>
        <pre className="text-[11px] text-[#d4d4d4] font-mono whitespace-pre-wrap">{code}</pre>
        <div className="text-[10px] text-[#858585] mt-1">{error}</div>
      </div>
    );
  }

  return (
    <div className="bg-[#1e1e1e] border border-[#3c3c3c] rounded-md my-1.5 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 bg-[#252525] border-b border-[#3c3c3c]">
        <span className="text-[11px] text-[#858585]">Mermaid Diagram</span>
        <button
          className="text-[10px] text-[#858585] hover:text-[#cccccc]"
          onClick={() => setShowSource(!showSource)}
        >
          {showSource ? 'Hide Source' : 'Show Source'}
        </button>
      </div>
      {showSource && (
        <pre className="text-[11px] text-[#d4d4d4] font-mono p-3 border-b border-[#3c3c3c] whitespace-pre-wrap">{code}</pre>
      )}
      {svg ? (
        <div
          ref={containerRef}
          className="p-3 flex justify-center overflow-auto max-h-[400px]"
          dangerouslySetInnerHTML={{ __html: sanitizeSVG(svg) }}
        />
      ) : (
        <div className="p-3 text-center text-[12px] text-[#858585]">Rendering diagram...</div>
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
  const iconColor = isOk ? 'text-[#89d185]' : isFail ? 'text-[#f14c4c]' : 'text-[#dcdcaa]';
  return (
    <div className={`overflow-hidden rounded-sm ${_isGrouped ? 'my-0' : 'my-0.5'}`} style={{ borderLeft: '2px solid var(--theme-accent)', paddingLeft: '4px', backgroundColor: 'color-mix(in srgb, var(--theme-accent) 5%, transparent)' }}>
      <button
        className="w-full flex items-center gap-1 py-0.5 text-[11px] text-[#d0d0d0] transition-colors leading-snug min-h-0"
        onClick={() => setOpen(!open)}
      >
        <span className={`text-[8px] transition-transform duration-150 flex-shrink-0 ${open ? 'rotate-90' : ''}`}>▶</span>
        {isOk ? (
          <Check size={9} className="text-[#89d185] flex-shrink-0" />
        ) : isFail ? (
          <XIcon size={9} className="text-[#f14c4c] flex-shrink-0" />
        ) : (
          <Loader2 size={8} className="animate-spin text-[#dcdcaa] flex-shrink-0" />
        )}
        <span className="text-[#d4d4d4] font-medium truncate">{label}</span>
        {isRunning && !isOk && !isFail && (
          <span className="ml-auto text-[9px] text-[#dcdcaa] animate-pulse flex-shrink-0">running</span>
        )}
      </button>
      {open && (
        <div className="pl-3 py-1.5 border-t border-[#3c3c3c] text-[10px] text-[#b0b0b0]">
          {children}
        </div>
      )}
    </div>
  );
};

// ── Tool Call Group — wraps consecutive tool blocks under a single collapsible ──
export const ToolCallGroup: React.FC<{ children: React.ReactNode; count: number }> = ({ children, count }) => {
  const [open, setOpen] = useState(false);
  const childArray = React.Children.toArray(children);
  const okCount = childArray.filter((c: any) => c?.props?.icon === '✓').length;
  const failCount = childArray.filter((c: any) => c?.props?.icon === '✗').length;
  const runningCount = count - okCount - failCount;
  const isRunning = runningCount > 0;

  // Auto-open when tools are executing so user sees live updates without clicking
  useEffect(() => {
    if (isRunning) setOpen(true);
  }, [isRunning]);

  const summaryParts: string[] = [];
  if (okCount > 0) summaryParts.push(`${okCount} passed`);
  if (failCount > 0) summaryParts.push(`${failCount} failed`);
  const summary = summaryParts.join(', ') || `${count} tools`;
  const allOk = failCount === 0 && !isRunning;
  const hasFail = failCount > 0;

  return (
    <div className="my-0.5 overflow-hidden">
      <button
        className="w-full flex items-center gap-1 py-0.5 text-[11px] text-[#d0d0d0] transition-colors leading-snug min-h-0"
        onClick={() => setOpen(!open)}
      >
        <span className={`text-[8px] transition-transform duration-150 flex-shrink-0 ${open ? 'rotate-90' : ''}`}>▶</span>
        {isRunning ? (
          <Loader2 size={12} className="text-[#dcdcaa] flex-shrink-0 animate-spin" />
        ) : (
          <Wrench size={12} className={`flex-shrink-0 ${allOk ? 'text-[#89d185]' : hasFail ? 'text-[#f14c4c]' : 'text-[#dcdcaa]'}`} />
        )}
        {isRunning ? (
          <span className="text-[#d4d4d4] font-medium italic">{count} tool call{count !== 1 ? 's' : ''}<AnimatedDots /></span>
        ) : (
          <span className="text-[#d4d4d4] font-medium">{count} tool call{count !== 1 ? 's' : ''}</span>
        )}
        {!isRunning && (
          <span className={`ml-auto text-[9px] flex-shrink-0 ${hasFail ? 'text-[#f14c4c]' : allOk ? 'text-[#89d185]' : 'text-[#dcdcaa]'}`}>{summary}</span>
        )}
      </button>
      {open && (
        <div className="pl-3 py-1 border-t border-[#3c3c3c] flex flex-col gap-0">
          {React.Children.map(children, (child: any) => {
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

// ── Code Block with Copy/Apply ──
const COLLAPSE_LINE_THRESHOLD = 6; // Collapse code blocks taller than this many lines

export const CodeBlock: React.FC<{ code: string; language: string; onApply: () => void; isToolCall?: boolean; isStreaming?: boolean }> = ({ code, language, onApply, isToolCall, isStreaming }) => {
  const [copied, setCopied] = useState(false);
  const lineCount = code.split('\n').length;
  const isLong = lineCount > COLLAPSE_LINE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong); // Start collapsed if long

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // For collapsed view, show first N lines + indicator
  const displayCode = expanded ? code : code.split('\n').slice(0, COLLAPSE_LINE_THRESHOLD).join('\n');

  return (
    <div className="mt-2 mb-4 rounded-lg overflow-hidden border border-[#3c3c3c]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#262626] border-b border-[#3c3c3c]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-accent) 15%, transparent)', color: 'var(--theme-accent)' }}>{language || 'code'}</span>
          {isLong && (
            <span className="text-[9px] text-[#858585]">({lineCount} lines)</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isLong && (
            <button
              className="flex items-center gap-1 text-[10px] text-[#858585] hover:text-white px-1.5 py-0.5 rounded hover:bg-[#3c3c3c]"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '▼ Collapse' : '▶ Expand'}
            </button>
          )}
          <button
            className="flex items-center gap-1 text-[10px] text-[#858585] hover:text-white px-1.5 py-0.5 rounded hover:bg-[#3c3c3c]"
            onClick={handleCopy}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {!isStreaming && (
            <button
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                isToolCall 
                  ? 'text-[#89d185] hover:text-white hover:bg-[#89d185]' 
                  : 'text-[#007acc] hover:text-white hover:bg-[#007acc]'
              }`}
              onClick={onApply}
            >
              <Play size={10} />
              {isToolCall ? 'Run' : 'Apply'}
            </button>
          )}
        </div>
      </div>
      <div className="relative">
        <pre className={`p-3 overflow-x-auto text-[12px] font-mono bg-[#1e1e1e] leading-relaxed ${!expanded ? 'max-h-[120px] overflow-hidden' : ''}`}>
          <code>{displayCode}</code>
        </pre>
        {isLong && !expanded && (
          <div
            className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#1e1e1e] to-transparent flex items-end justify-center pb-1 cursor-pointer"
            onClick={() => setExpanded(true)}
          >
            <span className="text-[10px] text-[#858585] hover:text-white bg-[#2d2d2d] px-3 py-0.5 rounded border border-[#3c3c3c]">
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
