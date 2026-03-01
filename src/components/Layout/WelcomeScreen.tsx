import React, { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, Plus, Clock, ChevronRight, ArrowRight,
  Download, CheckCircle, Loader2, Zap, Code2, Brain, Package,
  Cloud, LogOut, UserCircle,
} from 'lucide-react';
import type { LicenseStatus } from '@/types/electron';

interface RecommendedModel {
  name: string;
  file: string;
  size: number;
  desc: string;
  category: string;
  fits: boolean;
  downloadUrl: string;
}

interface InstalledModel {
  name: string;
  path: string;
}

interface WelcomeScreenProps {
  onOpenFolder: () => void;
  onNewProject: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onOpenFolder, onNewProject }) => {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [recommendedModels, setRecommendedModels] = useState<RecommendedModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  // fileName → 'downloading' | 'done' | 'error'
  const [downloadState, setDownloadState] = useState<Record<string, 'downloading' | 'done' | 'error'>>({});
  // model path → loading when 'Use' was clicked
  const [loadingModel, setLoadingModel] = useState<string | null>(null);
  // license / sign-in state
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [licenseLoading, setLicenseLoading] = useState(false);
  const [cloudAILoading, setCloudAILoading] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('recent-folders');
      if (stored) setRecentFolders(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) { setModelsLoaded(true); return; }
    const load = async () => {
      try {
        const [installed, recs] = await Promise.all([
          api.modelsList?.() ?? [],
          api.getRecommendedModels?.() ?? { recommended: [] },
        ]);
        setInstalledModels(Array.isArray(installed) ? installed : []);
        // Top 3 hardware-matched models (server already sorts large→small)
        setRecommendedModels(((recs as any).recommended ?? []).slice(0, 3));
      } catch { /* offline or no models dir */ }
      setModelsLoaded(true);
    };
    load();
  }, []);

  // Load license status for sign-in strip
  useEffect(() => {
    window.electronAPI?.licenseGetStatus?.().then(s => { if (s) setLicenseStatus(s); }).catch(() => {});
  }, []);

  const openRecent = (path: string) => {
    window.dispatchEvent(new CustomEvent('app-action', { detail: { action: 'open-recent', path } }));
  };

  const formatPath = (fullPath: string): { name: string; parent: string } => {
    const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
    return {
      name: parts[parts.length - 1] || fullPath,
      parent: parts.slice(0, -1).join('/') || '/',
    };
  };

  const useModel = async (modelPath: string) => {
    setLoadingModel(modelPath);
    try {
      await window.electronAPI?.llmLoadModel?.(modelPath);
      // Switch app to local model — clear cloud provider preference so ChatPanel defaults to local
      try { localStorage.removeItem('guide-cloud-provider'); } catch {}
    } finally {
      setLoadingModel(null);
    }
  };

  const useCloudAI = () => {
    setCloudAILoading(true);
    try {
      localStorage.setItem('guide-cloud-provider', 'sambanova');
      localStorage.setItem('guide-cloud-model', 'Meta-Llama-3.3-70B-Instruct');
    } catch {}
    // Open most-recent folder or prompt for folder
    if (recentFolders.length > 0) {
      openRecent(recentFolders[0]);
    } else {
      onOpenFolder();
    }
    setCloudAILoading(false);
  };

  const handleGoogleSignIn = async () => {
    setLicenseLoading(true);
    try {
      const result = await window.electronAPI?.licenseOAuthSignIn?.('google');
      if (result?.success || (result as any)?.authenticated) {
        const status = await window.electronAPI?.licenseGetStatus?.();
        if (status) setLicenseStatus(status);
      }
    } catch {}
    setLicenseLoading(false);
  };

  const handleSignOut = async () => {
    try {
      await window.electronAPI?.licenseDeactivate?.();
      setLicenseStatus(prev => prev ? { ...prev, isActivated: false, isAuthenticated: false, license: null } : null);
    } catch {}
  };

  const downloadModel = useCallback(async (model: RecommendedModel) => {
    const api = window.electronAPI;
    if (!api) return;
    // Block if anything already downloading
    if (Object.values(downloadState).includes('downloading')) return;
    setDownloadState(prev => ({ ...prev, [model.file]: 'downloading' }));
    try {
      const result = await api.modelsDownloadHF?.({ url: model.downloadUrl, fileName: model.file });
      if (result?.success || result?.alreadyExists) {
        setDownloadState(prev => ({ ...prev, [model.file]: 'done' }));
        // Refresh installed models list
        const fresh = await api.modelsList?.() ?? [];
        setInstalledModels(Array.isArray(fresh) ? fresh : []);
      } else {
        setDownloadState(prev => ({ ...prev, [model.file]: 'error' }));
      }
    } catch {
      setDownloadState(prev => ({ ...prev, [model.file]: 'error' }));
    }
  }, [downloadState]);

  const isInstalled = (file: string) =>
    installedModels.some(m => (m.path || '').endsWith(file) || m.name === file);

  const getCategoryIcon = (category: string) => {
    if (category === 'coding') return <Code2 size={11} />;
    if (category === 'reasoning') return <Brain size={11} />;
    return <Zap size={11} />;
  };

  const getSizeBadge = (sizeGB: number) =>
    sizeGB < 1 ? `${Math.round(sizeGB * 1000)}MB` : `${sizeGB}GB`;

  const anyDownloading = Object.values(downloadState).includes('downloading');
  const hasModelsSection = modelsLoaded;

  return (
    <div
      className="flex-1 flex flex-col items-center overflow-auto py-10"
      style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-foreground)' }}
    >
      {/* Logo + Brand */}
      <div className="flex flex-col items-center mb-8 select-none">
        <img
          src="zzz.png"
          alt="guIDE"
          className="w-14 h-14 mb-4"
          style={{ filter: 'drop-shadow(0 0 16px color-mix(in srgb, var(--theme-accent) 50%, transparent))' }}
        />
        <h1
          className="text-[28px] font-bold tracking-tight brand-font"
          style={{ color: 'var(--theme-foreground)', letterSpacing: '-0.02em' }}
        >
          guIDE
        </h1>
        <p className="text-[12px] mt-1" style={{ color: 'var(--theme-foreground-muted)' }}>
          Local AI — No cloud required
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2.5 mb-8">
        <button
          onClick={onOpenFolder}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150"
          style={{ backgroundColor: 'var(--theme-accent)', color: 'var(--theme-bg)', border: '1px solid transparent' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-accent-hover)';
            (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-accent)';
            (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
          }}
        >
          <FolderOpen size={15} strokeWidth={1.75} />
          Open Folder
        </button>
        <button
          onClick={onNewProject}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150"
          style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-bg-tertiary)';
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-accent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-bg-secondary)';
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-border)';
          }}
        >
          <Plus size={15} strokeWidth={1.75} />
          New Project
        </button>
      </div>

      {/* Two–column content area */}
      <div className="w-full max-w-[820px] px-4 flex gap-6 min-h-0">

        {/* ── Left: Recent Folders ── */}
        {recentFolders.length > 0 && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--theme-foreground-subtle)' }}>
              <Clock size={12} />
              Recent
            </div>
            <div className="flex flex-col gap-1">
              {recentFolders.map((path) => {
                const { name, parent } = formatPath(path);
                return (
                  <button
                    key={path}
                    onClick={() => openRecent(path)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors group"
                    style={{ backgroundColor: 'transparent', color: 'var(--theme-foreground)', border: '1px solid transparent' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-selection-hover)';
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-border)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                      (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
                    }}
                  >
                    <FolderOpen size={16} style={{ color: 'var(--theme-accent)', flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate">{name}</div>
                      <div className="text-[11px] truncate" style={{ color: 'var(--theme-foreground-muted)' }}>{parent}</div>
                    </div>
                    <ChevronRight size={14} style={{ color: 'var(--theme-foreground-subtle)', flexShrink: 0, opacity: 0 }}
                      className="group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Right: Models ── */}
        {hasModelsSection && (
          <div className={recentFolders.length > 0 ? 'w-[290px] flex-shrink-0' : 'flex-1 min-w-0'}>

            {/* Guide Cloud AI card — always at top */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--theme-foreground-subtle)' }}>
                <Cloud size={12} />
                Cloud AI
              </div>
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)' }}
              >
                <Cloud size={13} style={{ color: 'var(--theme-accent)', flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium" style={{ color: 'var(--theme-foreground)' }}>Guide Cloud AI</div>
                  <div className="text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                    {licenseStatus?.isAuthenticated ? 'Unlimited — ' + (licenseStatus.license?.plan || 'pro') + ' plan' : '20 messages/day free'}
                  </div>
                </div>
                <button
                  onClick={useCloudAI}
                  disabled={cloudAILoading}
                  className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded font-medium flex items-center justify-center gap-1 transition-opacity"
                  style={{ backgroundColor: 'var(--theme-accent)', color: 'var(--theme-bg)', minWidth: 36, opacity: cloudAILoading ? 0.7 : 1 }}
                  onMouseEnter={(e) => { if (!cloudAILoading) (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
                  onMouseLeave={(e) => { if (!cloudAILoading) (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                >
                  {cloudAILoading ? <Loader2 size={10} className="animate-spin" /> : 'Use'}
                </button>
              </div>
            </div>

            {/* Installed models */}
            {installedModels.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--theme-foreground-subtle)' }}>
                  <Package size={12} />
                  Installed Models
                </div>
                <div className="flex flex-col gap-1">
                  {installedModels.slice(0, 4).map((model) => {
                    const label = (model.name || (model.path || '').split(/[/\\]/).pop() || 'Unknown').replace(/\.gguf$/i, '');
                    return (
                      <div
                        key={model.path || model.name}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                        style={{ backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)' }}
                      >
                        <span className="flex-1 min-w-0 text-[12px] truncate" style={{ color: 'var(--theme-foreground)' }} title={label}>
                          {label}
                        </span>
                        <button
                          onClick={() => useModel(model.path || model.name)}
                          disabled={loadingModel === (model.path || model.name)}
                          className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded font-medium flex items-center justify-center gap-1 transition-opacity"
                          style={{ backgroundColor: 'var(--theme-accent)', color: 'var(--theme-bg)', minWidth: 36, opacity: loadingModel === (model.path || model.name) ? 0.7 : 1 }}
                          onMouseEnter={(e) => { if (loadingModel !== (model.path || model.name)) (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
                          onMouseLeave={(e) => { if (loadingModel !== (model.path || model.name)) (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                          title={loadingModel === (model.path || model.name) ? 'Loading...' : `Load ${label}`}
                        >
                          {loadingModel === (model.path || model.name) ? <Loader2 size={10} className="animate-spin" /> : 'Use'}
                        </button>
                      </div>
                    );
                  })}
                  {installedModels.length > 4 && (
                    <p className="text-[11px] px-1 mt-0.5" style={{ color: 'var(--theme-foreground-muted)' }}>
                      +{installedModels.length - 4} more — open Settings → Models
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Recommended downloads */}
            {recommendedModels.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--theme-foreground-subtle)' }}>
                  <Download size={12} />
                  Recommended for Your Hardware
                </div>
                <div className="flex flex-col gap-1.5">
                  {recommendedModels.map((model) => {
                    const installed = isInstalled(model.file) || downloadState[model.file] === 'done';
                    const downloading = downloadState[model.file] === 'downloading';
                    const errored = downloadState[model.file] === 'error';
                    return (
                      <div
                        key={model.file}
                        className="flex items-start gap-2 px-3 py-2 rounded-lg"
                        style={{ backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)' }}
                      >
                        {/* Category icon */}
                        <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--theme-foreground-muted)' }}>
                          {getCategoryIcon(model.category)}
                        </span>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium truncate" style={{ color: 'var(--theme-foreground)' }}>{model.name}</div>
                          <div className="text-[11px] truncate" style={{ color: 'var(--theme-foreground-muted)' }}>{model.desc}</div>
                          {errored && <div className="text-[10px] mt-0.5" style={{ color: '#f48771' }}>Download failed — check connection</div>}
                        </div>
                        {/* Size badge + action */}
                        <div className="flex-shrink-0 flex flex-col items-end gap-1">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                            style={{ backgroundColor: 'var(--theme-bg-tertiary)', color: 'var(--theme-foreground-muted)', border: '1px solid var(--theme-border)' }}
                          >
                            {getSizeBadge(model.size)}
                          </span>
                          {installed ? (
                            <CheckCircle size={13} style={{ color: '#89d185' }} />
                          ) : downloading ? (
                            <Loader2 size={13} className="animate-spin" style={{ color: 'var(--theme-accent)' }} />
                          ) : (
                            <button
                              onClick={() => downloadModel(model)}
                              disabled={anyDownloading}
                              className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-all"
                              style={{
                                backgroundColor: 'var(--theme-bg-tertiary)',
                                color: anyDownloading ? 'var(--theme-foreground-muted)' : 'var(--theme-foreground)',
                                border: '1px solid var(--theme-border)',
                                cursor: anyDownloading ? 'not-allowed' : 'pointer',
                                opacity: anyDownloading ? 0.5 : 1,
                              }}
                              onMouseEnter={(e) => { if (!anyDownloading) (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-accent)'; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-border)'; }}
                              title={`Download ${model.name} (${getSizeBadge(model.size)})`}
                            >
                              <Download size={9} />
                              Get
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {installedModels.length === 0 && (
                  <p className="text-[11px] mt-2 px-1" style={{ color: 'var(--theme-foreground-muted)' }}>
                    Download a model to enable AI features. More options in Settings → Models.
                  </p>
                )}
              </div>
            )}

            {/* Nothing loaded yet */}
            {modelsLoaded && installedModels.length === 0 && recommendedModels.length === 0 && (
              <p className="text-[12px]" style={{ color: 'var(--theme-foreground-muted)' }}>
                No models found. Add a .gguf file via Settings → Models.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Keyboard hint */}
      <div className="mt-8 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--theme-foreground-subtle)' }}>
        <kbd
          className="px-1.5 py-0.5 rounded text-[10px]"
          style={{ backgroundColor: 'var(--theme-bg-tertiary)', border: '1px solid var(--theme-border)', fontFamily: 'monospace' }}
        >
          Ctrl+Shift+P
        </kbd>
        <span>Command Palette</span>
        <span className="mx-2" style={{ color: 'var(--theme-foreground-subtle)' }}>·</span>
        <ArrowRight size={11} />
        <span>Open a folder to get started</span>
      </div>

      {/* Sign-in strip */}
      <div className="mt-4 flex items-center gap-2">
        {licenseStatus?.isAuthenticated ? (
          <>
            <UserCircle size={13} style={{ color: 'var(--theme-accent)' }} />
            <span className="text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>
              {licenseStatus.license?.email || 'Signed in'}
            </span>
            {licenseStatus.license?.plan && licenseStatus.license.plan !== 'free' && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: 'color-mix(in srgb, var(--theme-accent) 15%, transparent)', color: 'var(--theme-accent)', border: '1px solid color-mix(in srgb, var(--theme-accent) 30%, transparent)' }}
              >
                {licenseStatus.license.plan}
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors"
              style={{ color: 'var(--theme-foreground-muted)', border: '1px solid transparent' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--theme-foreground)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-border)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--theme-foreground-muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; }}
              title="Sign out"
            >
              <LogOut size={11} />
              Sign out
            </button>
          </>
        ) : (
          <button
            onClick={handleGoogleSignIn}
            disabled={licenseLoading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
            style={{ backgroundColor: 'var(--theme-bg-secondary)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-border)', opacity: licenseLoading ? 0.7 : 1 }}
            onMouseEnter={(e) => { if (!licenseLoading) (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-accent)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-border)'; }}
          >
            {licenseLoading ? <Loader2 size={12} className="animate-spin" /> : (
              <svg viewBox="0 0 18 18" width="13" height="13">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
            )}
            {licenseLoading ? 'Signing in...' : 'Continue with Google'}
          </button>
        )}
      </div>
    </div>
  );
};
