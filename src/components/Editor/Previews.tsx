/**
 * Editor preview components — extracted from Editor.tsx.
 * Each component renders a specialised preview for a file type.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Code2, ExternalLink, RefreshCw, Eye } from 'lucide-react';
import { sanitizeHTML, sanitizeSVG } from '@/utils/sanitize';
import { isXmlFile, isYamlFile, isTomlFile } from './fileUtils';

// ── Image Preview ──
export const ImagePreview: React.FC<{ filePath: string }> = ({ filePath }) => {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [error, setError] = useState(false);

  useEffect(() => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    setImageSrc(`file:///${normalizedPath}`);
  }, [filePath]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
        <div className="text-center text-[#858585]">
          <p className="text-[14px] mb-2">Unable to preview this image</p>
          <p className="text-[12px]">{filePath}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-[#1e1e1e] overflow-auto p-4">
      <div className="text-center">
        <img
          src={imageSrc}
          alt={filePath.split(/[/\\]/).pop() || 'Image'}
          className="max-w-full max-h-[calc(100vh-200px)] object-contain rounded shadow-lg"
          onError={() => setError(true)}
          style={{ imageRendering: 'auto' }}
        />
        <p className="text-[11px] text-[#858585] mt-3">{filePath.split(/[/\\]/).pop()}</p>
      </div>
    </div>
  );
};

// ── Binary File Preview ──
export const BinaryPreview: React.FC<{ filePath: string; fileName: string }> = ({ filePath: _filePath, fileName }) => {
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toUpperCase() : 'BIN';
  return (
    <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
      <div className="text-center">
        <div className="text-[48px] mb-4 opacity-20">[ ]</div>
        <p className="text-[14px] text-[#cccccc]/50 mb-2">Binary File ({ext})</p>
        <p className="text-[12px] text-[#858585] mb-4">{fileName}</p>
        <p className="text-[11px] text-[#585858]">This file is not displayed in the editor because it is either binary or uses an unsupported encoding.</p>
      </div>
    </div>
  );
};

// ── HTML Preview ──
export const HtmlPreview: React.FC<{ content: string; filePath: string; onToggleCode: () => void }> = ({ content, filePath, onToggleCode }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [key, setKey] = useState(0);

  const resolvedContent = useMemo(() => {
    const dir = filePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
    if (content.includes('<head>')) {
      return content.replace('<head>', `<head><base href="file:///${dir}/">`);
    } else if (content.includes('<html')) {
      return content.replace(/(<html[^>]*>)/, `$1<head><base href="file:///${dir}/"></head>`);
    }
    return `<head><base href="file:///${dir}/"></head>${content}`;
  }, [content, filePath]);

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="h-[32px] bg-[#252526] border-b border-[#1e1e1e] flex items-center px-3 gap-2 flex-shrink-0">
        <Play size={12} className="text-[#89d185]" />
        <span className="text-[11px] text-[#89d185] font-medium">HTML Preview</span>
        <span className="text-[11px] text-[#585858] truncate">{filePath.split(/[/\\]/).pop()}</span>
        <div className="flex-1" />
        <button
          className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c] transition-colors"
          onClick={() => setKey(k => k + 1)}
          title="Refresh preview"
        >
          <RefreshCw size={12} />
        </button>
        <button
          className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c] transition-colors"
          onClick={() => {
            const blob = new Blob([content], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
          }}
          title="Open in external browser"
        >
          <ExternalLink size={12} />
        </button>
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c] transition-colors"
          onClick={onToggleCode}
          title="Back to code"
        >
          <Code2 size={12} />
          <span>Code</span>
        </button>
      </div>
      <div className="flex-1 min-h-0 bg-white">
        <iframe
          key={key}
          ref={iframeRef}
          srcDoc={resolvedContent}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title="HTML Preview"
        />
      </div>
    </div>
  );
};

// ── JSON Preview ──
export const JsonPreview: React.FC<{ content: string; filePath: string; onToggleCode: () => void }> = ({ content, filePath, onToggleCode }) => {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const parsed = useMemo(() => {
    try {
      return { data: JSON.parse(content), error: null };
    } catch (e: any) {
      return { data: null, error: e.message as string };
    }
  }, [content]);

  const togglePath = (path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const renderValue = (val: unknown, path: string, depth: number): React.ReactNode => {
    if (val === null) return <span className="text-[#569cd6]">null</span>;
    if (typeof val === 'boolean') return <span className="text-[#569cd6]">{String(val)}</span>;
    if (typeof val === 'number') return <span className="text-[#b5cea8]">{val}</span>;
    if (typeof val === 'string') return <span className="text-[#ce9178]">"{val.length > 500 ? val.slice(0, 500) + '…' : val}"</span>;
    if (Array.isArray(val)) {
      const isCol = collapsed.has(path);
      if (val.length === 0) return <span className="text-[#d4d4d4]">[]</span>;
      return (
        <span>
          <span className="cursor-pointer text-[#858585] hover:text-white select-none" onClick={() => togglePath(path)}>
            {isCol ? '▶' : '▼'}
          </span>
          {isCol ? (
            <span className="text-[#858585]"> [{val.length} items]</span>
          ) : (
            <span>
              {'[\n'}
              {val.map((item, i) => (
                <span key={i}>
                  {'  '.repeat(depth + 1)}
                  {renderValue(item, `${path}[${i}]`, depth + 1)}
                  {i < val.length - 1 ? ',' : ''}
                  {'\n'}
                </span>
              ))}
              {'  '.repeat(depth)}{']'}
            </span>
          )}
        </span>
      );
    }
    if (typeof val === 'object') {
      const entries = Object.entries(val as Record<string, unknown>);
      const isCol = collapsed.has(path);
      if (entries.length === 0) return <span className="text-[#d4d4d4]">{'{}'}</span>;
      return (
        <span>
          <span className="cursor-pointer text-[#858585] hover:text-white select-none" onClick={() => togglePath(path)}>
            {isCol ? '▶' : '▼'}
          </span>
          {isCol ? (
            <span className="text-[#858585]"> {'{'}…{entries.length} keys{'}'}</span>
          ) : (
            <span>
              {'{\n'}
              {entries.map(([k, v], i) => (
                <span key={k}>
                  {'  '.repeat(depth + 1)}
                  <span className="text-[#9cdcfe]">"{k}"</span>: {renderValue(v, `${path}.${k}`, depth + 1)}
                  {i < entries.length - 1 ? ',' : ''}
                  {'\n'}
                </span>
              ))}
              {'  '.repeat(depth)}{'}'}
            </span>
          )}
        </span>
      );
    }
    return <span className="text-[#d4d4d4]">{String(val)}</span>;
  };

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="h-[32px] bg-[#252526] border-b border-[#1e1e1e] flex items-center px-3 gap-2 flex-shrink-0">
        <Eye size={12} className="text-[#dcdcaa]" />
        <span className="text-[11px] text-[#dcdcaa] font-medium">JSON Preview</span>
        <span className="text-[11px] text-[#585858] truncate">{filePath.split(/[/\\]/).pop()}</span>
        <div className="flex-1" />
        <button className="px-2 py-0.5 text-[10px] text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c]"
          onClick={() => setCollapsed(new Set())} title="Expand all">Expand All</button>
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c] transition-colors"
          onClick={onToggleCode} title="Back to code"
        >
          <Code2 size={12} /><span>Code</span>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4 font-mono text-[13px] leading-[1.5]">
        {parsed.error ? (
          <div className="text-[#f48771]">
            <p className="font-bold mb-2">Invalid JSON</p>
            <p>{parsed.error}</p>
            <pre className="mt-4 text-[#d4d4d4] text-[12px] whitespace-pre-wrap">{content.slice(0, 2000)}</pre>
          </div>
        ) : (
          <pre className="whitespace-pre text-[#d4d4d4]">{renderValue(parsed.data, '$', 0)}</pre>
        )}
      </div>
    </div>
  );
};

// ── CSV Preview ──
export const CsvPreview: React.FC<{ content: string; filePath: string; onToggleCode: () => void }> = ({ content, filePath, onToggleCode }) => {
  const isTsv = filePath.toLowerCase().endsWith('.tsv');
  const delimiter = isTsv ? '\t' : ',';

  const { headers, rows } = useMemo(() => {
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length === 0) return { headers: [] as string[], rows: [] as string[][] };

    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && !inQuotes) { inQuotes = true; continue; }
        if (ch === '"' && inQuotes) {
          if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; continue; }
          inQuotes = false; continue;
        }
        if (ch === delimiter && !inQuotes) { result.push(current.trim()); current = ''; continue; }
        current += ch;
      }
      result.push(current.trim());
      return result;
    };

    const parsed = lines.map(parseLine);
    return { headers: parsed[0] || [], rows: parsed.slice(1) };
  }, [content, delimiter]);

  const [sortCol, setSortCol] = React.useState<number | null>(null);
  const [sortAsc, setSortAsc] = React.useState(true);

  const sortedRows = useMemo(() => {
    if (sortCol === null) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortCol] || '';
      const vb = b[sortCol] || '';
      const na = parseFloat(va), nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na;
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [rows, sortCol, sortAsc]);

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="h-[32px] bg-[#252526] border-b border-[#1e1e1e] flex items-center px-3 gap-2 flex-shrink-0">
        <Eye size={12} className="text-[#4ec9b0]" />
        <span className="text-[11px] text-[#4ec9b0] font-medium">{isTsv ? 'TSV' : 'CSV'} Table</span>
        <span className="text-[11px] text-[#585858] truncate">{filePath.split(/[/\\]/).pop()}</span>
        <span className="text-[10px] text-[#585858]">({rows.length} rows × {headers.length} cols)</span>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c] transition-colors"
          onClick={onToggleCode} title="Back to code"
        >
          <Code2 size={12} /><span>Code</span>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-[#252526] z-10">
            <tr>
              <th className="border border-[#3c3c3c] px-2 py-1 text-[#858585] text-[10px] font-normal w-10">#</th>
              {headers.map((h, i) => (
                <th key={i}
                  className="border border-[#3c3c3c] px-3 py-1.5 text-left text-[#cccccc] font-medium cursor-pointer hover:bg-[#3c3c3c] select-none whitespace-nowrap"
                  onClick={() => { if (sortCol === i) setSortAsc(!sortAsc); else { setSortCol(i); setSortAsc(true); } }}
                >
                  {h} {sortCol === i ? (sortAsc ? '▲' : '▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, ri) => (
              <tr key={ri} className="hover:bg-[#2a2d2e]">
                <td className="border border-[#3c3c3c] px-2 py-0.5 text-[#585858] text-center text-[10px]">{ri + 1}</td>
                {headers.map((_, ci) => (
                  <td key={ci} className="border border-[#3c3c3c] px-3 py-0.5 text-[#d4d4d4] whitespace-nowrap max-w-[300px] truncate">
                    {row[ci] || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="text-center text-[#858585] py-8 text-[13px]">No data rows found</div>
        )}
      </div>
    </div>
  );
};

// ── Data Preview (YAML, TOML, XML) ──
export const DataPreview: React.FC<{ content: string; filePath: string; onToggleCode: () => void }> = ({ content, filePath, onToggleCode }) => {
  const label = isYamlFile(filePath) ? 'YAML' : isTomlFile(filePath) ? 'TOML' : 'XML';
  const color = isYamlFile(filePath) ? '#ce9178' : isTomlFile(filePath) ? '#b5cea8' : '#569cd6';

  const highlighted = useMemo(() => {
    if (isXmlFile(filePath)) {
      return content
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/(&lt;\/?)([\w:-]+)/g, '$1<span style="color:#569cd6">$2</span>')
        .replace(/([\w:-]+)(=)/g, '<span style="color:#9cdcfe">$1</span>$2')
        .replace(/(["'][^"']*["'])/g, '<span style="color:#ce9178">$1</span>')
        .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span style="color:#6a9955">$1</span>');
    }
    if (isYamlFile(filePath)) {
      return content.split('\n').map(line => {
        return line
          .replace(/^(\s*)(#.*)$/gm, '$1<span style="color:#6a9955">$2</span>')
          .replace(/^(\s*)([\w.-]+)(:)/gm, '$1<span style="color:#9cdcfe">$2</span><span style="color:#d4d4d4">$3</span>')
          .replace(/(:\s+)(true|false|null|~)(\s*$)/gi, '$1<span style="color:#569cd6">$2</span>$3')
          .replace(/(:\s+)(\d+\.?\d*)(\s*$)/g, '$1<span style="color:#b5cea8">$2</span>$3')
          .replace(/(["'][^"']*["'])/g, '<span style="color:#ce9178">$1</span>');
      }).join('\n');
    }
    return content.split('\n').map(line => {
      return line
        .replace(/^(\s*)(#.*)$/gm, '$1<span style="color:#6a9955">$2</span>')
        .replace(/^(\s*)(\[+[\w."-]+\]+)/gm, '$1<span style="color:#569cd6">$2</span>')
        .replace(/^(\s*)([\w.-]+)(\s*=)/gm, '$1<span style="color:#9cdcfe">$2</span>$3')
        .replace(/(=\s*)(true|false)(\s*$)/gi, '$1<span style="color:#569cd6">$2</span>$3')
        .replace(/(=\s*)(\d+\.?\d*)(\s*$)/g, '$1<span style="color:#b5cea8">$2</span>$3')
        .replace(/(["'][^"']*["'])/g, '<span style="color:#ce9178">$1</span>');
    }).join('\n');
  }, [content, filePath]);

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="h-[32px] bg-[#252526] border-b border-[#1e1e1e] flex items-center px-3 gap-2 flex-shrink-0">
        <Eye size={12} style={{ color }} />
        <span className="text-[11px] font-medium" style={{ color }}>{label} Preview</span>
        <span className="text-[11px] text-[#585858] truncate">{filePath.split(/[/\\]/).pop()}</span>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c] transition-colors"
          onClick={onToggleCode} title="Back to code"
        >
          <Code2 size={12} /><span>Code</span>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <pre className="text-[13px] leading-[1.6] font-mono text-[#d4d4d4] whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: sanitizeHTML(highlighted) }}
        />
      </div>
    </div>
  );
};

// ── Markdown Preview ──
export const MarkdownPreview: React.FC<{ content: string; filePath: string; onToggleCode: () => void }> = ({ content, filePath, onToggleCode }) => {
  const mdToHtml = useMemo(() => {
    let html = content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
        `<pre class="code-block"><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`)
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
      .replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
      .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
      .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
      .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
      .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^---$/gm, '<hr/>')
      .replace(/^\*\*\*$/gm, '<hr/>')
      .replace(/^[\*\-]\s+(.*)$/gm, '<li>$1</li>')
      .replace(/^\d+\.\s+(.*)$/gm, '<li>$1</li>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%"/>')
      .replace(/\n\n+/g, '</p><p>')
      .replace(/\n/g, '<br/>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?=\s*(?:<li>|$))/g, '$1');
    html = html.replace(/((?:<li>[\s\S]*?<\/li>\s*)+)/g, '<ul>$1</ul>');

    const css = `
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #cccccc; background: #1e1e1e; padding: 24px 32px; line-height: 1.6; max-width: 900px; margin: 0 auto; }
      h1, h2, h3, h4, h5, h6 { color: #e0e0e0; margin: 1.2em 0 0.6em; border-bottom: 1px solid #333; padding-bottom: 0.3em; }
      h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
      h4, h5, h6 { border-bottom: none; }
      a { color: #4fc1ff; text-decoration: none; } a:hover { text-decoration: underline; }
      code.inline-code { background: #2d2d2d; color: #d7ba7d; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
      pre.code-block { background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 16px; overflow-x: auto; margin: 1em 0; }
      pre.code-block code { color: #d4d4d4; font-family: 'Consolas', 'Fira Code', monospace; font-size: 13px; }
      blockquote { border-left: 4px solid #007acc; margin: 1em 0; padding: 8px 16px; color: #999; background: #252526; border-radius: 0 4px 4px 0; }
      ul, ol { padding-left: 24px; } li { margin: 4px 0; }
      hr { border: none; border-top: 1px solid #333; margin: 2em 0; }
      img { border-radius: 4px; margin: 1em 0; }
      del { color: #858585; }
      strong { color: #e0e0e0; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
      th { background: #252526; }
    `;
    return `<!DOCTYPE html><html><head><style>${css}</style></head><body>${html}</body></html>`;
  }, [content]);

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="h-[32px] bg-[#252526] border-b border-[#1e1e1e] flex items-center px-3 gap-2 flex-shrink-0">
        <Eye size={12} className="text-[#4fc1ff]" />
        <span className="text-[11px] text-[#4fc1ff] font-medium">Markdown Preview</span>
        <span className="text-[11px] text-[#585858] truncate">{filePath.split(/[/\\]/).pop()}</span>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c] transition-colors"
          onClick={onToggleCode}
          title="Back to code"
        >
          <Code2 size={12} />
          <span>Code</span>
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <iframe
          srcDoc={mdToHtml}
          className="w-full h-full border-0"
          sandbox="allow-same-origin"
          title="Markdown Preview"
        />
      </div>
    </div>
  );
};

// ── SVG Preview ──
export const SvgPreview: React.FC<{ content: string; filePath: string; onToggleCode: () => void }> = ({ content, filePath, onToggleCode }) => {
  const [zoom, setZoom] = React.useState(1);
  const [bgColor, setBgColor] = React.useState('#1e1e1e');

  const safeSvg = useMemo(() => {
    return sanitizeSVG(content);
  }, [content]);

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      <div className="h-[32px] bg-[#252526] border-b border-[#1e1e1e] flex items-center px-3 gap-2 flex-shrink-0">
        <Eye size={12} className="text-[#c586c0]" />
        <span className="text-[11px] text-[#c586c0] font-medium">SVG Preview</span>
        <span className="text-[11px] text-[#585858] truncate">{filePath.split(/[/\\]/).pop()}</span>
        <div className="flex-1" />
        <button
          className="px-1 text-[11px] text-[#858585] hover:text-white"
          onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
          title="Zoom out"
        >−</button>
        <span className="text-[10px] text-[#858585] min-w-[30px] text-center">{Math.round(zoom * 100)}%</span>
        <button
          className="px-1 text-[11px] text-[#858585] hover:text-white"
          onClick={() => setZoom(z => Math.min(4, z + 0.25))}
          title="Zoom in"
        >+</button>
        <button
          className="px-1 text-[10px] text-[#858585] hover:text-white"
          onClick={() => setZoom(1)}
          title="Reset zoom"
        >1:1</button>
        <select
          className="bg-[#3c3c3c] text-[10px] text-[#cccccc] rounded px-1 py-0.5 outline-none border-none"
          value={bgColor}
          onChange={e => setBgColor(e.target.value)}
          title="Background color"
        >
          <option value="#1e1e1e">Dark</option>
          <option value="#ffffff">White</option>
          <option value="#808080">Gray</option>
          <option value="transparent">Checkerboard</option>
        </select>
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-[#858585] hover:text-white rounded hover:bg-[#3c3c3c] transition-colors"
          onClick={onToggleCode}
          title="Back to code"
        >
          <Code2 size={12} />
          <span>Code</span>
        </button>
      </div>
      <div
        className="flex-1 min-h-0 overflow-auto flex items-center justify-center"
        style={{
          backgroundColor: bgColor === 'transparent' ? undefined : bgColor,
          backgroundImage: bgColor === 'transparent'
            ? 'repeating-conic-gradient(#333 0% 25%, #2a2a2a 0% 50%)'
            : undefined,
          backgroundSize: bgColor === 'transparent' ? '16px 16px' : undefined,
        }}
      >
        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
          dangerouslySetInnerHTML={{ __html: safeSvg }}
        />
      </div>
    </div>
  );
};

// ── Welcome Screen ──
export const WelcomeScreen: React.FC = () => {
  const [recentFolders] = React.useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('recent-folders') || '[]') as string[];
    } catch { return []; }
  });
  const [showAllRecent, setShowAllRecent] = React.useState(false);

  return (
    <div className="h-full flex flex-col items-center justify-center bg-[#1e1e1e] px-8 overflow-auto py-8">
      {/* Logo + heading */}
      <div className="flex flex-col items-center mb-8">
        <img src="zzz.png" alt="guIDE" className="w-16 h-16 mb-4 opacity-30" draggable={false} />
        <h1 className="text-[28px] text-[#cccccc]/40 font-light brand-font mb-1">guIDE</h1>
        <p className="text-[12px] text-[#585858]">AI-Powered IDE</p>
      </div>



      {/* Open Recent */}
      {recentFolders.length > 0 && (
        <div className="w-full max-w-[320px] mb-6">
          <p className="text-[10px] text-[#585858] uppercase tracking-widest mb-2 text-center">Recent</p>
          <div className="space-y-0.5">
            {(showAllRecent ? recentFolders : recentFolders.slice(0, 3)).map((folder) => {
              const parts = folder.replace(/\\/g, '/').split('/');
              const name = parts[parts.length - 1] || folder;
              const parent = parts.slice(-3, -1).join('/');
              return (
                <button
                  key={folder}
                  className="w-full text-left px-3 py-2 rounded hover:bg-[#2d2d2d] transition-colors group"
                  onClick={() => window.dispatchEvent(new CustomEvent('app-action', { detail: { action: 'open-recent', path: folder } }))}
                >
                  <div className="text-[12px] text-[#cccccc] truncate group-hover:text-white">{name}</div>
                  {parent && <div className="text-[10px] text-[#585858] truncate">{parent}</div>}
                </button>
              );
            })}
            {recentFolders.length > 3 && (
              <button
                className="w-full text-left px-3 py-1 text-[10px] text-[#858585] hover:text-[#cccccc] transition-colors"
                onClick={() => setShowAllRecent(!showAllRecent)}
              >
                {showAllRecent ? 'See less' : `See ${recentFolders.length - 3} more…`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Keyboard hints */}
      <div className="text-[12px] text-[#858585] space-y-1.5 text-center">
        <p className="flex items-center justify-center gap-2">
          <kbd className="bg-[#3c3c3c] px-1.5 py-0.5 rounded text-[11px]">Ctrl+N</kbd>
          <span>New file</span>
        </p>
        <p className="flex items-center justify-center gap-2">
          <kbd className="bg-[#3c3c3c] px-1.5 py-0.5 rounded text-[11px]">Ctrl+Shift+P</kbd>
          <span>Command palette</span>
        </p>
        <p className="flex items-center justify-center gap-2">
          <kbd className="bg-[#3c3c3c] px-1.5 py-0.5 rounded text-[11px]">Ctrl+`</kbd>
          <span>Toggle terminal</span>
        </p>
      </div>

      <div className="mt-6 text-[11px] text-[#858585]/50">
        AI-powered • Local LLM • RAG • Web Search
      </div>
    </div>
  );
};
