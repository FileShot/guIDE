import React, { useState, useCallback } from 'react';
import { FileText, BookOpen, Globe, GitBranch as ArchDiagram, Sparkles, Copy, Download, Check, Loader2 } from 'lucide-react';

type TabId = 'file' | 'readme' | 'api' | 'architecture' | 'overview';

export const DocsPanel: React.FC<{
  rootPath: string;
  currentFile: string;
  onApplyCode?: (filePath: string, code: string) => void;
}> = ({ rootPath, currentFile, onApplyCode }) => {
  const [tab, setTab] = useState<TabId>('file');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultMeta, setResultMeta] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const api = (window as any).electronAPI;

  const generateFileDocs = useCallback(async () => {
    if (!currentFile) {
      setError('No file is currently open');
      return;
    }
    setIsGenerating(true);
    setError('');
    setResult(null);
    try {
      const res = await api.docsGenerateFile({ filePath: currentFile });
      if (res.success) {
        setResult(res.documentedCode || '');
        setResultMeta({ type: 'file', filePath: res.filePath, docStyle: res.docStyle });
      } else {
        setError(res.error || 'Failed to generate documentation');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsGenerating(false);
    }
  }, [currentFile, api]);

  const generateReadme = useCallback(async () => {
    if (!rootPath) {
      setError('No project open');
      return;
    }
    setIsGenerating(true);
    setError('');
    setResult(null);
    try {
      const res = await api.docsGenerateReadme({ rootPath });
      if (res.success) {
        setResult(res.readme || '');
        setResultMeta({ type: 'readme', projectName: res.projectName, projectTypes: res.projectTypes });
      } else {
        setError(res.error || 'Failed to generate README');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsGenerating(false);
    }
  }, [rootPath, api]);

  const generateApiDocs = useCallback(async () => {
    if (!rootPath) {
      setError('No project open');
      return;
    }
    setIsGenerating(true);
    setError('');
    setResult(null);
    try {
      const res = await api.docsGenerateApi({ rootPath });
      if (res.success) {
        setResult(res.apiDocs || '');
        setResultMeta({ type: 'api', routeFilesFound: res.routeFilesFound });
      } else {
        setError(res.error || 'Failed to generate API docs');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsGenerating(false);
    }
  }, [rootPath, api]);

  const generateArchitecture = useCallback(async () => {
    if (!rootPath) {
      setError('No project open');
      return;
    }
    setIsGenerating(true);
    setError('');
    setResult(null);
    try {
      const res = await api.docsGenerateArchitecture({ rootPath });
      if (res.success) {
        setResult(res.markdown || '');
        setResultMeta({ type: 'architecture', diagrams: res.mermaidDiagrams, projectName: res.projectName });
      } else {
        setError(res.error || 'Failed to generate architecture diagram');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsGenerating(false);
    }
  }, [rootPath, api]);

  const generateOverview = useCallback(async () => {
    if (!rootPath) {
      setError('No project open');
      return;
    }
    setIsGenerating(true);
    setError('');
    setResult(null);
    try {
      const res = await api.docsExplainCodebase({ rootPath });
      if (res.success) {
        setResult(res.overview || '');
        setResultMeta({ type: 'overview', projectName: res.projectName, fileCount: res.fileCount });
      } else {
        setError(res.error || 'Failed to generate overview');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsGenerating(false);
    }
  }, [rootPath, api]);

  const handleGenerate = useCallback(() => {
    switch (tab) {
      case 'file': generateFileDocs(); break;
      case 'readme': generateReadme(); break;
      case 'api': generateApiDocs(); break;
      case 'architecture': generateArchitecture(); break;
      case 'overview': generateOverview(); break;
    }
  }, [tab, generateFileDocs, generateReadme, generateApiDocs, generateArchitecture, generateOverview]);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [result]);

  const handleApply = useCallback(async () => {
    if (!result || !resultMeta) return;

    if (resultMeta.type === 'file' && resultMeta.filePath && onApplyCode) {
      // Apply documented code to the current file
      onApplyCode(resultMeta.filePath, result);
    } else {
      // Save to file
      let fileName = 'output.md';
      if (resultMeta.type === 'readme') fileName = 'README.md';
      else if (resultMeta.type === 'api') fileName = 'API_DOCS.md';
      else if (resultMeta.type === 'architecture') fileName = 'ARCHITECTURE.md';
      else if (resultMeta.type === 'overview') fileName = 'CODEBASE_OVERVIEW.md';

      try {
        const savePath = rootPath ? `${rootPath}/${fileName}` : fileName;
        await api.writeFile(savePath, result);
        setError('');
      } catch (e: any) {
        setError(`Failed to save: ${e.message}`);
      }
    }
  }, [result, resultMeta, rootPath, api, onApplyCode]);

  const tabs: { id: TabId; label: string; icon: React.ElementType; description: string }[] = [
    { id: 'file', label: 'File', icon: FileText, description: 'Add JSDoc/docstrings to current file' },
    { id: 'readme', label: 'README', icon: BookOpen, description: 'Generate README.md' },
    { id: 'api', label: 'API', icon: Globe, description: 'Generate API documentation' },
    { id: 'architecture', label: 'Arch', icon: ArchDiagram, description: 'Architecture diagram (Mermaid)' },
    { id: 'overview', label: 'Explain', icon: Sparkles, description: 'Explain this codebase' },
  ];

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Tab bar */}
      <div className="flex border-b overflow-x-auto" style={{ borderColor: 'var(--theme-sidebar-border)' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            className="flex items-center gap-1 px-2 py-1.5 text-[10px] transition-colors whitespace-nowrap"
            style={{
              color: tab === t.id ? 'var(--theme-foreground)' : 'var(--theme-foreground-muted)',
              borderBottom: tab === t.id ? '2px solid var(--theme-accent)' : '2px solid transparent',
            }}
            onClick={() => { setTab(t.id); setResult(null); setError(''); }}
            title={t.description}
          >
            <t.icon size={12} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Description */}
        <div className="text-[11px] p-2 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground-muted)' }}>
          {tabs.find(t => t.id === tab)?.description}
          {tab === 'file' && currentFile && (
            <div className="mt-1 font-mono text-[10px] truncate" style={{ color: 'var(--theme-accent)' }}>
              {currentFile.split(/[\/\\]/).pop()}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="p-2 rounded text-[11px]" style={{ backgroundColor: 'rgba(255,80,80,0.15)', color: '#ff5050' }}>
            {error}
          </div>
        )}

        {/* Generate button */}
        <button
          className="w-full flex items-center justify-center gap-2 py-2 rounded text-[12px] transition-colors"
          style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
          onClick={handleGenerate}
          disabled={isGenerating || (tab === 'file' && !currentFile)}
        >
          {isGenerating ? (
            <><Loader2 size={14} className="animate-spin" /> Generating...</>
          ) : (
            <><Sparkles size={14} /> Generate {tabs.find(t => t.id === tab)?.label} Docs</>
          )}
        </button>

        {/* Results */}
        {result && (
          <div className="space-y-2">
            {/* Action bar */}
            <div className="flex gap-1">
              <button
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors"
                style={{ backgroundColor: 'rgba(78,201,176,0.15)', color: '#4ec9b0', border: '1px solid rgba(78,201,176,0.3)' }}
                onClick={handleCopy}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors"
                style={{ backgroundColor: 'rgba(0,122,204,0.15)', color: 'var(--theme-accent)', border: '1px solid rgba(0,122,204,0.3)' }}
                onClick={handleApply}
              >
                <Download size={12} />
                {resultMeta?.type === 'file' ? 'Apply to File' : 'Save to Project'}
              </button>
            </div>

            {/* Meta info */}
            {resultMeta && (
              <div className="text-[10px] space-x-2" style={{ color: 'var(--theme-foreground-muted)' }}>
                {resultMeta.docStyle && <span>Style: {resultMeta.docStyle}</span>}
                {resultMeta.routeFilesFound !== undefined && <span>Route files found: {resultMeta.routeFilesFound}</span>}
                {resultMeta.fileCount !== undefined && <span>Files analyzed: {resultMeta.fileCount}</span>}
              </div>
            )}

            {/* Content preview */}
            <div
              className="p-3 rounded border overflow-auto font-mono text-[11px] leading-relaxed"
              style={{
                backgroundColor: 'var(--theme-bg-secondary)',
                borderColor: 'var(--theme-border)',
                maxHeight: '500px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {result}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!result && !isGenerating && !error && (
          <div className="text-center py-8 text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
            <FileText size={24} className="mx-auto mb-2 opacity-30" />
            <div>
              {tab === 'file' && 'Generate JSDoc/TSDoc/docstrings for your code'}
              {tab === 'readme' && 'Auto-generate a professional README.md'}
              {tab === 'api' && 'Extract API docs from Express/FastAPI routes'}
              {tab === 'architecture' && 'Generate Mermaid architecture diagrams'}
              {tab === 'overview' && 'Get a comprehensive codebase explanation'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
