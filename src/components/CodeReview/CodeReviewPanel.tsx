/**
 * guIDE — AI-Powered Offline IDE
 * AI Code Review Panel
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
import React, { useState, useCallback } from 'react';
import {
  Shield, FileCode, GitBranch, Loader, AlertTriangle, AlertCircle,
  Info, CheckCircle, ChevronDown, ChevronRight, Wrench, X, Eye,
  ClipboardCheck,
} from 'lucide-react';

interface ReviewFinding {
  id: string;
  severity: 'critical' | 'warning' | 'suggestion';
  line: number | null;
  file?: string | null;
  title: string;
  description: string;
  fix: string | null;
}

interface CodeReviewPanelProps {
  rootPath: string;
  currentFile?: string;
  onFileClick?: (filePath: string, line?: number) => void;
}

export const CodeReviewPanel: React.FC<CodeReviewPanelProps> = ({ rootPath: _rootPath, currentFile, onFileClick }) => {
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [rawReview, setRawReview] = useState('');
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewType, setReviewType] = useState<'file' | 'staged' | ''>('');
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());
  const [applyingFix, setApplyingFix] = useState<string>('');
  const [error, setError] = useState('');
  const [reviewedFile, setReviewedFile] = useState('');
  const [truncated, setTruncated] = useState(false);

  const api = window.electronAPI;

  const getCloudParams = () => ({
    cloudProvider: localStorage.getItem('guIDE-cloud-provider') || '',
    cloudModel: localStorage.getItem('guIDE-cloud-model') || '',
  });

  // ── Review current file ──
  const reviewCurrentFile = useCallback(async () => {
    if (!currentFile) {
      setError('No file is currently open');
      return;
    }
    setIsReviewing(true);
    setReviewType('file');
    setError('');
    setFindings([]);
    setRawReview('');
    setReviewedFile(currentFile);
    setExpandedFindings(new Set());

    try {
      const result = await api.codeReviewFile({
        filePath: currentFile,
        ...getCloudParams(),
      });
      if (result.success) {
        setFindings(result.findings || []);
        setRawReview(result.rawReview || '');
        setTruncated(result.truncated || false);
        // Auto-expand critical findings
        const criticals = new Set((result.findings || []).filter((f: ReviewFinding) => f.severity === 'critical').map((f: ReviewFinding) => f.id));
        setExpandedFindings(criticals);
      } else {
        setError(result.error || 'Review failed');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setIsReviewing(false);
  }, [currentFile]);

  // ── Review staged changes ──
  const reviewStagedChanges = useCallback(async () => {
    setIsReviewing(true);
    setReviewType('staged');
    setError('');
    setFindings([]);
    setRawReview('');
    setReviewedFile('');
    setExpandedFindings(new Set());

    try {
      const result = await api.codeReviewStaged(getCloudParams());
      if (result.success) {
        setFindings(result.findings || []);
        setRawReview(result.rawReview || '');
        setTruncated(result.truncated || false);
        const criticals = new Set((result.findings || []).filter((f: ReviewFinding) => f.severity === 'critical').map((f: ReviewFinding) => f.id));
        setExpandedFindings(criticals);
      } else {
        setError(result.error || 'Review failed');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setIsReviewing(false);
  }, []);

  // ── Apply fix ──
  const applyFix = useCallback(async (finding: ReviewFinding) => {
    const targetFile = finding.file || reviewedFile;
    if (!targetFile || !finding.fix) return;

    setApplyingFix(finding.id);
    try {
      const result = await api.codeReviewApplyFix({
        filePath: targetFile,
        line: finding.line,
        fix: finding.fix,
        ...getCloudParams(),
      });
      if (result.success) {
        // Mark as applied visually
        setFindings(prev => prev.map(f =>
          f.id === finding.id ? { ...f, title: `✓ ${f.title} (Applied)` } : f
        ));
      } else {
        setError(result.error || 'Failed to apply fix');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setApplyingFix('');
  }, [reviewedFile]);

  // ── Toggle finding expand ──
  const toggleFinding = (id: string) => {
    setExpandedFindings(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Severity helpers ──
  const severityIcon = (s: string) => {
    switch (s) {
      case 'critical': return <AlertCircle size={14} style={{ color: '#f44336' }} />;
      case 'warning': return <AlertTriangle size={14} style={{ color: '#ff9800' }} />;
      case 'suggestion': return <Info size={14} style={{ color: '#4fc1ff' }} />;
      default: return <Info size={14} />;
    }
  };

  const severityColor = (s: string) => {
    switch (s) {
      case 'critical': return '#f44336';
      case 'warning': return '#ff9800';
      case 'suggestion': return '#4fc1ff';
      default: return 'var(--theme-foreground-muted)';
    }
  };

  const severityCounts = {
    critical: findings.filter(f => f.severity === 'critical').length,
    warning: findings.filter(f => f.severity === 'warning').length,
    suggestion: findings.filter(f => f.severity === 'suggestion').length,
  };

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Header with actions */}
      <div className="flex flex-col gap-2 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
        <div className="flex items-center gap-2">
          <Shield size={16} style={{ color: 'var(--theme-accent)' }} />
          <span className="font-semibold text-[13px]">AI Code Review</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reviewCurrentFile}
            disabled={isReviewing || !currentFile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--theme-accent)', color: '#fff' }}
            title={currentFile ? `Review ${currentFile.split(/[\/\\]/).pop()}` : 'No file open'}
          >
            {isReviewing && reviewType === 'file' ? <Loader size={12} className="animate-spin" /> : <FileCode size={12} />}
            Review File
          </button>
          <button
            onClick={reviewStagedChanges}
            disabled={isReviewing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }}
          >
            {isReviewing && reviewType === 'staged' ? <Loader size={12} className="animate-spin" /> : <GitBranch size={12} />}
            Review Staged
          </button>
        </div>
        {currentFile && (
          <div className="text-[10px] truncate" style={{ color: 'var(--theme-foreground-muted)' }}>
            Current: {currentFile.split(/[\/\\]/).pop()}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]" style={{ backgroundColor: '#5a1d1d', color: '#f48771' }}>
          <AlertTriangle size={12} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}><X size={12} /></button>
        </div>
      )}

      {/* Review loading */}
      {isReviewing && (
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <Loader size={24} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
          <span className="text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
            Analyzing code{reviewType === 'file' ? ` — ${reviewedFile.split(/[\/\\]/).pop()}` : ' — staged changes'}...
          </span>
        </div>
      )}

      {/* Results summary */}
      {!isReviewing && findings.length > 0 && (
        <>
          <div className="flex items-center gap-3 px-3 py-2 flex-shrink-0" style={{ backgroundColor: 'var(--theme-bg-secondary)', borderBottom: '1px solid var(--theme-border)' }}>
            <ClipboardCheck size={14} style={{ color: 'var(--theme-accent)' }} />
            <span className="font-semibold">{findings.length} issue{findings.length !== 1 ? 's' : ''} found</span>
            <div className="flex items-center gap-2 ml-auto text-[10px]">
              {severityCounts.critical > 0 && (
                <span className="flex items-center gap-0.5" style={{ color: '#f44336' }}>
                  <AlertCircle size={10} /> {severityCounts.critical}
                </span>
              )}
              {severityCounts.warning > 0 && (
                <span className="flex items-center gap-0.5" style={{ color: '#ff9800' }}>
                  <AlertTriangle size={10} /> {severityCounts.warning}
                </span>
              )}
              {severityCounts.suggestion > 0 && (
                <span className="flex items-center gap-0.5" style={{ color: '#4fc1ff' }}>
                  <Info size={10} /> {severityCounts.suggestion}
                </span>
              )}
            </div>
          </div>
          {truncated && (
            <div className="px-3 py-1 text-[10px]" style={{ color: '#ff9800', backgroundColor: 'var(--theme-bg-secondary)' }}>
              ⚠ File was truncated for review — some issues may not be detected
            </div>
          )}
        </>
      )}

      {/* No issues found */}
      {!isReviewing && findings.length === 0 && reviewType && !rawReview && !error && (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <CheckCircle size={32} style={{ color: '#4ec9b0' }} />
          <span className="text-[12px] font-semibold" style={{ color: '#4ec9b0' }}>No issues found</span>
          <span className="text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>Code looks good!</span>
        </div>
      )}

      {/* Raw review fallback */}
      {!isReviewing && rawReview && findings.length === 0 && (
        <div className="flex-1 overflow-auto p-3">
          <div className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--theme-foreground)' }}>
            {rawReview}
          </div>
        </div>
      )}

      {/* Findings list */}
      {!isReviewing && findings.length > 0 && (
        <div className="flex-1 overflow-auto">
          {findings.map(finding => (
            <div key={finding.id} style={{ borderBottom: '1px solid var(--theme-border)' }}>
              {/* Finding header */}
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-90 transition-opacity"
                style={{ backgroundColor: expandedFindings.has(finding.id) ? 'var(--theme-bg-secondary)' : 'transparent' }}
                onClick={() => toggleFinding(finding.id)}
              >
                {expandedFindings.has(finding.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {severityIcon(finding.severity)}
                <span className="flex-1 truncate text-[11px]">{finding.title}</span>
                {finding.line && (
                  <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)' }}>
                    L{finding.line}
                  </span>
                )}
                {finding.file && !reviewedFile && (
                  <span className="text-[10px] flex-shrink-0 truncate max-w-[100px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                    {finding.file.split(/[\/\\]/).pop()}
                  </span>
                )}
              </button>

              {/* Finding details */}
              {expandedFindings.has(finding.id) && (
                <div className="px-3 pb-3 pt-1 ml-6" style={{ borderLeft: `2px solid ${severityColor(finding.severity)}` }}>
                  <p className="text-[11px] leading-relaxed mb-2" style={{ color: 'var(--theme-foreground)' }}>
                    {finding.description}
                  </p>

                  {/* Fix suggestion */}
                  {finding.fix && (
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold mb-1" style={{ color: '#4ec9b0' }}>
                        Suggested Fix:
                      </div>
                      <pre className="text-[11px] font-mono p-2 rounded overflow-auto max-h-[200px]"
                           style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)', whiteSpace: 'pre-wrap' }}>
                        {finding.fix}
                      </pre>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-2">
                    {finding.line && (reviewedFile || finding.file) && onFileClick && (
                      <button
                        onClick={() => onFileClick(finding.file || reviewedFile, finding.line!)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px]"
                        style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)', color: 'var(--theme-foreground)' }}
                      >
                        <Eye size={10} /> Go to Line
                      </button>
                    )}
                    {finding.fix && (reviewedFile || finding.file) && (
                      <button
                        onClick={() => applyFix(finding)}
                        disabled={applyingFix === finding.id}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] disabled:opacity-50"
                        style={{ backgroundColor: '#388e3c', color: '#fff' }}
                      >
                        {applyingFix === finding.id ? <Loader size={10} className="animate-spin" /> : <Wrench size={10} />}
                        Apply Fix
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isReviewing && !reviewType && findings.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
          <Shield size={48} style={{ color: 'var(--theme-foreground-muted)', opacity: 0.3 }} />
          <p className="text-[11px] text-center leading-relaxed" style={{ color: 'var(--theme-foreground-muted)' }}>
            AI-powered code review analyzes your code for bugs, security issues, performance problems, and best practices.
          </p>
          <p className="text-[10px] text-center" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.6 }}>
            Open a file and click "Review File", or review staged git changes before committing.
          </p>
        </div>
      )}
    </div>
  );
};
