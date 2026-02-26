/**
 * useChatSettings — Manages all LLM inference settings with persistence.
 * Extracted from ChatPanel to reduce state sprawl.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

export interface ChatSettings {
  temperature: number;
  maxTokens: number;
  contextSize: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  seed: number;
  reasoningEffort: 'low' | 'medium' | 'high';
  thinkingBudget: number;
  maxIterations: number;
  gpuPreference: 'auto' | 'cpu';
  useWebSearch: boolean;
  useRAG: boolean;
  ttsEnabled: boolean;
  autoMode: boolean;
  planMode: boolean;
  cloudProvider: string | null;
  cloudModel: string | null;
}

export interface ChatSettingsActions {
  setTemperature: (v: number) => void;
  setMaxTokens: (v: number) => void;
  setContextSize: (v: number) => void;
  setTopP: (v: number) => void;
  setTopK: (v: number) => void;
  setRepeatPenalty: (v: number) => void;
  setSeed: (v: number) => void;
  setReasoningEffort: (v: 'low' | 'medium' | 'high') => void;
  setThinkingBudget: (v: number) => void;
  setMaxIterations: (v: number) => void;
  setGpuPreference: (v: 'auto' | 'cpu') => void;
  setUseWebSearch: (v: boolean) => void;
  setUseRAG: (v: boolean) => void;
  setTtsEnabled: (v: boolean) => void;
  setAutoMode: (v: boolean) => void;
  setPlanMode: (v: boolean) => void;
  setCloudProvider: (v: string | null) => void;
  setCloudModel: (v: string | null) => void;
  resetToDefaults: () => void;
}

export function useChatSettings(): ChatSettings & ChatSettingsActions {
  const [temperature, setTemperature] = useState(0.5);
  const [maxTokens, setMaxTokens] = useState(16384);
  const [contextSize, setContextSize] = useState(0);
  const [topP, setTopP] = useState(0.9);
  const [topK, setTopK] = useState(20);
  const [repeatPenalty, setRepeatPenalty] = useState(1.15);
  const [seed, setSeed] = useState(-1);
  const [reasoningEffort, setReasoningEffort] = useState<'low' | 'medium' | 'high'>('medium');
  const [thinkingBudget, setThinkingBudget] = useState(0); // 0 = auto (model profile), -1 = unlimited, >0 = exact token cap
  const [maxIterations, setMaxIterations] = useState(50);
  const [gpuPreference, setGpuPreference] = useState<'auto' | 'cpu'>('auto');
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [useRAG, setUseRAG] = useState(true);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [cloudProvider, setCloudProvider] = useState<string | null>(() => {
    try { return localStorage.getItem('guide-cloud-provider') || 'cerebras'; } catch { return 'cerebras'; }
  });
  const [cloudModel, setCloudModel] = useState<string | null>(() => {
    try { return localStorage.getItem('guide-cloud-model') || 'gpt-oss-120b'; } catch { return 'gpt-oss-120b'; }
  });

  // One-time migration: migrate removed models (zai-glm-4.7 was removed) back to gpt-oss-120b.
  useEffect(() => {
    try {
      const migrated = localStorage.getItem('guide-cloud-default-model-migrated-v3');
      if (migrated === 'true') return;
      const storedProvider = localStorage.getItem('guide-cloud-provider') || 'cerebras';
      const storedModel = localStorage.getItem('guide-cloud-model');
      if (storedProvider === 'cerebras' && (!storedModel || storedModel === 'zai-glm-4.7' || storedModel === 'glm-4-9b')) {
        localStorage.setItem('guide-cloud-model', 'gpt-oss-120b');
        setCloudModel('gpt-oss-120b');
      }
      localStorage.setItem('guide-cloud-default-model-migrated-v3', 'true');
    } catch {
      // ignore
    }
  }, []);

  // Load persisted settings on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI?.loadSettings?.();
        if (result?.success && result.settings) {
          const s = result.settings;
          if (s.temperature !== undefined) setTemperature(s.temperature);
          if (s.maxTokens !== undefined) setMaxTokens(s.maxTokens);
          if (s.contextSize !== undefined) setContextSize(s.contextSize);
          if (s.topP !== undefined) setTopP(s.topP);
          if (s.topK !== undefined) setTopK(s.topK);
          if (s.repeatPenalty !== undefined) setRepeatPenalty(s.repeatPenalty);
          if (s.seed !== undefined) setSeed(s.seed);
          if (s.maxIterations !== undefined) setMaxIterations(s.maxIterations);
          if (s.cloudProvider !== undefined && s.cloudProvider !== null) setCloudProvider(s.cloudProvider);
          if (s.cloudModel !== undefined && s.cloudModel !== null) setCloudModel(s.cloudModel);
          if (s.useWebSearch !== undefined) setUseWebSearch(s.useWebSearch);
          if (s.useRAG !== undefined) setUseRAG(s.useRAG);
          if (s.ttsEnabled !== undefined) setTtsEnabled(s.ttsEnabled);
          if (s.autoMode !== undefined) setAutoMode(s.autoMode);
          if (s.gpuPreference !== undefined) setGpuPreference(s.gpuPreference);
        }
      } catch { /* first run, no settings yet */ }
    })();
  }, []);

  // Debounced auto-save when settings change
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (settingsSaveTimerRef.current === undefined) return;
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = setTimeout(() => {
      window.electronAPI?.saveSettings?.({
        temperature, maxTokens, contextSize, topP, topK,
        repeatPenalty, seed, maxIterations,
        cloudProvider, cloudModel,
        useWebSearch, useRAG, ttsEnabled, autoMode, gpuPreference,
      });
      (window as any).electronAPI?.llmUpdateParams?.({
        maxTokens, temperature, topP, topK, repeatPenalty, seed,
      });
    }, 500);
    return () => { if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current); };
  }, [temperature, maxTokens, contextSize, topP, topK, repeatPenalty, seed, maxIterations, cloudProvider, cloudModel, useWebSearch, useRAG, ttsEnabled, autoMode, gpuPreference]);

  // Initialize the save timer ref after first render
  useEffect(() => {
    settingsSaveTimerRef.current = null;
  }, []);

  // Plan mode persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem('guide-plan-mode');
      if (saved === 'true') setPlanMode(true);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('guide-plan-mode', String(planMode)); } catch {}
  }, [planMode]);

  // Persist cloud provider/model to localStorage
  useEffect(() => {
    if (cloudProvider) localStorage.setItem('guide-cloud-provider', cloudProvider);
    if (cloudModel) localStorage.setItem('guide-cloud-model', cloudModel);
  }, [cloudProvider, cloudModel]);

  const resetToDefaults = useCallback(() => {
    setTemperature(0.5);
    setMaxTokens(4096);
    setContextSize(0);
    setTopP(0.9);
    setTopK(20);
    setRepeatPenalty(1.15);
    setSeed(-1);
    setReasoningEffort('medium');
    setThinkingBudget(0);
    setMaxIterations(50);
    (window as any).electronAPI?.llmSetContextSize?.(0);
    (window as any).electronAPI?.llmSetReasoningEffort?.('medium');
  }, []);

  return {
    temperature, maxTokens, contextSize, topP, topK, repeatPenalty, seed,
    reasoningEffort, thinkingBudget, maxIterations, gpuPreference, useWebSearch, useRAG,
    ttsEnabled, autoMode, planMode, cloudProvider, cloudModel,
    setTemperature, setMaxTokens, setContextSize, setTopP, setTopK,
    setRepeatPenalty, setSeed, setReasoningEffort, setThinkingBudget, setMaxIterations,
    setGpuPreference, setUseWebSearch, setUseRAG, setTtsEnabled,
    setAutoMode, setPlanMode, setCloudProvider, setCloudModel,
    resetToDefaults,
  };
}
