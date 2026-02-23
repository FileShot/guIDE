import React, { useState, useEffect, useCallback } from 'react';
import { Save, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';

interface SettingsState {
  // LLM / Inference
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextSize: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  seed: number;
  maxAgenticIterations: number;
  // Hardware
  gpuPreference: 'auto' | 'cpu';
  gpuLayers: number;
  // Editor
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: 'on' | 'off' | 'wordWrapColumn';
  minimap: boolean;
  lineNumbers: 'on' | 'off' | 'relative';
  bracketPairColorization: boolean;
  formatOnPaste: boolean;
  formatOnType: boolean;
  // Advanced
  customInstructions: string;
  snapshotMaxChars: number;
  generationTimeoutSec: number;
  enableThinkingFilter: boolean;
  // Cloud (placeholder)
  cloudProvider: string;
  cloudApiKey: string;
  cloudModel: string;
}

const DEFAULTS: SettingsState = {
  systemPrompt: '',
  temperature: 0.4,
  maxTokens: 2048,
  contextSize: 16384,
  topP: 0.95,
  topK: 40,
  repeatPenalty: 1.1,
  seed: -1,
  maxAgenticIterations: 25,
  gpuPreference: 'auto',
  gpuLayers: 6,
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  tabSize: 2,
  wordWrap: 'on',
  minimap: true,
  lineNumbers: 'on',
  bracketPairColorization: true,
  formatOnPaste: false,
  formatOnType: false,
  customInstructions: '',
  snapshotMaxChars: 8000,
  generationTimeoutSec: 120,
  enableThinkingFilter: true,
  cloudProvider: 'none',
  cloudApiKey: '',
  cloudModel: '',
};

const CLOUD_PROVIDERS = [
  { id: 'none', label: 'Local Model (default)' },
  { id: 'groq', label: 'Groq (Free, Ultra-Fast)', models: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct', 'moonshotai/kimi-k2-instruct', 'openai/gpt-oss-120b', 'qwen/qwen3-32b', 'llama-3.1-8b-instant'] },
  { id: 'cerebras', label: 'Cerebras (Free, Ultra-Fast)', models: ['zai-glm-4.7', 'gpt-oss-120b', 'qwen-3-235b-a22b-instruct-2507', 'llama3.1-8b'] },
  { id: 'google', label: 'Google Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'] },
  { id: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'] },
  { id: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'] },
  { id: 'sambanova', label: 'SambaNova (Free)', models: ['DeepSeek-V3.2', 'DeepSeek-V3.1', 'DeepSeek-R1-0528', 'Meta-Llama-3.3-70B-Instruct', 'Llama-4-Maverick-17B-128E-Instruct', 'Qwen3-235B', 'Qwen3-32B', 'gpt-oss-120b', 'MiniMax-M2.5'] },
  { id: 'openrouter', label: 'OpenRouter', models: [] },
  { id: 'xai', label: 'xAI / Grok', models: ['grok-3', 'grok-3-mini'] },
  { id: 'apifreellm', label: 'APIFreeLLM (Free)', models: [] },
  { id: 'together', label: 'Together AI', models: [] },
  { id: 'fireworks', label: 'Fireworks AI', models: [] },
  { id: 'nvidia', label: 'NVIDIA NIM', models: [] },
  { id: 'cohere', label: 'Cohere', models: ['command-a-03-2025', 'command-r-plus', 'command-r'] },
  { id: 'mistral', label: 'Mistral AI', models: ['mistral-small-latest', 'mistral-large-latest', 'ministral-8b-latest'] },
  { id: 'huggingface', label: 'Hugging Face', models: [] },
  { id: 'cloudflare', label: 'Cloudflare Workers AI', models: [] },
];

// Collapsible section component
const Section: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-2">
      <button
        className="w-full flex items-center gap-1 py-2 px-3 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:opacity-80"
        style={{ color: 'var(--theme-foreground-muted)', backgroundColor: 'var(--theme-sidebar)', borderBottom: '1px solid var(--theme-sidebar-border)' }}
        onClick={() => setOpen(v => !v)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && <div className="px-3 py-2 space-y-3">{children}</div>}
    </div>
  );
};

// Input field components
const SliderField: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; hint?: string;
}> = ({ label, value, min, max, step, onChange, hint }) => (
  <div>
    <div className="flex justify-between items-center mb-1">
      <label className="text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>{label}</label>
      <input
        type="number"
        value={value}
        min={min} max={max} step={step}
        onChange={e => onChange(Number(e.target.value))}
        className="w-[70px] text-right text-[11px] px-1 py-0.5 rounded"
        style={{ backgroundColor: 'var(--theme-input-bg)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-sidebar-border)' }}
      />
    </div>
    <input
      type="range" value={value} min={min} max={max} step={step}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full h-1 rounded-lg appearance-none cursor-pointer accent-[var(--theme-accent)]"
      style={{ backgroundColor: 'var(--theme-sidebar-border)' }}
    />
    {hint && <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.6 }}>{hint}</div>}
  </div>
);

const SelectField: React.FC<{
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (v: string) => void; hint?: string;
}> = ({ label, value, options, onChange, hint }) => (
  <div>
    <label className="text-[11px] block mb-1" style={{ color: 'var(--theme-foreground-muted)' }}>{label}</label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full text-[12px] px-2 py-1 rounded"
      style={{ backgroundColor: 'var(--theme-input-bg)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-sidebar-border)' }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    {hint && <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.6 }}>{hint}</div>}
  </div>
);

const ToggleField: React.FC<{
  label: string; value: boolean; onChange: (v: boolean) => void; hint?: string;
}> = ({ label, value, onChange, hint }) => (
  <div className="flex items-center justify-between">
    <div>
      <label className="text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>{label}</label>
      {hint && <div className="text-[10px]" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.6 }}>{hint}</div>}
    </div>
    <button
      onClick={() => onChange(!value)}
      className="w-[36px] h-[18px] rounded-full transition-colors relative"
      style={{ backgroundColor: value ? 'var(--theme-accent)' : 'var(--theme-sidebar-border)' }}
    >
      <div
        className="w-[14px] h-[14px] rounded-full transition-transform absolute top-[2px]"
        style={{ backgroundColor: 'var(--theme-foreground)', transform: value ? 'translateX(20px)' : 'translateX(2px)' }}
      />
    </button>
  </div>
);

const TextAreaField: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  rows?: number; placeholder?: string; hint?: string;
}> = ({ label, value, onChange, rows = 4, placeholder, hint }) => (
  <div>
    <label className="text-[11px] block mb-1" style={{ color: 'var(--theme-foreground-muted)' }}>{label}</label>
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full text-[12px] px-2 py-1 rounded resize-y font-mono"
      style={{ backgroundColor: 'var(--theme-input-bg)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-sidebar-border)', minHeight: '60px' }}
    />
    {hint && <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.6 }}>{hint}</div>}
  </div>
);

const TextField: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; type?: string;
}> = ({ label, value, onChange, placeholder, hint, type = 'text' }) => (
  <div>
    <label className="text-[11px] block mb-1" style={{ color: 'var(--theme-foreground-muted)' }}>{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-[12px] px-2 py-1 rounded"
      style={{ backgroundColor: 'var(--theme-input-bg)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-sidebar-border)' }}
    />
    {hint && <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.6 }}>{hint}</div>}
  </div>
);

export const AdvancedSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<SettingsState>({ ...DEFAULTS });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toolDefsPreview, setToolDefsPreview] = useState<string>('');
  const [defaultPreamble, setDefaultPreamble] = useState<string>('');

  // Load settings on mount
  useEffect(() => {
    const load = async () => {
      try {
        // Load saved settings
        const stored = await (window as any).electronAPI?.loadSettings?.();
        // Load system prompt preview (default preamble + tool defs)
        const promptPreview = await (window as any).electronAPI?.getSystemPromptPreview?.();
        
        if (promptPreview) {
          setDefaultPreamble(promptPreview.defaultPreamble || '');
          setToolDefsPreview(promptPreview.toolDefinitions || '');
        }
        
        if (stored && stored.settings && typeof stored.settings === 'object') {
          setSettings(prev => {
            const merged = { ...prev };
            for (const key of Object.keys(prev)) {
              if (stored.settings[key] !== undefined) {
                (merged as any)[key] = stored.settings[key];
              }
            }
            // If no custom system prompt was saved, populate with the default
            if (!merged.systemPrompt && promptPreview?.defaultPreamble) {
              merged.systemPrompt = promptPreview.defaultPreamble;
            }
            return merged;
          });
        } else if (promptPreview?.defaultPreamble) {
          // No saved settings at all — populate system prompt with default
          setSettings(prev => ({ ...prev, systemPrompt: promptPreview.defaultPreamble }));
        }
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    };
    load();
  }, []);

  const update = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    try {
      await (window as any).electronAPI?.saveSettings?.(settings);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }, [settings]);

  const resetToDefaults = useCallback(() => {
    setSettings({ ...DEFAULTS });
    setDirty(true);
    setSaved(false);
  }, []);

  const selectedProvider = CLOUD_PROVIDERS.find(p => p.id === settings.cloudProvider);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header with save/reset */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--theme-sidebar-border)' }}>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={!dirty}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors"
            style={{
              backgroundColor: dirty ? 'var(--theme-accent)' : 'transparent',
              color: dirty ? '#fff' : 'var(--theme-foreground-muted)',
              opacity: dirty ? 1 : 0.5,
              cursor: dirty ? 'pointer' : 'default',
            }}
          >
            <Save size={12} />
            {saved ? 'Saved!' : 'Save'}
          </button>
          <button
            onClick={resetToDefaults}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors hover:opacity-80"
            style={{ color: 'var(--theme-foreground-muted)' }}
            title="Reset all to defaults"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        </div>
        {dirty && <span className="text-[10px]" style={{ color: 'var(--theme-accent)' }}>Unsaved changes</span>}
      </div>

      {/* Scrollable settings body */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Cloud Provider ───────────────────── */}
        <Section title="Cloud Provider / API" defaultOpen={false}>
          <SelectField
            label="Provider"
            value={settings.cloudProvider}
            options={CLOUD_PROVIDERS.map(p => ({ value: p.id, label: p.label }))}
            onChange={v => update('cloudProvider', v)}
            hint="Select 'Local Model' to use a GGUF model on your hardware."
          />
          {settings.cloudProvider !== 'none' && (
            <>
              <TextField
                label="API Key"
                value={settings.cloudApiKey}
                onChange={v => update('cloudApiKey', v)}
                type="password"
                placeholder="sk-..."
                hint="Your API key is stored locally and never sent anywhere except the provider."
              />
              {selectedProvider?.models && selectedProvider.models.length > 0 ? (
                <SelectField
                  label="Model"
                  value={settings.cloudModel}
                  options={[{ value: '', label: 'Select a model...' }, ...selectedProvider.models.map(m => ({ value: m, label: m }))]}
                  onChange={v => update('cloudModel', v)}
                />
              ) : (
                <TextField
                  label="Model ID"
                  value={settings.cloudModel}
                  onChange={v => update('cloudModel', v)}
                  placeholder="e.g. meta-llama/llama-3-70b"
                  hint="Enter the model identifier for this provider."
                />
              )}
            </>
          )}
        </Section>

        {/* ── LLM / Inference ──────────────────── */}
        <Section title="LLM / Inference" defaultOpen={true}>
          <SliderField label="Temperature" value={settings.temperature} min={0} max={2} step={0.05} onChange={v => update('temperature', v)} hint="Lower = more focused, higher = more creative" />
          <SliderField label="Max Tokens" value={settings.maxTokens} min={256} max={8192} step={256} onChange={v => update('maxTokens', v)} hint="Maximum tokens per generation" />
          <SliderField label="Context Size" value={settings.contextSize} min={2048} max={131072} step={1024} onChange={v => update('contextSize', v)} hint="Total context window for the model" />
          <SliderField label="Top-P" value={settings.topP} min={0} max={1} step={0.05} onChange={v => update('topP', v)} />
          <SliderField label="Top-K" value={settings.topK} min={1} max={100} step={1} onChange={v => update('topK', v)} />
          <SliderField label="Repeat Penalty" value={settings.repeatPenalty} min={1} max={2} step={0.05} onChange={v => update('repeatPenalty', v)} />
          <SliderField label="Seed" value={settings.seed} min={-1} max={99999} step={1} onChange={v => update('seed', v)} hint="-1 for random" />
        </Section>

        {/* ── Agentic Behavior ─────────────────── */}
        <Section title="Agentic Behavior" defaultOpen={false}>
          <SliderField label="Max Iterations" value={settings.maxAgenticIterations} min={1} max={100} step={1} onChange={v => update('maxAgenticIterations', v)} hint="Maximum tool-call iterations per task" />
          <SliderField label="Generation Timeout (sec)" value={settings.generationTimeoutSec} min={30} max={600} step={10} onChange={v => update('generationTimeoutSec', v)} hint="Abort generation after this many seconds" />
          <SliderField label="Snapshot Max Chars" value={settings.snapshotMaxChars} min={1000} max={30000} step={1000} onChange={v => update('snapshotMaxChars', v)} hint="Larger = more page detail but uses more context" />
          <ToggleField label="Filter Thinking Tokens" value={settings.enableThinkingFilter} onChange={v => update('enableThinkingFilter', v)} hint="Strip <think>...</think> from output" />
        </Section>

        {/* ── System Prompt ────────────────────── */}
        <Section title="System Prompt" defaultOpen={false}>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px]" style={{ color: 'var(--theme-foreground-muted)' }}>AI Identity & Behavior Prompt</label>
            {defaultPreamble && settings.systemPrompt !== defaultPreamble && (
              <button
                onClick={() => { update('systemPrompt', defaultPreamble); }}
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: 'var(--theme-accent)', border: '1px solid var(--theme-accent)', opacity: 0.8 }}
              >
                Reset to Default
              </button>
            )}
          </div>
          <textarea
            value={settings.systemPrompt}
            onChange={e => update('systemPrompt', e.target.value)}
            rows={10}
            className="w-full text-[12px] px-2 py-1 rounded resize-y font-mono"
            style={{ backgroundColor: 'var(--theme-input-bg)', color: 'var(--theme-foreground)', border: '1px solid var(--theme-sidebar-border)', minHeight: '120px' }}
          />
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-foreground-muted)', opacity: 0.6 }}>
            This is the system prompt sent to the AI. Edit freely — tool definitions are appended automatically below.
          </div>
          <TextAreaField
            label="Custom Instructions (appended to every message)"
            value={settings.customInstructions}
            onChange={v => update('customInstructions', v)}
            rows={4}
            placeholder="Always respond in markdown. Prefer TypeScript over JavaScript..."
            hint="Added to every user message. Use for persistent preferences."
          />
          {toolDefsPreview && (
            <div className="mt-2">
              <button
                onClick={() => {
                  const el = document.getElementById('tool-defs-preview');
                  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                }}
                className="text-[10px] underline cursor-pointer"
                style={{ color: 'var(--theme-foreground-muted)', opacity: 0.7, background: 'none', border: 'none', padding: 0 }}
              >
                View auto-injected tool definitions (read-only)
              </button>
              <pre
                id="tool-defs-preview"
                className="text-[10px] mt-1 px-2 py-1 rounded overflow-auto"
                style={{
                  display: 'none',
                  backgroundColor: 'var(--theme-sidebar)',
                  color: 'var(--theme-foreground-muted)',
                  border: '1px solid var(--theme-sidebar-border)',
                  maxHeight: '200px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  opacity: 0.7,
                }}
              >
                {toolDefsPreview}
              </pre>
            </div>
          )}
        </Section>

        {/* ── Hardware ─────────────────────────── */}
        <Section title="Hardware" defaultOpen={false}>
          <SelectField
            label="GPU Mode"
            value={settings.gpuPreference}
            options={[{ value: 'auto', label: 'Auto (GPU + CPU)' }, { value: 'cpu', label: 'CPU Only' }]}
            onChange={v => update('gpuPreference', v as 'auto' | 'cpu')}
            hint="Auto will use your GPU if available."
          />
          <SliderField label="GPU Layers" value={settings.gpuLayers} min={0} max={64} step={1} onChange={v => update('gpuLayers', v)} hint="Layers offloaded to GPU. More = faster but uses more VRAM." />
        </Section>

        {/* ── Editor ───────────────────────────── */}
        <Section title="Editor" defaultOpen={false}>
          <SliderField label="Font Size" value={settings.fontSize} min={8} max={32} step={1} onChange={v => update('fontSize', v)} />
          <TextField label="Font Family" value={settings.fontFamily} onChange={v => update('fontFamily', v)} />
          <SliderField label="Tab Size" value={settings.tabSize} min={1} max={8} step={1} onChange={v => update('tabSize', v)} />
          <SelectField
            label="Word Wrap"
            value={settings.wordWrap}
            options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'wordWrapColumn', label: 'At Column' }]}
            onChange={v => update('wordWrap', v as 'on' | 'off' | 'wordWrapColumn')}
          />
          <SelectField
            label="Line Numbers"
            value={settings.lineNumbers}
            options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'relative', label: 'Relative' }]}
            onChange={v => update('lineNumbers', v as 'on' | 'off' | 'relative')}
          />
          <ToggleField label="Minimap" value={settings.minimap} onChange={v => update('minimap', v)} />
          <ToggleField label="Bracket Pair Colorization" value={settings.bracketPairColorization} onChange={v => update('bracketPairColorization', v)} />
          <ToggleField label="Format on Paste" value={settings.formatOnPaste} onChange={v => update('formatOnPaste', v)} />
          <ToggleField label="Format on Type" value={settings.formatOnType} onChange={v => update('formatOnType', v)} />
        </Section>

        {/* Footer spacer */}
        <div className="h-4" />
      </div>
    </div>
  );
};
