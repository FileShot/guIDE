import React, { useState, useEffect } from 'react';
import { Download, Trash2, ToggleLeft, ToggleRight, Search, Star, Package, Check } from 'lucide-react';
import type { PluginInfo } from '@/types/electron';

export const PluginPanel: React.FC = () => {
  const [tab, setTab] = useState<'marketplace' | 'installed'>('marketplace');
  const [marketplace, setMarketplace] = useState<PluginInfo[]>([]);
  const [installed, setInstalled] = useState<PluginInfo[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [categories, setCategories] = useState<string[]>(['all']);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const installedIds = new Set(installed.map(p => p.id));

  useEffect(() => {
    loadMarketplace();
    loadInstalled();
    window.electronAPI.pluginCategories().then(r => {
      if (r.success && r.categories) setCategories(r.categories);
    });
  }, []);

  useEffect(() => {
    loadMarketplace();
  }, [search, category]);

  const loadMarketplace = async () => {
    setLoading(true);
    const result = await window.electronAPI.pluginMarketplace({ search, category });
    if (result.success && result.plugins) setMarketplace(result.plugins);
    setLoading(false);
  };

  const loadInstalled = async () => {
    const result = await window.electronAPI.pluginListInstalled();
    if (result.success && result.plugins) setInstalled(result.plugins);
  };

  const handleInstall = async (pluginId: string) => {
    setActionLoading(pluginId);
    const result = await window.electronAPI.pluginInstall(pluginId);
    setActionLoading(null);
    if (result.success) loadInstalled();
  };

  const handleUninstall = async (pluginId: string) => {
    setActionLoading(pluginId);
    await window.electronAPI.pluginUninstall(pluginId);
    setActionLoading(null);
    loadInstalled();
  };

  const handleToggle = async (pluginId: string, enabled: boolean) => {
    await window.electronAPI.pluginToggle(pluginId, enabled);
    loadInstalled();
  };

  const renderStars = (rating: number) => {
    const full = Math.floor(rating);
    return (
      <span className="flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} size={10} fill={i < full ? '#fbbf24' : 'none'} stroke={i < full ? '#fbbf24' : '#666'} />
        ))}
        <span className="text-[10px] ml-0.5" style={{ color: 'var(--theme-foreground-muted)' }}>{rating}</span>
      </span>
    );
  };

  const formatDownloads = (n?: number) => {
    if (!n) return '';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return n.toString();
  };

  const categoryColors: Record<string, string> = {
    theme: '#9b59b6',
    snippets: '#3498db',
    formatter: '#2ecc71',
    linter: '#e67e22',
    language: '#1abc9c',
    tools: '#e74c3c',
    git: '#f39c12',
  };

  return (
    <div className="flex flex-col h-full text-[12px]" style={{ color: 'var(--theme-foreground)' }}>
      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--theme-border)' }}>
        <button onClick={() => setTab('marketplace')} className="flex-1 px-2 py-1.5 text-[11px] transition-colors"
          style={{ color: tab === 'marketplace' ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)', borderBottom: tab === 'marketplace' ? '2px solid var(--theme-accent)' : '2px solid transparent' }}>
          Marketplace
        </button>
        <button onClick={() => setTab('installed')} className="flex-1 px-2 py-1.5 text-[11px] transition-colors"
          style={{ color: tab === 'installed' ? 'var(--theme-accent)' : 'var(--theme-foreground-muted)', borderBottom: tab === 'installed' ? '2px solid var(--theme-accent)' : '2px solid transparent' }}>
          Installed ({installed.length})
        </button>
      </div>

      {/* Search (marketplace only) */}
      {tab === 'marketplace' && (
        <div className="px-3 pt-2 space-y-1.5">
          <div className="flex items-center gap-1 px-2 py-1.5 rounded" style={{ backgroundColor: 'var(--theme-input-bg, #3c3c3c)', border: '1px solid var(--theme-border)' }}>
            <Search size={13} style={{ color: 'var(--theme-foreground-muted)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search extensions..." className="flex-1 bg-transparent outline-none text-[12px]" style={{ color: 'var(--theme-foreground)' }} />
          </div>
          <div className="flex gap-1 flex-wrap">
            {categories.map(cat => (
              <button key={cat} onClick={() => setCategory(cat)} className="px-2 py-0.5 rounded-full text-[10px] capitalize transition-colors"
                style={{ backgroundColor: category === cat ? 'var(--theme-accent)' : 'var(--theme-bg-secondary, #2d2d2d)', color: category === cat ? '#fff' : 'var(--theme-foreground-muted)' }}>
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Plugin List */}
      <div className="flex-1 overflow-auto px-3 py-2 space-y-2">
        {tab === 'marketplace' && (
          loading ? (
            <div className="text-center py-8" style={{ color: 'var(--theme-foreground-muted)' }}>Loading...</div>
          ) : (
            marketplace.map(plugin => (
              <div key={plugin.id} className="p-2.5 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)', border: '1px solid var(--theme-border)' }}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Package size={14} style={{ color: categoryColors[plugin.category] || 'var(--theme-accent)' }} />
                      <span className="font-medium text-[12px]">{plugin.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full capitalize" style={{ backgroundColor: 'var(--theme-selection)', color: 'var(--theme-foreground-muted)' }}>{plugin.category}</span>
                    </div>
                    <p className="text-[11px] mt-0.5 leading-tight" style={{ color: 'var(--theme-foreground-muted)' }}>{plugin.description}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {plugin.rating && renderStars(plugin.rating)}
                      {plugin.downloads && <span className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}><Download size={9} className="inline mr-0.5" />{formatDownloads(plugin.downloads)}</span>}
                      <span className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)' }}>v{plugin.version}</span>
                    </div>
                  </div>
                  <button onClick={() => installedIds.has(plugin.id) ? handleUninstall(plugin.id) : handleInstall(plugin.id)}
                    disabled={actionLoading === plugin.id}
                    className="ml-2 px-2.5 py-1 rounded text-[11px] font-medium flex-shrink-0 disabled:opacity-50"
                    style={{ backgroundColor: installedIds.has(plugin.id) ? 'transparent' : 'var(--theme-accent)', color: installedIds.has(plugin.id) ? 'var(--theme-foreground-muted)' : '#fff', border: installedIds.has(plugin.id) ? '1px solid var(--theme-border)' : 'none' }}>
                    {actionLoading === plugin.id ? '...' : installedIds.has(plugin.id) ? <><Check size={11} className="inline mr-0.5" />Installed</> : 'Install'}
                  </button>
                </div>
              </div>
            ))
          )
        )}

        {tab === 'installed' && (
          installed.length === 0 ? (
            <div className="text-center py-8" style={{ color: 'var(--theme-foreground-muted)' }}>
              <Package size={32} className="mx-auto mb-2 opacity-30" />
              <p>No extensions installed</p>
              <p className="text-[10px] mt-1">Browse the marketplace to discover extensions</p>
            </div>
          ) : (
            installed.map(plugin => (
              <div key={plugin.id} className="p-2.5 rounded" style={{ backgroundColor: 'var(--theme-bg-secondary, #2d2d2d)', border: '1px solid var(--theme-border)' }}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Package size={14} style={{ color: categoryColors[plugin.category] || 'var(--theme-accent)' }} />
                      <span className="font-medium">{plugin.name}</span>
                      <span className="text-[10px]" style={{ color: plugin.enabled ? '#4ade80' : 'var(--theme-foreground-muted)' }}>{plugin.enabled ? 'Active' : 'Disabled'}</span>
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--theme-foreground-muted)' }}>{plugin.description}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <button onClick={() => handleToggle(plugin.id, !plugin.enabled)} className="p-1 rounded hover:opacity-80" title={plugin.enabled ? 'Disable' : 'Enable'}>
                      {plugin.enabled ? <ToggleRight size={18} className="text-green-400" /> : <ToggleLeft size={18} style={{ color: 'var(--theme-foreground-muted)' }} />}
                    </button>
                    <button onClick={() => handleUninstall(plugin.id)} className="p-1 rounded hover:opacity-80" style={{ color: 'var(--theme-foreground-muted)' }} title="Uninstall"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
};
