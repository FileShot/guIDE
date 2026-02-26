import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Cpu, Cloud, Check, Key, FolderPlus, Sparkles, Loader2,
  ChevronDown, ChevronRight, Star, Eye, ImageIcon,
} from 'lucide-react';
import type { LLMStatusEvent, AvailableModel, OpenRouterModel, RecommendedModel } from '@/types/electron';

// ── Vision capability lookup (mirrors cloudLLMService._supportsVision) ──────────────────
const VISION_MODEL_SUBSTRINGS: Record<string, string[]> = {
  openai:     ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  anthropic:  ['claude-sonnet-4', 'claude-3-5-sonnet', 'claude-3-haiku'],
  google:     ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-3'],
  xai:        ['grok-3', 'grok-3-mini'],
  openrouter: ['gemini', 'gpt-4o', 'claude-3', 'pixtral', 'llava', 'vision', 'multimodal'],
  mistral:    ['pixtral'],
};

function isVisionModel(provider: string, modelId: string): boolean {
  const substrings = VISION_MODEL_SUBSTRINGS[provider];
  if (!substrings) return false;
  const lower = modelId.toLowerCase();
  return substrings.some(s => lower.includes(s.toLowerCase()));
}

// ── Provider metadata for display & signup URLs ──
export const PROVIDER_INFO: Record<string, { signupUrl: string; free: boolean; placeholder: string; note?: string }> = {
  groq:       { signupUrl: 'https://console.groq.com/keys', free: true, placeholder: 'gsk_...', note: 'Ultra-fast, 1000 RPM, best free tier' },
  cerebras:   { signupUrl: 'https://cloud.cerebras.ai/', free: true, placeholder: 'csk-...', note: 'Ultra-fast, 7-key rotation built-in' },
  google:     { signupUrl: 'https://aistudio.google.com/apikey', free: true, placeholder: 'AIza...', note: '1M context, 15 RPM' },
  sambanova:  { signupUrl: 'https://cloud.sambanova.ai/apis', free: true, placeholder: 'aaede...', note: 'Free inference (limited daily quota)' },
  openrouter: { signupUrl: 'https://openrouter.ai/keys', free: true, placeholder: 'sk-or-...', note: '100+ free models' },
  apifreellm: { signupUrl: 'https://apifreellm.com', free: true, placeholder: 'apf_...', note: 'Free API access' },
  nvidia:     { signupUrl: 'https://build.nvidia.com/explore', free: true, placeholder: 'nvapi-...', note: 'Free NIM inference' },
  cohere:     { signupUrl: 'https://dashboard.cohere.com/api-keys', free: true, placeholder: 'trial key...', note: '1000 calls/mo, no CC' },
  mistral:    { signupUrl: 'https://console.mistral.ai/api-keys', free: true, placeholder: 'key...', note: 'Free tier, rate limited' },
  huggingface:{ signupUrl: 'https://huggingface.co/settings/tokens', free: true, placeholder: 'hf_...', note: 'Free inference API' },
  cloudflare: { signupUrl: 'https://dash.cloudflare.com/', free: true, placeholder: 'accountId:apiToken', note: '10K neurons/day free' },
  together:   { signupUrl: 'https://api.together.xyz/settings/api-keys', free: false, placeholder: '...' },
  fireworks:  { signupUrl: 'https://fireworks.ai/account/api-keys', free: false, placeholder: '...' },
  openai:     { signupUrl: 'https://platform.openai.com/api-keys', free: false, placeholder: 'sk-...' },
  anthropic:  { signupUrl: 'https://console.anthropic.com/settings/keys', free: false, placeholder: 'sk-ant-...' },
  xai:        { signupUrl: 'https://console.x.ai/', free: false, placeholder: 'xai-...' },
  perplexity: { signupUrl: 'https://www.perplexity.ai/settings/api', free: false, placeholder: 'pplx-...', note: 'Web-search grounded responses' },
  deepseek:   { signupUrl: 'https://platform.deepseek.com/api_keys', free: false, placeholder: 'sk-...', note: 'V3 + R1 reasoning' },
  ai21:       { signupUrl: 'https://studio.ai21.com/account/api-key', free: false, placeholder: 'key...', note: 'Jamba 256K context' },
  deepinfra:  { signupUrl: 'https://deepinfra.com/dash/api_keys', free: false, placeholder: 'key...', note: 'Pay-per-use, cheap inference' },
  hyperbolic: { signupUrl: 'https://app.hyperbolic.xyz/settings', free: false, placeholder: 'key...' },
  novita:     { signupUrl: 'https://novita.ai/settings/key-management', free: false, placeholder: 'key...' },
  moonshot:   { signupUrl: 'https://platform.moonshot.cn/console/api-keys', free: false, placeholder: 'key...', note: 'Kimi K2 agentic model' },
  upstage:    { signupUrl: 'https://console.upstage.ai/api-keys', free: false, placeholder: 'up-...' },
  lepton:     { signupUrl: 'https://dashboard.lepton.ai/', free: false, placeholder: 'key...' },
};

export interface ModelPickerProps {
  show: boolean;
  onClose: () => void;

  // Cloud model state (shared with ChatPanel)
  cloudProvider: string | null;
  cloudModel: string | null;
  setCloudProvider: (p: string | null) => void;
  setCloudModel: (m: string | null) => void;
  cloudProviders: { provider: string; label: string; models: { id: string; name: string }[] }[];
  allCloudProviders: { provider: string; label: string; models: { id: string; name: string }[]; hasKey: boolean; isBundled?: boolean }[];

  // Favorites (shared)
  favoriteModels: Set<string>;
  toggleFavorite: (key: string) => void;

  // Local models
  availableModels: AvailableModel[];
  isUsingCloud: boolean;
  llmStatus: LLMStatusEvent;
  switchModel: (model: AvailableModel) => void;
  switchImageModel?: (model: AvailableModel) => void;
  activeImageModelPath?: string | null;

  // Actions
  cancelAndResetStream: () => void;
  refreshAllProviders: () => void;
  refreshCloudProviders: () => void;
  addSystemMessage: (content: string) => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  show,
  onClose,
  cloudProvider,
  cloudModel,
  setCloudProvider,
  setCloudModel,
  cloudProviders,
  allCloudProviders,
  favoriteModels,
  toggleFavorite,
  availableModels,
  isUsingCloud,
  llmStatus,
  switchModel,
  switchImageModel,
  activeImageModelPath,
  cancelAndResetStream,
  refreshAllProviders,
  refreshCloudProviders,
  addSystemMessage,
}) => {
  // ── Internal state (only used by model picker) ──
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [inlineKeyValues, setInlineKeyValues] = useState<Record<string, string>>({});
  const [inlineKeyStatus, setInlineKeyStatus] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});
  const [keyTestBusy, setKeyTestBusy] = useState(false);
  const [providerTestStatus, setProviderTestStatus] = useState<Record<string, { state: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>>({});
  const [openRouterModels, setOpenRouterModels] = useState<{ free: OpenRouterModel[]; paid: OpenRouterModel[] } | null>(null);
  const [orModelSearch, setOrModelSearch] = useState('');
  const [orShowPaid, setOrShowPaid] = useState(false);
  const [orLoading, setOrLoading] = useState(false);
  const [showCloudProviders, setShowCloudProviders] = useState(false);
  const [showRecommended, setShowRecommended] = useState(false);
  const [recommendedModels, setRecommendedModels] = useState<{ recommended: RecommendedModel[]; other: RecommendedModel[]; maxModelGB: number; vramGB: number } | null>(null);
  const [showOtherModels, setShowOtherModels] = useState(false);
  const [showOwnKeySection, setShowOwnKeySection] = useState(false);
  const [showPremiumSection, setShowPremiumSection] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Map<string, { progress: number; downloadedMB: string; totalMB: string; complete?: boolean; error?: string }>>(new Map());

  // ── Fetch OpenRouter live model catalog ──
  const fetchOpenRouterModels = useCallback(async () => {
    if (orLoading) return;
    setOrLoading(true);
    try {
      const result = await window.electronAPI?.cloudLLMFetchOpenRouterModels?.();
      if (result?.success && result.free && result.paid) {
        setOpenRouterModels({ free: result.free, paid: result.paid });
      }
    } catch { /* ignore */ }
    setOrLoading(false);
  }, [orLoading]);

  // Auto-fetch OpenRouter models when provider is configured
  useEffect(() => {
    const hasOpenRouter = cloudProviders.some(p => p.provider === 'openrouter');
    if (hasOpenRouter && !openRouterModels) {
      fetchOpenRouterModels();
    }
  }, [cloudProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Model download progress listener ──
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onModelDownloadProgress) return;

    const cleanupDownload = api.onModelDownloadProgress((data: { fileName: string; progress: number; downloadedMB: string; totalMB: string; complete?: boolean }) => {
      setDownloadProgress(prev => {
        const next = new Map(prev);
        if (data.complete) {
          next.delete(data.fileName);
          api.modelsScan?.();
        } else {
          next.set(data.fileName, data);
        }
        return next;
      });
    });

    return () => { cleanupDownload?.(); };
  }, []);

  if (!show) return null;

  const testProviderKey = async (provider: string, model?: string) => {
    setProviderTestStatus(prev => ({ ...prev, [provider]: { state: 'testing' } }));
    try {
      const r = await window.electronAPI?.cloudLLMTestKey?.(provider, model);
      if (r && (r as any).success) {
        const ok = r as any;
        setProviderTestStatus(prev => ({ ...prev, [provider]: { state: 'ok', message: `${ok.latencyMs}ms` } }));
        addSystemMessage(`**${provider}** key OK (${ok.model}, ${ok.latencyMs}ms).`);
      } else {
        const bad = r as any;
        const cat = bad?.category || 'error';
        const msg = bad?.message || bad?.error || 'Unknown error';
        setProviderTestStatus(prev => ({ ...prev, [provider]: { state: 'fail', message: cat } }));
        addSystemMessage(`**${provider}** key test failed (${cat}): ${msg}`);
      }
    } catch (e: any) {
      setProviderTestStatus(prev => ({ ...prev, [provider]: { state: 'fail', message: 'error' } }));
      addSystemMessage(`**${provider}** key test failed: ${e?.message || String(e)}`);
    }
  };

  const testAllConfiguredKeys = async () => {
    if (keyTestBusy) return;
    setKeyTestBusy(true);
    try {
      const r = await window.electronAPI?.cloudLLMTestAllConfiguredKeys?.();
      if (!r?.success) {
        addSystemMessage(`Key test runner failed: ${r?.error || 'Unknown error'}`);
        return;
      }
      const results = Array.isArray((r as any).results) ? (r as any).results : [];
      const ok = results.filter((x: any) => x?.success);
      const bad = results.filter((x: any) => !x?.success);
      addSystemMessage(
        `🔎 Key test complete: **${ok.length} OK**, **${bad.length} failed**.` +
        (bad.length ? `\n\nFailures:\n${bad.map((b: any) => `- ${b.provider || '?'}: ${b.category || 'error'} — ${b.message || b.error || 'Unknown error'}`).join('\n')}` : '')
      );
    } finally {
      setKeyTestBusy(false);
    }
  };

  return (
    <div className="absolute bottom-[90px] left-0 right-0 px-3 z-50 chat-dropdown-panel">
      <div className="bg-[#3c3c3c] rounded border border-[#454545] overflow-hidden max-h-[400px] overflow-y-auto chat-dropdown-panel shadow-xl">
        {/* Favorite models — quick access section */}
        {favoriteModels.size > 0 && (() => {
          const favEntries: { key: string; label: string; sublabel?: string; isCloud: boolean; provider?: string; modelId?: string; localModel?: typeof availableModels[0] }[] = [];
          for (const fav of favoriteModels) {
            if (fav.includes(':')) {
              const [prov, ...rest] = fav.split(':');
              const modelId = rest.join(':');
              const cp = cloudProviders.find(p => p.provider === prov);
              const cm = cp?.models.find(m => m.id === modelId);
              favEntries.push({ key: fav, label: cm?.name || modelId, sublabel: cp?.label || prov, isCloud: true, provider: prov, modelId });
            } else {
              const lm = availableModels.find(m => m.path === fav);
              if (lm) favEntries.push({ key: fav, label: lm.name, sublabel: lm.sizeFormatted, isCloud: false, localModel: lm });
            }
          }
          if (favEntries.length === 0) return null;
          return (
            <>
              <div className="px-2 py-1 text-[10px] text-[#858585] uppercase tracking-wider bg-[#2d2d2d] border-b border-[#454545] flex items-center gap-1">
                <Star size={10} className="text-[#dcdcaa] fill-[#dcdcaa]" /> Favorites
              </div>
              {favEntries.map(f => (
                <button
                  key={f.key}
                  className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-[#094771] flex items-center gap-2"
                  onClick={() => {
                    cancelAndResetStream();
                    if (f.isCloud && f.provider && f.modelId) {
                      setCloudProvider(f.provider);
                      setCloudModel(f.modelId);
                    } else if (f.localModel) {
                      setCloudProvider(null);
                      setCloudModel(null);
                      switchModel(f.localModel);
                    }
                    onClose();
                  }}
                >
                  {f.isCloud ? <Cloud size={11} className="flex-shrink-0 text-[#3794ff]" /> : <Cpu size={11} className="flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[#cccccc]">{f.label}</div>
                    {f.sublabel && <div className="text-[10px] text-[#858585] truncate">{f.sublabel}</div>}
                  </div>
                  {f.isCloud && f.provider && f.modelId && isVisionModel(f.provider, f.modelId) && (
                    <Eye size={10} className="flex-shrink-0 text-[#9cdcfe]" title="Vision: accepts image input" />
                  )}
                  <button
                    className="p-0.5 flex-shrink-0 hover:bg-[#555] rounded"
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(f.key); }}
                    title="Remove from favorites"
                  >
                    <Star size={10} className="text-[#dcdcaa] fill-[#dcdcaa]" />
                  </button>
                </button>
              ))}
            </>
          );
        })()}

        {/* Cloud providers — show ALL with inline API key input for unconfigured */}
        {allCloudProviders.length > 0 && (() => {
          // Include non-bundled free providers AND bundled providers where users can supplement with their own key
          const freeProviders = allCloudProviders.filter(p => PROVIDER_INFO[p.provider]?.free && (!p.isBundled || p.provider === 'cerebras' || p.provider === 'sambanova'));
          const paidProviders = allCloudProviders.filter(p => !PROVIDER_INFO[p.provider]?.free && !p.isBundled);

          const renderProvider = (provider: typeof allCloudProviders[0]) => {
            const isExpanded = expandedProviders.has(provider.provider);
            const info = PROVIDER_INFO[provider.provider];
            const toggleExpand = () => {
              setExpandedProviders(prev => {
                const next = new Set(prev);
                if (next.has(provider.provider)) next.delete(provider.provider);
                else next.add(provider.provider);
                return next;
              });
            };

            // Handle inline key save
            const handleInlineKeySave = async () => {
              const key = inlineKeyValues[provider.provider];
              if (!key) return;
              setInlineKeyStatus(prev => ({ ...prev, [provider.provider]: 'saving' }));
              try {
                await window.electronAPI?.cloudLLMSetKey?.(provider.provider, key);
                setInlineKeyStatus(prev => ({ ...prev, [provider.provider]: 'saved' }));
                setInlineKeyValues(prev => ({ ...prev, [provider.provider]: '' }));
                await refreshAllProviders();
                await refreshCloudProviders();
                setTimeout(() => setInlineKeyStatus(prev => ({ ...prev, [provider.provider]: 'idle' })), 2000);
              } catch {
                setInlineKeyStatus(prev => ({ ...prev, [provider.provider]: 'error' }));
              }
            };

            // Handle inline key clear
            const handleInlineKeyClear = async () => {
              await window.electronAPI?.cloudLLMSetKey?.(provider.provider, '');
              await refreshAllProviders();
              await refreshCloudProviders();
            };

            // OpenRouter with key: show live catalog with search
            if (provider.provider === 'openrouter' && provider.hasKey && openRouterModels) {
              const searchLower = orModelSearch.toLowerCase();
              const filteredFree = openRouterModels.free.filter(m =>
                !searchLower || m.name.toLowerCase().includes(searchLower) || m.id.toLowerCase().includes(searchLower)
              );
              const filteredPaid = orShowPaid ? openRouterModels.paid.filter(m =>
                !searchLower || m.name.toLowerCase().includes(searchLower) || m.id.toLowerCase().includes(searchLower)
              ) : [];

              const renderORModel = (m: OpenRouterModel) => (
                <button
                  key={`openrouter:${m.id}`}
                  className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-[#094771] flex items-center gap-2 ${
                    cloudProvider === 'openrouter' && cloudModel === m.id ? 'bg-[#094771]' : ''
                  }`}
                  onClick={() => {
                    cancelAndResetStream();
                    setCloudProvider('openrouter');
                    setCloudModel(m.id);
                    onClose();
                    setOrModelSearch('');
                    addSystemMessage(`Switched to **OpenRouter** → ${m.name}${m.free ? ' (Free)' : ''}`);
                  }}
                >
                  <Cloud size={11} className={`flex-shrink-0 ${m.free ? 'text-[#89d185]' : 'text-[#3794ff]'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[#cccccc]">{m.name}</div>
                    <div className="text-[9px] text-[#585858] truncate">
                      {m.free ? '[Free]' : `$${m.promptCost.toFixed(2)}/$${m.completionCost.toFixed(2)} per M tokens`}
                      {m.context > 0 && ` · ${Math.round(m.context / 1024)}K ctx`}
                    </div>
                  </div>
                  {isVisionModel('openrouter', m.id) && (
                    <Eye size={10} className="flex-shrink-0 text-[#9cdcfe]" title="Vision: accepts image input" />
                  )}
                  {cloudProvider === 'openrouter' && cloudModel === m.id && (
                    <Check size={11} className="ml-auto text-[#89d185] flex-shrink-0" />
                  )}
                </button>
              );

              return (
                <div key="openrouter">
                  <button
                    className="w-full px-2 py-1 text-[10px] text-[#858585] bg-[#333] flex items-center justify-between hover:bg-[#3c3c3c]"
                    onClick={toggleExpand}
                  >
                    <span className="flex items-center gap-1">
                      {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      <Check size={9} className="text-[#89d185]" />
                      OpenRouter ({openRouterModels.free.length + openRouterModels.paid.length} models)
                    </span>
                    <button
                      className="text-[9px] text-[#3794ff] hover:text-white"
                      onClick={(e) => { e.stopPropagation(); fetchOpenRouterModels(); }}
                      title="Refresh model list"
                    >
                      {orLoading ? '⟳' : '↻ Refresh'}
                    </button>
                  </button>
                  {isExpanded && (<>
                  {/* Search bar */}
                  <div className="px-2 py-1 bg-[#2d2d2d]">
                    <input
                      type="text"
                      className="w-full bg-[#1e1e1e] text-[11px] text-[#cccccc] px-2 py-1 rounded border border-[#454545] outline-none focus:border-[#007acc] placeholder-[#585858]"
                      placeholder="Search models..."
                      value={orModelSearch}
                      onChange={e => setOrModelSearch(e.target.value)}
                      onClick={e => e.stopPropagation()}
                    />
                  </div>
                  {/* Free models */}
                  {filteredFree.length > 0 && (
                    <>
                      <div className="px-2 py-0.5 text-[9px] text-[#89d185] bg-[#2a2d2a] uppercase tracking-wider">[Free] Models ({filteredFree.length})</div>
                      {filteredFree.slice(0, searchLower ? 50 : 20).map(renderORModel)}
                      {!searchLower && filteredFree.length > 20 && (
                        <div className="px-2 py-1 text-[9px] text-[#585858] text-center">Search to find more...</div>
                      )}
                    </>
                  )}
                  {/* Paid toggle */}
                  <button
                    className="w-full px-2 py-1 text-[10px] text-[#858585] hover:text-white bg-[#2d2d2d] border-t border-[#454545] text-left flex items-center gap-1"
                    onClick={(e) => { e.stopPropagation(); setOrShowPaid(!orShowPaid); }}
                  >
                    {orShowPaid ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    Paid Models ({openRouterModels.paid.length})
                  </button>
                  {orShowPaid && filteredPaid.length > 0 && (
                    <>
                      {filteredPaid.slice(0, searchLower ? 50 : 20).map(renderORModel)}
                      {!searchLower && filteredPaid.length > 20 && (
                        <div className="px-2 py-1 text-[9px] text-[#585858] text-center">Search to find more...</div>
                      )}
                    </>
                  )}
                  {/* Disconnect option */}
                  <button
                    className="w-full px-2 py-1 text-[9px] text-[#f44747] hover:text-[#ff6b6b] bg-[#2d2d2d] border-t border-[#454545] text-left"
                    onClick={(e) => { e.stopPropagation(); handleInlineKeyClear(); }}
                  >
                    Disconnect
                  </button>
                  </>)}
                </div>
              );
            }

            // All other providers (configured or not)
            return (
              <div key={provider.provider}>
                <button
                  className="w-full px-2 py-1 text-[10px] bg-[#333] flex items-center gap-1 hover:bg-[#3c3c3c] text-left"
                  onClick={toggleExpand}
                >
                  {isExpanded ? <ChevronDown size={10} className="text-[#858585]" /> : <ChevronRight size={10} className="text-[#858585]" />}
                  {provider.hasKey ? (
                    <Check size={9} className="text-[#89d185] flex-shrink-0" />
                  ) : (
                    <Key size={9} className="text-[#585858] flex-shrink-0" />
                  )}
                  <span className={provider.hasKey ? 'text-[#cccccc]' : 'text-[#858585]'}>
                    {provider.label}
                  </span>
                  {provider.hasKey && (
                    <span className="text-[9px] text-[#585858] ml-auto">({provider.models.length})</span>
                  )}
                  {!provider.hasKey && info?.note && (
                    <span className="text-[9px] text-[#585858] ml-auto truncate max-w-[120px]">{info.note}</span>
                  )}
                </button>
                {isExpanded && (
                  <>
                    {/* If NO key — show inline API key input */}
                    {!provider.hasKey && (
                      <div className="px-3 py-2 bg-[#2a2a2a] border-b border-[#454545]">
                        <div className="flex gap-1 mb-1.5">
                          <input
                            type="password"
                            className="flex-1 bg-[#1e1e1e] text-[#cccccc] text-[11px] px-2 py-1.5 rounded border border-[#454545] focus:border-[#007acc] outline-none"
                            placeholder={info?.placeholder || 'API key...'}
                            value={inlineKeyValues[provider.provider] || ''}
                            onChange={e => setInlineKeyValues(prev => ({ ...prev, [provider.provider]: e.target.value }))}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => { if (e.key === 'Enter') handleInlineKeySave(); }}
                          />
                          <button
                            className={`px-3 py-1 text-[10px] rounded font-medium ${
                              inlineKeyStatus[provider.provider] === 'saved'
                                ? 'bg-[#89d185] text-black'
                                : inlineKeyStatus[provider.provider] === 'error'
                                ? 'bg-[#f44747] text-white'
                                : 'bg-[#007acc] text-white hover:bg-[#006bb3]'
                            }`}
                            onClick={(e) => { e.stopPropagation(); handleInlineKeySave(); }}
                            disabled={!inlineKeyValues[provider.provider] || inlineKeyStatus[provider.provider] === 'saving'}
                          >
                            {inlineKeyStatus[provider.provider] === 'saving' ? '...' :
                             inlineKeyStatus[provider.provider] === 'saved' ? '✓' :
                             inlineKeyStatus[provider.provider] === 'error' ? '✗' : 'Connect'}
                          </button>
                        </div>
                        {provider.provider === 'cloudflare' && (
                          <p className="text-[9px] text-[#858585] mb-1">Format: accountId:apiToken</p>
                        )}
                        {info?.signupUrl && (
                          <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.electronAPI?.openExternal?.(info.signupUrl); }}
                            className="text-[9px] text-[#3794ff] hover:underline cursor-pointer"
                          >
                            Get free API key →
                          </a>
                        )}
                      </div>
                    )}
                    {/* If HAS key — show models */}
                    {provider.hasKey && (
                      <>
                        <button
                          className="w-full px-2 py-1 text-[9px] text-[#3794ff] hover:text-white bg-[#2d2d2d] border-b border-[#454545] text-left flex items-center justify-between"
                          onClick={(e) => {
                            e.stopPropagation();
                            const m = provider.models?.[0]?.id;
                            testProviderKey(provider.provider, m);
                          }}
                          title="Send one tiny request to validate this API key"
                        >
                          <span>Test key</span>
                          <span className="text-[#858585]">
                            {providerTestStatus[provider.provider]?.state === 'testing'
                              ? 'Testing...'
                              : providerTestStatus[provider.provider]?.state === 'ok'
                              ? `OK ${providerTestStatus[provider.provider]?.message || ''}`
                              : providerTestStatus[provider.provider]?.state === 'fail'
                              ? `Fail ${providerTestStatus[provider.provider]?.message || ''}`
                              : ''}
                          </span>
                        </button>
                        {provider.models.map(model => (
                          <button
                            key={`${provider.provider}:${model.id}`}
                            className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-[#094771] flex items-center gap-2 ${
                              cloudProvider === provider.provider && cloudModel === model.id ? 'bg-[#094771]' : ''
                            }`}
                            onClick={() => {
                              cancelAndResetStream();
                              setCloudProvider(provider.provider);
                              setCloudModel(model.id);
                              onClose();
                              addSystemMessage(`Switched to **${provider.label}** → ${model.name}`);
                            }}
                          >
                            <Cloud size={11} className="flex-shrink-0 text-[#3794ff]" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[#cccccc]">{model.name}</div>
                            </div>
                            {isVisionModel(provider.provider, model.id) && (
                              <Eye size={10} className="flex-shrink-0 text-[#9cdcfe]" title="Vision: accepts image input" />
                            )}
                            <button
                              className="p-0.5 flex-shrink-0 hover:bg-[#555] rounded"
                              onClick={(e) => { e.stopPropagation(); toggleFavorite(`${provider.provider}:${model.id}`); }}
                              title={favoriteModels.has(`${provider.provider}:${model.id}`) ? 'Remove from favorites' : 'Add to favorites'}
                            >
                              <Star size={10} className={favoriteModels.has(`${provider.provider}:${model.id}`) ? 'text-[#dcdcaa] fill-[#dcdcaa]' : 'text-[#555]'} />
                            </button>
                            {cloudProvider === provider.provider && cloudModel === model.id && (
                              <Check size={11} className="text-[#89d185] flex-shrink-0" />
                            )}
                          </button>
                        ))}
                        {/* Disconnect option */}
                        <button
                          className="w-full px-2 py-1 text-[9px] text-[#f44747] hover:text-[#ff6b6b] bg-[#2d2d2d] border-t border-[#454545] text-left"
                          onClick={(e) => { e.stopPropagation(); handleInlineKeyClear(); }}
                        >
                          Disconnect
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          };

          const configuredCount = allCloudProviders.filter(p => !p.isBundled && p.hasKey).length
            + (allCloudProviders.some(p => p.isBundled && p.hasKey) ? 1 : 0);

          return (
            <>
              {/* Cloud providers — collapsed by default */}
              <div className="border-b border-[#454545]">
                <button
                  className="w-full px-2 py-1 text-[10px] text-[#858585] uppercase tracking-wider bg-[#2d2d2d] flex items-center justify-between hover:bg-[#333] transition-colors"
                  onClick={() => setShowCloudProviders(v => !v)}
                >
                  <span className="flex items-center gap-1">
                    {showCloudProviders ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    <Cloud size={10} className="text-[#3794ff]" /> Cloud Providers
                    {configuredCount > 0 && (
                      <span className="ml-1 text-[9px] bg-[#007acc33] text-[#3794ff] px-1 rounded">{configuredCount} active</span>
                    )}
                  </span>
                  {showCloudProviders && (
                    <button
                      className="text-[9px] text-[#3794ff] hover:text-white"
                      onClick={(e) => { e.stopPropagation(); testAllConfiguredKeys(); }}
                      title="Validate all configured cloud keys"
                    >
                      {keyTestBusy ? 'Testing...' : 'Test keys'}
                    </button>
                  )}
                </button>
                {showCloudProviders && (
                  <>
                    {/* guIDE Cloud AI — single entry, auto-rotates internally, no user model selection */}
                    {(() => {
                      const BUNDLED = new Set(['cerebras', 'groq', 'sambanova', 'google', 'openrouter']);
                      const isGuideActive = BUNDLED.has(cloudProvider || '');
                      return (
                        <button
                          className={`w-full px-2 py-1.5 text-[11px] flex items-center gap-2 hover:bg-[#094771] ${
                            isGuideActive ? 'bg-[#094771]' : 'bg-[#2a2a2a]'
                          }`}
                          onClick={() => {
                            cancelAndResetStream();
                            setCloudProvider('cerebras');
                            setCloudModel('gpt-oss-120b');
                            onClose();
                            addSystemMessage('Switched to **guIDE Cloud AI**');
                          }}
                        >
                          {isGuideActive
                            ? <Check size={9} className="text-[#89d185] flex-shrink-0" />
                            : <Cloud size={9} className="text-[#3794ff] flex-shrink-0" />
                          }
                          <div className="min-w-0 flex-1 text-left">
                            <span className="text-[#cccccc]">guIDE Cloud AI</span>
                            <span className="text-[9px] text-[#89d185] ml-2">Free</span>
                          </div>
                          <span className="text-[9px] text-[#585858]">Auto</span>
                        </button>
                      );
                    })()}
                    {/* Free cloud providers (own key required) — collapsed by default */}
                    {freeProviders.length > 0 && (
                      <>
                        <button
                          className="w-full px-2 py-0.5 text-[9px] text-[#89d185] bg-[#1e1e1e] border-b border-[#454545] uppercase tracking-wider flex items-center gap-1 hover:bg-[#252525]"
                          onClick={() => setShowOwnKeySection(v => !v)}
                        >
                          {showOwnKeySection ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
                          Add Your Own Key — Free
                        </button>
                        {showOwnKeySection && freeProviders.map(renderProvider)}
                      </>
                    )}
                    {/* Premium cloud providers — collapsed by default */}
                    {paidProviders.length > 0 && (
                      <>
                        <button
                          className="w-full px-2 py-0.5 text-[9px] text-[#dcdcaa] bg-[#1e1e1e] border-b border-[#454545] border-t uppercase tracking-wider flex items-center gap-1 hover:bg-[#252525]"
                          onClick={() => setShowPremiumSection(v => !v)}
                        >
                          {showPremiumSection ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
                          Premium Providers
                        </button>
                        {showPremiumSection && paidProviders.map(renderProvider)}
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          );
        })()}

        {/* Quick Add — recommended models for download */}
        <div className="px-2 py-1 text-[10px] text-[#858585] uppercase tracking-wider bg-[#2d2d2d] border-b border-[#454545] border-t flex items-center justify-between">
          <button
            className="flex items-center gap-1 hover:text-[#cccccc] w-full"
            onClick={() => {
              if (!recommendedModels) {
                window.electronAPI?.getRecommendedModels().then(r => setRecommendedModels(r)).catch(() => {});
              }
              setShowRecommended(!showRecommended);
            }}
          >
            {showRecommended ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            <Sparkles size={10} className="text-[#dcdcaa]" /> Quick Add
            {recommendedModels && <span className="ml-1 text-[#608b4e]">{recommendedModels.recommended.length} recommended</span>}
          </button>
        </div>
        {showRecommended && (
          <div className="max-h-[260px] overflow-y-auto">
            {!recommendedModels ? (
              <div className="p-3 text-center text-[11px] text-[#858585]">
                <Loader2 size={14} className="animate-spin mx-auto mb-1" />
                Detecting hardware...
              </div>
            ) : (
              <>
                {recommendedModels.vramGB > 0 && (
                  <div className="px-2 py-1 text-[10px] text-[#608b4e] bg-[#1e1e1e] border-b border-[#3c3c3c]">
                    GPU: {recommendedModels.vramGB}GB VRAM · Best fit: ~{recommendedModels.maxModelGB}GB
                  </div>
                )}
                {/* Recommended — fits hardware */}
                {recommendedModels.recommended.map(m => {
                  const isAlreadyDownloaded = availableModels.some(am => am.fileName === m.file);
                  const dlProgress = downloadProgress.get(m.file);
                  return (
                    <div key={m.file} className="px-2 py-1.5 text-[11px] flex items-center gap-2 border-b border-[#3c3c3c]/30 hover:bg-[#ffffff06]">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[#cccccc] font-medium">{m.name}</span>
                          <span className={`text-[8px] px-1 rounded leading-tight ${m.category === 'coding' ? 'bg-[#2d4a2d] text-[#89d185]' : m.category === 'reasoning' ? 'bg-[#4a3d2d] text-[#dcdcaa]' : 'bg-[#2d3a4a] text-[#9cdcfe]'}`}>{m.category}</span>
                          <span className="text-[9px] text-[#606060]">{m.size}GB</span>
                        </div>
                        <div className="text-[10px] text-[#858585] leading-tight">{m.desc}</div>
                        {/* Download progress bar */}
                        {dlProgress && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <div className="flex-1 h-1 bg-[#3c3c3c] rounded-full overflow-hidden">
                              <div className="h-full bg-[#007acc] rounded-full transition-all duration-300" style={{ width: `${dlProgress.progress}%` }} />
                            </div>
                            <span className="text-[9px] text-[#858585] whitespace-nowrap">{dlProgress.downloadedMB}/{dlProgress.totalMB}MB</span>
                            <button
                              className="text-[9px] text-[#f48771] hover:text-[#ff6b6b]"
                              onClick={() => window.electronAPI?.modelsCancelDownload(m.file)}
                              title="Cancel download"
                            >
                              <X size={9} />
                            </button>
                          </div>
                        )}
                      </div>
                      {/* Action button */}
                      {isAlreadyDownloaded ? (
                        <span className="text-[9px] text-[#89d185] flex-shrink-0 flex items-center gap-0.5">
                          <Check size={10} /> Installed
                        </span>
                      ) : dlProgress ? (
                        <span className="text-[10px] text-[#007acc] flex-shrink-0">{dlProgress.progress}%</span>
                      ) : (
                        <button
                          className="p-1 bg-[#007acc] text-white rounded hover:bg-[#006bb3] flex-shrink-0 transition-colors"
                          onClick={async () => {
                            setDownloadProgress(prev => {
                              const next = new Map(prev);
                              next.set(m.file, { progress: 0, downloadedMB: '0', totalMB: String(Math.round(m.size * 1024)) });
                              return next;
                            });
                            const result = await window.electronAPI?.modelsDownloadHF({ url: m.downloadUrl, fileName: m.file });
                            if (result?.alreadyExists) {
                              setDownloadProgress(prev => { const next = new Map(prev); next.delete(m.file); return next; });
                              window.electronAPI?.modelsScan();
                            } else if (result && !result.success) {
                              setDownloadProgress(prev => { const next = new Map(prev); next.set(m.file, { ...prev.get(m.file)!, progress: 0, error: result.error }); return next; });
                            }
                          }}
                          title={`Download ${m.name} (${m.size}GB)`}
                        >
                          <FolderPlus size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {/* Other models — collapsed by default */}
                {recommendedModels.other.length > 0 && (
                  <>
                    <button
                      className="w-full px-2 py-1 text-[10px] text-[#858585] bg-[#1e1e1e] hover:text-[#cccccc] flex items-center gap-1"
                      onClick={() => setShowOtherModels(!showOtherModels)}
                    >
                      {showOtherModels ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                      Other Models ({recommendedModels.other.length}) — may exceed {recommendedModels.maxModelGB}GB limit
                    </button>
                    {showOtherModels && recommendedModels.other.map(m => {
                      const isAlreadyDownloaded = availableModels.some(am => am.fileName === m.file);
                      const dlProgress = downloadProgress.get(m.file);
                      return (
                        <div key={m.file} className="px-2 py-1 text-[11px] flex items-center gap-2 border-b border-[#3c3c3c]/30 opacity-60 hover:opacity-100 hover:bg-[#ffffff06]">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="text-[#cccccc]">{m.name}</span>
                              <span className="text-[9px] text-[#f48771]">{m.size}GB</span>
                            </div>
                            <div className="text-[10px] text-[#858585]">{m.desc}</div>
                            {dlProgress && (
                              <div className="mt-0.5 flex items-center gap-1.5">
                                <div className="flex-1 h-1 bg-[#3c3c3c] rounded-full overflow-hidden">
                                  <div className="h-full bg-[#007acc] rounded-full transition-all duration-300" style={{ width: `${dlProgress.progress}%` }} />
                                </div>
                                <span className="text-[9px] text-[#858585]">{dlProgress.downloadedMB}/{dlProgress.totalMB}MB</span>
                                <button className="text-[9px] text-[#f48771]" onClick={() => window.electronAPI?.modelsCancelDownload(m.file)}><X size={9} /></button>
                              </div>
                            )}
                          </div>
                          {isAlreadyDownloaded ? (
                            <span className="text-[9px] text-[#89d185] flex-shrink-0 flex items-center gap-0.5"><Check size={10} /> Installed</span>
                          ) : dlProgress ? (
                            <span className="text-[10px] text-[#007acc] flex-shrink-0">{dlProgress.progress}%</span>
                          ) : (
                            <button
                              className="p-1 bg-[#454545] text-[#cccccc] rounded hover:bg-[#555] flex-shrink-0"
                              onClick={async () => {
                                setDownloadProgress(prev => { const next = new Map(prev); next.set(m.file, { progress: 0, downloadedMB: '0', totalMB: String(Math.round(m.size * 1024)) }); return next; });
                                const result = await window.electronAPI?.modelsDownloadHF({ url: m.downloadUrl, fileName: m.file });
                                if (result?.alreadyExists) { setDownloadProgress(prev => { const next = new Map(prev); next.delete(m.file); return next; }); window.electronAPI?.modelsScan(); }
                                else if (result && !result.success) { setDownloadProgress(prev => { const next = new Map(prev); next.set(m.file, { ...prev.get(m.file)!, progress: 0, error: result.error }); return next; }); }
                              }}
                              title={`Download ${m.name} (${m.size}GB) — may not fit`}
                            >
                              <FolderPlus size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Local LLM models */}
        <div className="px-2 py-1 text-[10px] text-[#858585] uppercase tracking-wider bg-[#2d2d2d] border-b border-[#454545] border-t flex items-center gap-1">
          <Cpu size={10} /> Local Models
        </div>
        {availableModels.filter(m => m.modelType !== 'diffusion').length === 0 ? (
          <div className="p-2 text-[11px] text-[#858585]">
            No local models found. Add .gguf files below.
          </div>
        ) : (
          availableModels.filter(m => m.modelType !== 'diffusion').map(model => (
            <button
              key={model.path}
              className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-[#094771] flex items-center gap-2 ${
                !isUsingCloud && llmStatus.modelInfo?.name === model.name ? 'bg-[#094771]' : ''
              }`}
              onClick={() => {
                setCloudProvider(null);
                setCloudModel(null);
                switchModel(model);
              }}
            >
              <Cpu size={11} className="flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[#cccccc]">{model.name}</div>
                <div className="text-[10px] text-[#858585]">
                  {model.sizeFormatted} • {model.details.quantization} • {model.details.parameters}
                </div>
              </div>
              <button
                className="p-0.5 flex-shrink-0 hover:bg-[#555] rounded"
                onClick={(e) => { e.stopPropagation(); toggleFavorite(model.path); }}
                title={favoriteModels.has(model.path) ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star size={10} className={favoriteModels.has(model.path) ? 'text-[#dcdcaa] fill-[#dcdcaa]' : 'text-[#555]'} />
              </button>
              {!isUsingCloud && llmStatus.modelInfo?.name === model.name && (
                <Check size={11} className="text-[#89d185] flex-shrink-0" />
              )}
            </button>
          ))
        )}

        {/* Image Models — only shown when diffusion models are present */}
        {availableModels.filter(m => m.modelType === 'diffusion').length > 0 && (
          <>
            <div className="px-2 py-1 text-[10px] text-[#c586c0] uppercase tracking-wider bg-[#2d2d2d] border-b border-[#454545] border-t flex items-center gap-1">
              <ImageIcon size={10} /> Image Models
            </div>
            {availableModels.filter(m => m.modelType === 'diffusion').map(model => (
              <button
                key={model.path}
                className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-[#3a2a4a] flex items-center gap-2 ${
                  activeImageModelPath === model.path ? 'bg-[#3a2a4a]' : ''
                }`}
                onClick={() => {
                  setCloudProvider(null);
                  setCloudModel(null);
                  switchImageModel?.(model);
                  onClose();
                }}
              >
                <ImageIcon size={11} className="flex-shrink-0 text-[#c586c0]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[#cccccc]">{model.name}</div>
                  <div className="text-[10px] text-[#858585]">
                    {model.sizeFormatted} • {model.details.quantization}
                  </div>
                </div>
                {activeImageModelPath === model.path && (
                  <Check size={11} className="text-[#c586c0] flex-shrink-0" />
                )}
              </button>
            ))}
          </>
        )}
        <button
          className="w-full text-left px-2 py-1.5 text-[11px] text-[#3794ff] hover:bg-[#094771] border-t border-[#454545] flex items-center gap-2"
          onClick={async () => {
            const result = await window.electronAPI?.modelsAdd();
            if (result?.success && result.models.length > 0) {
              onClose();
            }
          }}
        >
          <FolderPlus size={11} />
          Add Model Files...
        </button>
        <button
          className="w-full text-left px-2 py-1.5 text-[11px] text-[#858585] hover:bg-[#094771]"
          onClick={async () => {
            await window.electronAPI?.modelsScan();
            onClose();
          }}
        >
          ↻ Rescan models
        </button>
      </div>
    </div>
  );
};
