import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Plus, Trash2, Copy, Check, ChevronDown, Clock, FileText } from 'lucide-react';

interface Header { key: string; value: string; enabled: boolean; }

interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  timestamp: number;
  status?: number;
  durationMs?: number;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const STATUS_COLORS: Record<string, string> = {
  '2': 'text-[#4ec9b0]',
  '3': 'text-[#4fc1ff]',
  '4': 'text-[#f97583]',
  '5': 'text-[#ff8c00]',
};

function statusColor(status?: number): string {
  if (!status) return 'text-[#858585]';
  const group = String(Math.floor(status / 100));
  return STATUS_COLORS[group] || 'text-white';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STORAGE_KEY = 'guide_rest_client_history';
const loadHistory = (): HistoryEntry[] => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
};
const saveHistory = (h: HistoryEntry[]) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(0, 50))); } catch {}
};

export function RestClientPanel() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'headers' | 'body'>('headers');
  const [headers, setHeaders] = useState<Header[]>([
    { key: 'Accept', value: 'application/json', enabled: true },
  ]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [respTab, setRespTab] = useState<'body' | 'headers'>('body');
  const [copied, setCopied] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const methodRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (methodRef.current && !methodRef.current.contains(e.target as Node)) setMethodOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addHeader = () => setHeaders(h => [...h, { key: '', value: '', enabled: true }]);
  const removeHeader = (i: number) => setHeaders(h => h.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: keyof Header, val: string | boolean) =>
    setHeaders(h => h.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  const sendRequest = useCallback(async () => {
    const trimUrl = url.trim();
    if (!trimUrl) return;
    const api = window.electronAPI;
    if (!api?.restRequest) return;
    setLoading(true);
    setResponse(null);
    try {
      const reqHeaders: Record<string, string> = {};
      headers.filter(h => h.enabled && h.key.trim()).forEach(h => {
        reqHeaders[h.key.trim()] = h.value;
      });
      const result = await api.restRequest({
        method,
        url: trimUrl,
        headers: reqHeaders,
        body: ['POST', 'PUT', 'PATCH'].includes(method) ? body : undefined,
      });
      setResponse(result);
      const entry: HistoryEntry = {
        id: Date.now().toString(),
        method,
        url: trimUrl,
        timestamp: Date.now(),
        status: result.status,
        durationMs: result.durationMs,
      };
      setHistory(prev => {
        const next = [entry, ...prev.filter(e => !(e.method === method && e.url === trimUrl))].slice(0, 50);
        saveHistory(next);
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [method, url, headers, body]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendRequest();
  };

  const copyResponse = () => {
    if (!response?.body) return;
    navigator.clipboard.writeText(response.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const loadFromHistory = (entry: HistoryEntry) => {
    setMethod(entry.method);
    setUrl(entry.url);
    setShowHistory(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] text-[13px] select-none overflow-hidden">
      {/* URL Bar */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-[#333] flex-shrink-0">
        {/* Method dropdown */}
        <div className="relative flex-shrink-0" ref={methodRef}>
          <button
            className="flex items-center gap-1 px-2 py-1 bg-[#2d2d2d] border border-[#3c3c3c] rounded text-[#4ec9b0] font-mono text-[12px] hover:border-[#007acc] transition-colors"
            onClick={() => setMethodOpen(o => !o)}
          >
            {method} <ChevronDown size={11} />
          </button>
          {methodOpen && (
            <div className="absolute z-50 top-full left-0 mt-0.5 bg-[#252526] border border-[#3c3c3c] rounded shadow-xl py-0.5 min-w-[90px]">
              {HTTP_METHODS.map(m => (
                <button
                  key={m}
                  className={`w-full text-left px-3 py-1 text-[12px] font-mono hover:bg-[#094771] ${m === method ? 'text-[#4ec9b0]' : 'text-[#cccccc]'}`}
                  onClick={() => { setMethod(m); setMethodOpen(false); }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* URL input */}
        <input
          className="flex-1 bg-[#2d2d2d] border border-[#3c3c3c] rounded px-2 py-1 text-[#cccccc] placeholder-[#555] focus:outline-none focus:border-[#007acc] text-[12px] font-mono"
          placeholder="https://api.example.com/endpoint"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {/* Send button */}
        <button
          className={`flex items-center gap-1 px-3 py-1 rounded text-[12px] font-medium transition-colors flex-shrink-0 ${
            loading
              ? 'bg-[#3c3c3c] text-[#858585] cursor-not-allowed'
              : 'bg-[#007acc] text-white hover:bg-[#1a8ad4]'
          }`}
          onClick={sendRequest}
          disabled={loading}
          title="Send (Ctrl+Enter)"
        >
          <Send size={12} />
          {loading ? 'Sending…' : 'Send'}
        </button>

        {/* History toggle */}
        <button
          className={`p-1 rounded hover:bg-[#3c3c3c] transition-colors ${showHistory ? 'text-[#007acc]' : 'text-[#858585]'}`}
          onClick={() => setShowHistory(v => !v)}
          title="Request History"
        >
          <Clock size={14} />
        </button>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="border-b border-[#333] bg-[#252526] max-h-[160px] overflow-y-auto flex-shrink-0">
          {history.length === 0 ? (
            <div className="px-3 py-2 text-[#858585] text-[12px]">No request history yet.</div>
          ) : (
            history.map(entry => (
              <button
                key={entry.id}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#094771] text-left transition-colors group"
                onClick={() => loadFromHistory(entry)}
              >
                <span className="font-mono text-[11px] text-[#4ec9b0] w-14 flex-shrink-0">{entry.method}</span>
                <span className="flex-1 text-[12px] text-[#cccccc] truncate">{entry.url}</span>
                {entry.status && (
                  <span className={`text-[11px] font-mono ${statusColor(entry.status)} flex-shrink-0`}>{entry.status}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* Request Tabs — Headers / Body */}
      <div className="flex border-b border-[#333] bg-[#252526] flex-shrink-0">
        {(['headers', 'body'] as const).map(t => (
          <button
            key={t}
            className={`px-3 py-1.5 text-[12px] capitalize transition-colors ${
              activeTab === t
                ? 'text-white border-b-2 border-[#007acc]'
                : 'text-[#858585] hover:text-white'
            }`}
            onClick={() => setActiveTab(t)}
          >
            {t}
            {t === 'headers' && headers.filter(h => h.enabled && h.key).length > 0 && (
              <span className="ml-1 text-[10px] text-[#007acc]">
                {headers.filter(h => h.enabled && h.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Request Body Area */}
      <div className="flex-shrink-0" style={{ maxHeight: '220px', overflowY: 'auto' }}>
        {activeTab === 'headers' && (
          <div className="p-2 space-y-1">
            {headers.map((h, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={e => updateHeader(i, 'enabled', e.target.checked)}
                  className="accent-[#007acc]"
                />
                <input
                  className="flex-1 bg-[#2d2d2d] border border-[#3c3c3c] rounded px-1.5 py-0.5 text-[11px] font-mono text-[#9cdcfe] placeholder-[#555] focus:outline-none focus:border-[#007acc]"
                  placeholder="Header"
                  value={h.key}
                  onChange={e => updateHeader(i, 'key', e.target.value)}
                />
                <input
                  className="flex-1 bg-[#2d2d2d] border border-[#3c3c3c] rounded px-1.5 py-0.5 text-[11px] font-mono text-[#ce9178] placeholder-[#555] focus:outline-none focus:border-[#007acc]"
                  placeholder="Value"
                  value={h.value}
                  onChange={e => updateHeader(i, 'value', e.target.value)}
                />
                <button
                  className="p-0.5 text-[#555] hover:text-[#f97583] transition-colors"
                  onClick={() => removeHeader(i)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              className="flex items-center gap-1 text-[11px] text-[#007acc] hover:text-[#4fc1ff] mt-1 transition-colors"
              onClick={addHeader}
            >
              <Plus size={11} /> Add Header
            </button>
          </div>
        )}

        {activeTab === 'body' && (
          <div className="p-2">
            <textarea
              className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-2 py-1.5 text-[12px] font-mono text-[#d4d4d4] placeholder-[#555] focus:outline-none focus:border-[#007acc] resize-none"
              rows={6}
              placeholder={'{\n  "key": "value"\n}'}
              value={body}
              onChange={e => setBody(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Response Panel */}
      <div className="flex-1 min-h-0 flex flex-col border-t border-[#333]">
        {/* Response meta bar */}
        <div className="flex items-center gap-3 px-3 py-1.5 bg-[#252526] border-b border-[#333] flex-shrink-0">
          <div className="flex gap-1">
            {(['body', 'headers'] as const).map(t => (
              <button
                key={t}
                className={`px-2 py-0.5 text-[11px] rounded capitalize transition-colors ${
                  respTab === t ? 'bg-[#2d2d2d] text-white' : 'text-[#858585] hover:text-white'
                }`}
                onClick={() => setRespTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {response && (
            <>
              {response.status && (
                <span className={`text-[12px] font-mono font-semibold ${statusColor(response.status)}`}>
                  {response.status} {response.statusText}
                </span>
              )}
              {response.durationMs !== undefined && (
                <span className="text-[11px] text-[#858585]">{response.durationMs}ms</span>
              )}
              {response.size !== undefined && (
                <span className="text-[11px] text-[#858585]">{formatBytes(response.size)}</span>
              )}
              <button
                className={`p-1 rounded hover:bg-[#3c3c3c] transition-colors ${copied ? 'text-[#4ec9b0]' : 'text-[#858585] hover:text-white'}`}
                onClick={copyResponse}
                title="Copy response body"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </>
          )}
          {!response && !loading && (
            <span className="text-[11px] text-[#555] flex items-center gap-1">
              <FileText size={12} /> No response
            </span>
          )}
          {loading && (
            <span className="text-[11px] text-[#858585] animate-pulse">Waiting…</span>
          )}
        </div>

        {/* Response content */}
        <div className="flex-1 overflow-auto">
          {response?.error && (
            <div className="p-3">
              <div className="text-[#f97583] text-[12px] font-mono bg-[#2d1b1b] border border-[#5a1d1d] rounded p-3">
                Error: {response.error}
              </div>
            </div>
          )}
          {response && !response.error && respTab === 'body' && (
            <div className="relative">
              {response.truncated && (
                <div className="px-3 py-1 text-[11px] text-[#ff8c00] bg-[#2d2000] border-b border-[#3c3c3c]">
                  Response truncated at 5 MB
                </div>
              )}
              <pre className="p-3 text-[12px] font-mono text-[#d4d4d4] whitespace-pre-wrap break-all leading-relaxed">
                {response.body || '(empty body)'}
              </pre>
            </div>
          )}
          {response && !response.error && respTab === 'headers' && (
            <div className="p-2 space-y-0.5">
              {Object.entries(response.headers || {}).map(([k, v]) => (
                <div key={k} className="flex items-start gap-2 py-0.5 border-b border-[#2a2a2a]">
                  <span className="text-[11px] font-mono text-[#9cdcfe] flex-shrink-0 min-w-[140px]">{k}</span>
                  <span className="text-[11px] font-mono text-[#ce9178] break-all">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
          {!response && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-[#555] gap-2 pb-8">
              <Send size={22} className="opacity-30" />
              <span className="text-[12px]">Send a request to see the response</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
