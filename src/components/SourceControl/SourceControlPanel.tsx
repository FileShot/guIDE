import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Plus, Minus, RotateCcw, Check, ChevronDown, ChevronRight,
  FileText, FilePlus, FileX, FileEdit, RefreshCw, GitCommit, FolderGit2,
  Sparkles, ArrowUp, ArrowDown, Download, GitMerge, Trash2, AlertTriangle,
  Eye, Loader, History, X,
} from 'lucide-react';

interface GitFile {
  path: string;
  status: string;
  staged: boolean;
}

interface GitBranchInfo {
  name: string;
  current: boolean;
}

interface SourceControlPanelProps {
  rootPath: string;
  onFileClick: (filePath: string) => void;
}

const statusColors: Record<string, string> = {
  modified: 'text-[#e2c08d]',
  added: 'text-[#89d185]',
  deleted: 'text-[#f14c4c]',
  renamed: 'text-[#4fc1ff]',
  untracked: 'text-[#73c991]',
};

const statusLetters: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  const size = 14;
  switch (status) {
    case 'modified': return <FileEdit size={size} className={statusColors.modified} />;
    case 'added': return <FilePlus size={size} className={statusColors.added} />;
    case 'deleted': return <FileX size={size} className={statusColors.deleted} />;
    case 'untracked': return <FilePlus size={size} className={statusColors.untracked} />;
    default: return <FileText size={size} className="text-[#858585]" />;
  }
};

export const SourceControlPanel: React.FC<SourceControlPanelProps> = ({ rootPath, onFileClick }) => {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [branch, setBranch] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [isRepo, setIsRepo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showStaged, setShowStaged] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [showBranches, setShowBranches] = useState(false);
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState('');
  const [generatingMsg, setGeneratingMsg] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [showMerge, setShowMerge] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [commitHistory, setCommitHistory] = useState<{ hash: string; message: string }[]>([]);
  const [explainResult, setExplainResult] = useState<{ hash: string; text: string } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [mergeState, setMergeState] = useState<{ inMerge: boolean; conflictFiles: string[] }>({ inMerge: false, conflictFiles: [] });
  const [resolvingFile, setResolvingFile] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const api = window.electronAPI;

  const refresh = useCallback(async () => {
    if (!api || !rootPath) return;
    setLoading(true);
    try {
      const status = await api.gitStatus();
      if (status.error && !status.branch) {
        setIsRepo(false);
        setFiles([]);
        setBranch('');
      } else {
        setIsRepo(true);
        setFiles(status.files || []);
        setBranch(status.branch || '');
      }
      const ab = await api.gitAheadBehind();
      setAhead(ab.ahead || 0);
      setBehind(ab.behind || 0);
      // Check merge conflict state
      const ms = await api.gitMergeState?.() || { inMerge: false, conflictFiles: [] };
      setMergeState(ms);
    } catch {
      setIsRepo(false);
    }
    setLoading(false);
  }, [api, rootPath]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000); // Auto-refresh every 5s
    return () => clearInterval(interval);
  }, [refresh]);

  const stagedFiles = files.filter(f => f.staged);
  const changedFiles = files.filter(f => !f.staged);

  const stageFile = async (filePath: string) => {
    await api?.gitStage(filePath);
    refresh();
  };

  const unstageFile = async (filePath: string) => {
    await api?.gitUnstage(filePath);
    refresh();
  };

  const discardFile = async (filePath: string) => {
    if (!confirm(`Discard changes to ${filePath.split(/[/\\]/).pop()}?`)) return;
    await api?.gitDiscard(filePath);
    refresh();
  };

  const stageAll = async () => {
    await api?.gitStageAll();
    refresh();
  };

  const unstageAll = async () => {
    await api?.gitUnstageAll();
    refresh();
  };

  const commit = async () => {
    if (!commitMsg.trim()) return;
    const result = await api?.gitCommit(commitMsg);
    if (result?.success) {
      setCommitMsg('');
      refresh();
    }
  };

  const initRepo = async () => {
    const result = await api?.gitInit();
    if (result?.success) {
      refresh();
    }
  };

  const switchBranch = async (branchName: string) => {
    await api?.gitCheckout(branchName);
    setShowBranches(false);
    refresh();
  };

  // ─── AI: Generate commit message ─────────────────────────────────
  const generateCommitMessage = async () => {
    setGeneratingMsg(true);
    setActionError('');
    try {
      const cloudProvider = localStorage.getItem('guIDE-cloudProvider') || '';
      const cloudModel = localStorage.getItem('guIDE-cloudModel') || '';
      const result = await api?.gitAiCommitMessage?.({
        ...(cloudProvider && cloudModel ? { cloudProvider, cloudModel } : {}),
      });
      if (result?.success && result.message) {
        setCommitMsg(result.message);
      } else {
        setActionError(result?.error || 'Failed to generate commit message');
      }
    } catch (e: any) {
      setActionError(e.message);
    }
    setGeneratingMsg(false);
  };

  // ─── Push / Pull / Fetch ──────────────────────────────────────────
  const handlePush = async () => {
    setPushing(true);
    setActionError('');
    try {
      const result = await api?.gitPush?.();
      if (!result?.success) setActionError(result?.error || 'Push failed');
      refresh();
    } catch (e: any) { setActionError(e.message); }
    setPushing(false);
  };

  const handlePull = async () => {
    setPulling(true);
    setActionError('');
    try {
      const result = await api?.gitPull?.();
      if (!result?.success) setActionError(result?.error || 'Pull failed');
      refresh();
    } catch (e: any) { setActionError(e.message); }
    setPulling(false);
  };

  const handleFetch = async () => {
    setFetching(true);
    setActionError('');
    try {
      const result = await api?.gitFetch?.();
      if (!result?.success) setActionError(result?.error || 'Fetch failed');
      refresh();
    } catch (e: any) { setActionError(e.message); }
    setFetching(false);
  };

  // ─── Branch creation ──────────────────────────────────────────────
  const createBranch = async () => {
    if (!newBranchName.trim()) return;
    setActionError('');
    const result = await api?.gitCreateBranch?.(newBranchName.trim(), true);
    if (result?.success) {
      setNewBranchName('');
      setShowNewBranch(false);
      refresh();
    } else {
      setActionError(result?.error || 'Failed to create branch');
    }
  };

  const deleteBranch = async (name: string) => {
    if (!confirm(`Delete branch "${name}"?`)) return;
    const result = await api?.gitDeleteBranch?.(name);
    if (result?.success) {
      const br = await api?.gitBranches?.();
      if (br) setBranches((br as unknown as GitBranchInfo[]) || []);
    } else {
      setActionError(result?.error || 'Failed to delete branch');
    }
  };

  // ─── Merge ────────────────────────────────────────────────────────
  const handleMerge = async (branchName: string) => {
    setActionError('');
    const result = await api?.gitMerge?.(branchName);
    if (result?.success) {
      setShowMerge(false);
      refresh();
    } else if ((result as any)?.conflict) {
      setShowMerge(false);
      setMergeState({ inMerge: true, conflictFiles: (result as any).conflictFiles || [] });
      setActionError('Merge conflict! Resolve conflicts below.');
    } else {
      setActionError(result?.error || 'Merge failed');
    }
  };

  const handleMergeAbort = async () => {
    await api?.gitMergeAbort?.();
    setMergeState({ inMerge: false, conflictFiles: [] });
    setActionError('');
    refresh();
  };

  // ─── AI: Resolve conflict ─────────────────────────────────────────
  const resolveConflict = async (filePath: string) => {
    setResolvingFile(filePath);
    setActionError('');
    try {
      const fullPath = rootPath + '/' + filePath;
      // Read the conflicted file content through the existing read API
      const fileContent = await api?.readFile?.(fullPath);
      if (!fileContent) {
        setActionError('Could not read conflicted file');
        setResolvingFile(null);
        return;
      }
      const cloudProvider = localStorage.getItem('guIDE-cloudProvider') || '';
      const cloudModel = localStorage.getItem('guIDE-cloudModel') || '';
      const result = await api?.gitAiResolveConflict?.({
        filePath,
        fileContent: typeof fileContent === 'string' ? fileContent : (fileContent as any).content || '',
        ...(cloudProvider && cloudModel ? { cloudProvider, cloudModel } : {}),
      });
      if (result?.success && result.resolved) {
        // Write resolved content back
        await api?.writeFile?.(fullPath, result.resolved);
        // Stage the resolved file
        await api?.gitStage?.(filePath);
        refresh();
      } else {
        setActionError(result?.error || 'AI could not resolve this conflict');
      }
    } catch (e: any) {
      setActionError(e.message);
    }
    setResolvingFile(null);
  };

  // ─── Commit history + AI explain ──────────────────────────────────
  const loadHistory = async () => {
    if (showHistory) { setShowHistory(false); return; }
    const log = await api?.gitLog?.(20);
    setCommitHistory(log || []);
    setShowHistory(true);
  };

  const explainCommit = async (hash: string) => {
    if (explainResult?.hash === hash) { setExplainResult(null); return; }
    setExplaining(true);
    setExplainResult(null);
    try {
      const cloudProvider = localStorage.getItem('guIDE-cloudProvider') || '';
      const cloudModel = localStorage.getItem('guIDE-cloudModel') || '';
      const result = await api?.gitAiExplainCommit?.({
        hash,
        ...(cloudProvider && cloudModel ? { cloudProvider, cloudModel } : {}),
      });
      if (result?.success && result.explanation) {
        setExplainResult({ hash, text: result.explanation });
      } else {
        setExplainResult({ hash, text: result?.error || 'Could not explain this commit' });
      }
    } catch (e: any) {
      setExplainResult({ hash, text: e.message });
    }
    setExplaining(false);
  };

  const showDiff = async (filePath: string, staged: boolean) => {
    if (diffFile === filePath) {
      setDiffFile(null);
      setDiffContent('');
      return;
    }
    const result = await api?.gitDiff(filePath, staged);
    if (result) {
      setDiffFile(filePath);
      setDiffContent(typeof result === 'string' ? result : (result as any).diff || '(No diff available — new file)');
    }
  };

  const loadBranches = async () => {
    if (!showBranches) {
      const result = await api?.gitBranches();
      if (result && !Array.isArray(result)) {
        setBranches((result as any).all?.map((name: string) => ({ name, current: name === (result as any).current })) || []);
      } else {
        setBranches((result as GitBranchInfo[]) || []);
      }
    }
    setShowBranches(!showBranches);
  };

  // ── Not a repo ──
  if (!isRepo && rootPath) {
    return (
      <div className="p-4 text-[13px] text-[#858585] flex flex-col items-center gap-3">
        <FolderGit2 size={48} className="opacity-30" />
        <p className="text-center">This folder is not a git repository</p>
        <button
          onClick={initRepo}
          className="px-3 py-1.5 bg-[#007acc] text-white text-[12px] rounded hover:bg-[#0098ff] transition-colors"
        >
          Initialize Repository
        </button>
      </div>
    );
  }

  if (!rootPath) {
    return (
      <div className="p-4 text-[13px] text-[#858585]">
        <GitBranch size={48} className="mx-auto mb-3 opacity-30" />
        <p className="text-center">Open a folder to use source control</p>
      </div>
    );
  }

  const FileRow: React.FC<{ file: GitFile; isStaged: boolean }> = ({ file, isStaged }) => {
    const fileName = file.path.split(/[/\\]/).pop() || file.path;
    const dirPath = file.path.includes('/') || file.path.includes('\\')
      ? file.path.substring(0, file.path.lastIndexOf(file.path.includes('/') ? '/' : '\\'))
      : '';

    return (
      <div className="group flex items-center gap-1 px-2 py-0.5 hover:bg-[#2a2d2e] cursor-pointer text-[13px]">
        <div
          className="flex-1 flex items-center gap-1.5 min-w-0 truncate"
          onClick={() => showDiff(file.path, isStaged)}
          title={file.path}
        >
          <StatusIcon status={file.status} />
          <span className="text-[#cccccc] truncate">{fileName}</span>
          {dirPath && <span className="text-[#858585] text-[11px] truncate ml-1">{dirPath}</span>}
        </div>
        <span className={`text-[11px] font-mono ${statusColors[file.status] || 'text-[#858585]'} ml-1`}>
          {statusLetters[file.status] || '?'}
        </span>
        <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
          {isStaged ? (
            <button onClick={() => unstageFile(file.path)} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Unstage">
              <Minus size={12} className="text-[#cccccc]" />
            </button>
          ) : (
            <>
              <button onClick={() => onFileClick(file.path)} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Open file">
                <FileText size={12} className="text-[#cccccc]" />
              </button>
              {file.status !== 'untracked' && (
                <button onClick={() => discardFile(file.path)} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Discard changes">
                  <RotateCcw size={12} className="text-[#cccccc]" />
                </button>
              )}
              <button onClick={() => stageFile(file.path)} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Stage">
                <Plus size={12} className="text-[#cccccc]" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full text-[#cccccc]">
      {/* Branch bar */}
      <div className="px-3 py-1.5 border-b border-[#1e1e1e] flex items-center gap-2">
        <button
          onClick={loadBranches}
          className="flex items-center gap-1 text-[12px] hover:text-white transition-colors"
          title="Switch branch"
        >
          <GitBranch size={12} className="text-[#007acc]" />
          <span>{branch}</span>
          {(ahead > 0 || behind > 0) && (
            <span className="text-[10px] text-[#858585]">
              {ahead > 0 && `↑${ahead}`}{behind > 0 && `↓${behind}`}
            </span>
          )}
        </button>
        <div className="flex-1" />
        <button onClick={handleFetch} disabled={fetching} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Fetch">
          <Download size={12} className={fetching ? 'animate-spin text-[#007acc]' : 'text-[#858585]'} />
        </button>
        <button onClick={handlePull} disabled={pulling} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Pull">
          <ArrowDown size={12} className={pulling ? 'animate-pulse text-[#007acc]' : 'text-[#858585]'} />
        </button>
        <button onClick={handlePush} disabled={pushing} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Push">
          <ArrowUp size={12} className={pushing ? 'animate-pulse text-[#007acc]' : 'text-[#858585]'} />
        </button>
        <button onClick={loadHistory} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Commit History">
          <History size={12} className={showHistory ? 'text-[#007acc]' : 'text-[#858585]'} />
        </button>
        <button onClick={refresh} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Refresh">
          <RefreshCw size={12} className={loading ? 'animate-spin text-[#007acc]' : 'text-[#858585]'} />
        </button>
      </div>

      {/* Branch picker dropdown */}
      {showBranches && (
        <div className="border-b border-[#1e1e1e] bg-[#1e1e1e] max-h-[200px] overflow-y-auto">
          <button
            onClick={() => { setShowNewBranch(!showNewBranch); }}
            className="w-full text-left px-3 py-1 text-[12px] hover:bg-[#2a2d2e] text-[#89d185] flex items-center gap-2"
          >
            <Plus size={10} /> Create new branch
          </button>
          {showNewBranch && (
            <div className="px-3 py-1 flex gap-1">
              <input
                type="text"
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createBranch()}
                placeholder="branch-name"
                className="flex-1 bg-[#3c3c3c] border border-[#555] text-[#cccccc] text-[11px] px-2 py-0.5 rounded focus:outline-none focus:border-[#007acc]"
                autoFocus
              />
              <button onClick={createBranch} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Create">
                <Check size={12} className="text-[#89d185]" />
              </button>
            </div>
          )}
          <button
            onClick={() => setShowMerge(!showMerge)}
            className="w-full text-left px-3 py-1 text-[12px] hover:bg-[#2a2d2e] text-[#4fc1ff] flex items-center gap-2"
          >
            <GitMerge size={10} /> Merge branch into {branch}
          </button>
          {branches.map(b => (
            <div key={b.name} className="group flex items-center">
              <button
                onClick={() => showMerge ? handleMerge(b.name) : switchBranch(b.name)}
                className={`flex-1 text-left px-3 py-1 text-[12px] hover:bg-[#2a2d2e] flex items-center gap-2 ${
                  b.current ? 'text-[#007acc]' : 'text-[#cccccc]'
                }`}
              >
                {b.current && <Check size={10} />}
                <span className={b.current ? '' : 'ml-[18px]'}>{b.name}</span>
                {showMerge && !b.current && <span className="text-[10px] text-[#858585] ml-auto">← merge</span>}
              </button>
              {!b.current && (
                <button
                  onClick={() => deleteBranch(b.name)}
                  className="hidden group-hover:block p-0.5 hover:bg-[#3c3c3c] rounded mr-1"
                  title="Delete branch"
                >
                  <Trash2 size={10} className="text-[#f14c4c]" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Commit input */}
      <div className="px-2 py-2 border-b border-[#1e1e1e]">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && commit()}
            placeholder="Commit message"
            className="flex-1 bg-[#3c3c3c] border border-[#555] text-[#cccccc] text-[12px] px-2 py-1 rounded focus:outline-none focus:border-[#007acc] placeholder:text-[#6e6e6e]"
          />
          <button
            onClick={generateCommitMessage}
            disabled={generatingMsg || stagedFiles.length === 0}
            className="p-1 rounded hover:bg-[#3c3c3c] disabled:opacity-30 disabled:cursor-not-allowed"
            title="AI: Generate commit message from staged changes"
          >
            {generatingMsg ? <Loader size={14} className="animate-spin text-[#dcdcaa]" /> : <Sparkles size={14} className="text-[#dcdcaa]" />}
          </button>
          <button
            onClick={commit}
            disabled={!commitMsg.trim() || stagedFiles.length === 0}
            className="p-1 rounded hover:bg-[#3c3c3c] disabled:opacity-30 disabled:cursor-not-allowed"
            title={stagedFiles.length === 0 ? 'Stage files first' : 'Commit staged changes'}
          >
            <Check size={16} className="text-[#89d185]" />
          </button>
        </div>
        {stagedFiles.length === 0 && commitMsg.trim() && (
          <p className="text-[10px] text-[#f14c4c] mt-1 px-1">Stage files before committing</p>
        )}
        {actionError && (
          <p className="text-[10px] text-[#f14c4c] mt-1 px-1 flex items-center gap-1">
            <AlertTriangle size={10} /> {actionError}
            <button onClick={() => setActionError('')} className="ml-auto hover:text-white"><X size={10} /></button>
          </p>
        )}
      </div>

      {/* Merge conflict banner */}
      {mergeState.inMerge && (
        <div className="px-2 py-1.5 bg-[#f14c4c20] border-b border-[#f14c4c40]">
          <div className="flex items-center gap-1 text-[11px] text-[#f14c4c] font-semibold mb-1">
            <AlertTriangle size={12} /> Merge Conflicts ({mergeState.conflictFiles.length} files)
            <button onClick={handleMergeAbort} className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[#f14c4c30] hover:bg-[#f14c4c50]">Abort Merge</button>
          </div>
          {mergeState.conflictFiles.map(f => (
            <div key={f} className="flex items-center gap-1 py-0.5 text-[11px]">
              <AlertTriangle size={10} className="text-[#e2c08d] flex-shrink-0" />
              <span className="text-[#cccccc] truncate flex-1">{f}</span>
              <button
                onClick={() => resolveConflict(f)}
                disabled={resolvingFile === f}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#007acc30] text-[#4fc1ff] hover:bg-[#007acc50] disabled:opacity-50"
              >
                {resolvingFile === f ? <Loader size={10} className="animate-spin inline" /> : <><Sparkles size={10} className="inline" /> AI Resolve</>}
              </button>
              <button onClick={() => onFileClick(f)} className="p-0.5 hover:bg-[#3c3c3c] rounded" title="Open file">
                <FileText size={10} className="text-[#858585]" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* File lists */}
      <div className="flex-1 overflow-y-auto">
        {/* Staged changes */}
        {stagedFiles.length > 0 && (
          <div>
            <button
              onClick={() => setShowStaged(!showStaged)}
              className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#bbbbbb] hover:bg-[#2a2d2e]"
            >
              {showStaged ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>Staged Changes</span>
              <span className="ml-auto text-[10px] bg-[#89d185] text-[#1e1e1e] px-1.5 rounded-full font-bold">
                {stagedFiles.length}
              </span>
              <button
                onClick={e => { e.stopPropagation(); unstageAll(); }}
                className="p-0.5 hover:bg-[#3c3c3c] rounded ml-1"
                title="Unstage all"
              >
                <Minus size={12} />
              </button>
            </button>
            {showStaged && stagedFiles.map(f => (
              <FileRow key={`staged-${f.path}`} file={f} isStaged />
            ))}
          </div>
        )}

        {/* Changes */}
        <div>
          <button
            onClick={() => setShowChanges(!showChanges)}
            className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#bbbbbb] hover:bg-[#2a2d2e]"
          >
            {showChanges ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>Changes</span>
            <span className="ml-auto text-[10px] bg-[#4d4d4d] text-[#cccccc] px-1.5 rounded-full font-bold">
              {changedFiles.length}
            </span>
            {changedFiles.length > 0 && (
              <button
                onClick={e => { e.stopPropagation(); stageAll(); }}
                className="p-0.5 hover:bg-[#3c3c3c] rounded ml-1"
                title="Stage all"
              >
                <Plus size={12} />
              </button>
            )}
          </button>
          {showChanges && changedFiles.map(f => (
            <FileRow key={`changed-${f.path}`} file={f} isStaged={false} />
          ))}
        </div>

        {/* Inline diff viewer */}
        {diffFile && diffContent && (
          <div className="border-t border-[#1e1e1e] mt-1">
            <div className="px-2 py-1 text-[11px] text-[#858585] bg-[#1e1e1e] flex items-center justify-between">
              <span>Diff: {diffFile.split(/[/\\]/).pop()}</span>
              <button onClick={() => { setDiffFile(null); setDiffContent(''); }} className="hover:text-white">×</button>
            </div>
            <pre className="text-[11px] font-mono px-2 py-1 overflow-x-auto max-h-[300px] overflow-y-auto leading-[1.4]">
              {diffContent.split('\n').map((line, i) => {
                let cls = 'text-[#858585]';
                if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-[#89d185] bg-[#89d18510]';
                else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-[#f14c4c] bg-[#f14c4c10]';
                else if (line.startsWith('@@')) cls = 'text-[#4fc1ff]';
                return <div key={i} className={cls}>{line || ' '}</div>;
              })}
            </pre>
          </div>
        )}

        {/* Commit history with AI explain */}
        {showHistory && (
          <div className="border-t border-[#1e1e1e] mt-1">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#bbbbbb] bg-[#1e1e1e] flex items-center justify-between">
              <span className="flex items-center gap-1"><History size={11} /> Recent Commits</span>
              <button onClick={() => setShowHistory(false)} className="hover:text-white">×</button>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {commitHistory.map(c => (
                <div key={c.hash}>
                  <div className="group flex items-center gap-1.5 px-2 py-1 hover:bg-[#2a2d2e] text-[12px]">
                    <span className="text-[10px] font-mono text-[#858585] flex-shrink-0">{c.hash.substring(0, 7)}</span>
                    <span className="text-[#cccccc] truncate flex-1">{c.message}</span>
                    <button
                      onClick={() => explainCommit(c.hash)}
                      disabled={explaining}
                      className="hidden group-hover:block p-0.5 hover:bg-[#3c3c3c] rounded flex-shrink-0"
                      title="AI: Explain this commit"
                    >
                      {explaining && explainResult === null ? (
                        <Loader size={11} className="animate-spin text-[#dcdcaa]" />
                      ) : (
                        <Eye size={11} className={explainResult?.hash === c.hash ? 'text-[#007acc]' : 'text-[#858585]'} />
                      )}
                    </button>
                  </div>
                  {explainResult?.hash === c.hash && (
                    <div className="mx-2 mb-1 p-2 bg-[#1e1e1e] rounded border border-[#3c3c3c] text-[11px] text-[#cccccc] leading-relaxed whitespace-pre-wrap">
                      {explainResult.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {files.length === 0 && (
          <div className="p-4 text-center text-[12px] text-[#858585]">
            <GitCommit size={24} className="mx-auto mb-2 opacity-30" />
            <p>No changes detected</p>
          </div>
        )}
      </div>
    </div>
  );
};
