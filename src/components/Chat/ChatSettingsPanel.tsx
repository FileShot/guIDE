/**
 * ChatSettingsPanel — LLM inference parameter sliders and controls.
 * Extracted from ChatPanel JSX.
 */
import React, { useState } from 'react';
import { Zap, Scale, Brain } from 'lucide-react';
import type { ChatSettings, ChatSettingsActions } from './hooks/useChatSettings';

type SettingsPanelProps = Pick<ChatSettings & ChatSettingsActions,
  'temperature' | 'setTemperature' |
  'reasoningEffort' | 'setReasoningEffort' |
  'thinkingBudget' | 'setThinkingBudget' |
  'maxTokens' | 'setMaxTokens' |
  'contextSize' | 'setContextSize' |
  'topP' | 'setTopP' |
  'topK' | 'setTopK' |
  'repeatPenalty' | 'setRepeatPenalty' |
  'seed' | 'setSeed' |
  'maxIterations' | 'setMaxIterations' |
  'gpuPreference' | 'setGpuPreference' |
  'resetToDefaults'
> & {
  useWebSearch?: boolean;
  setUseWebSearch?: (v: boolean) => void;
};

export const ChatSettingsPanel: React.FC<SettingsPanelProps> = ({
  temperature, setTemperature,
  reasoningEffort, setReasoningEffort,
  thinkingBudget, setThinkingBudget,
  maxTokens, setMaxTokens,
  contextSize, setContextSize,
  topP, setTopP,
  topK, setTopK,
  repeatPenalty, setRepeatPenalty,
  seed, setSeed,
  maxIterations, setMaxIterations,
  gpuPreference, setGpuPreference,
  resetToDefaults,
  useWebSearch, setUseWebSearch,
}) => {
  const [applied, setApplied] = useState<string | null>(null);
  const confirm = (key: string) => { setApplied(key); setTimeout(() => setApplied(null), 1800); };
  const Applied = ({ k }: { k: string }) => applied === k ? <span className="text-[#4ec9b0] text-[9px] ml-1 font-medium">✓</span> : null;
  return (
  <div className="px-3 py-2 border-b border-[#1e1e1e] flex-shrink-0 space-y-2 max-h-[280px] overflow-auto chat-dropdown-panel">
    {setUseWebSearch !== undefined && (
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-[#858585]">Web Search<Applied k="webSearch" /></label>
        <button
          className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${
            useWebSearch ? 'bg-[#007acc]' : 'bg-[#3c3c3c]'
          }`}
          onClick={() => { setUseWebSearch(!useWebSearch); confirm('webSearch'); }}
          aria-label={useWebSearch ? 'Disable web search' : 'Enable web search'}
        >
          <span
            className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
              useWebSearch ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    )}
    <div>
      <label className="text-[10px] text-[#858585]">Temperature: {temperature}</label>
      <input type="range" min="0" max="2" step="0.1" value={temperature}
        onChange={e => setTemperature(parseFloat(e.target.value))} className="w-full h-1 accent-[#007acc]" />
      <div className="flex justify-between text-[9px] text-[#585858]"><span>Precise</span><span>Creative</span></div>
    </div>
    <div>
      <label className="text-[10px] text-[#858585]">Reasoning Effort: <span className="text-[#cccccc] font-medium">{reasoningEffort.charAt(0).toUpperCase() + reasoningEffort.slice(1)}</span><Applied k="reasoning" /></label>
      <div className="flex gap-1 mt-1">
        {(['low', 'medium', 'high'] as const).map(level => (
          <button key={level}
            className={`flex-1 px-2 py-1 text-[10px] rounded border ${
              reasoningEffort === level
                ? 'bg-[#094771] border-[#007acc] text-[#cccccc]'
                : 'bg-[#2a2a2a] border-[#3c3c3c] text-[#858585] hover:bg-[#333]'
            }`}
            onClick={() => {
              setReasoningEffort(level);
              (window as any).electronAPI?.llmSetReasoningEffort?.(level);
              confirm('reasoning');
            }}
          >
            <span className="flex items-center justify-center gap-0.5">
              {level === 'low' ? <Zap size={10} /> : level === 'medium' ? <Scale size={10} /> : <Brain size={10} />}
              {level === 'low' ? 'Low' : level === 'medium' ? 'Med' : 'High'}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[9px] text-[#585858] mt-0.5">Controls thinking depth. Low = fast, High = thorough reasoning.</p>
    </div>
    <div>
      <label className="text-[10px] text-[#858585]">
        Thinking Budget:&nbsp;
        <span className="text-[#cccccc] font-medium">
          {thinkingBudget === 0 ? 'Auto' : thinkingBudget === -1 ? 'Unlimited' : `${thinkingBudget.toLocaleString()} tokens`}
        </span><Applied k="budget" />
      </label>
      <input
        type="range" min="0" max="32768" step="128" value={thinkingBudget === -1 ? 32768 : thinkingBudget}
        onChange={e => {
          const val = parseInt(e.target.value);
          setThinkingBudget(val);
          (window as any).electronAPI?.llmSetThinkingBudget?.(val);
          confirm('budget');
        }}
        className="w-full h-1 accent-[#007acc]"
      />
      <div className="flex items-center justify-between mt-0.5">
        <div className="flex justify-between text-[9px] text-[#585858] flex-1"><span>Auto</span><span>8K</span><span>16K</span><span>32K</span></div>
        <button
          className={`ml-2 text-[9px] px-1.5 py-0.5 rounded border ${thinkingBudget === -1 ? 'bg-[#094771] border-[#007acc] text-[#cccccc]' : 'bg-[#3c3c3c] border-[#3c3c3c] text-[#858585] hover:bg-[#4c4c4c]'}`}
          onClick={() => {
            const next = thinkingBudget === -1 ? 0 : -1;
            setThinkingBudget(next);
            (window as any).electronAPI?.llmSetThinkingBudget?.(next);
            confirm('budget');
          }}
        >∞ No Cap</button>
      </div>
      <p className="text-[9px] text-[#585858] mt-0.5">Auto = model-scaled default. No Cap = let the model think as long as it needs.</p>
    </div>
    <div>
      <label className="text-[10px] text-[#858585]">Max Tokens: {maxTokens}</label>
      <input type="range" min="256" max="131072" step="256" value={maxTokens}
        onChange={e => setMaxTokens(parseInt(e.target.value))} className="w-full h-1 accent-[#007acc]" />
      <div className="flex justify-between text-[9px] text-[#585858]"><span>256</span><span>131K</span></div>
    </div>
    <div>
      <label className="text-[10px] text-[#858585]">Context Size: {contextSize === 0 ? 'Auto (Fast)' : contextSize >= 1024 ? `${(contextSize/1024).toFixed(0)}K` : contextSize}{contextSize > 32768 ? ' ⚠ needs VRAM' : contextSize === 0 ? '' : ' tokens'}<Applied k="context" /></label>
      <input type="range" min="0" max="262144" step="8192" value={contextSize}
        onChange={e => {
          const val = parseInt(e.target.value);
          setContextSize(val);
          (window as any).electronAPI?.llmSetContextSize?.(val);
          confirm('context');
        }} className="w-full h-1 accent-[#007acc]" />
      <div className="flex justify-between text-[9px] text-[#585858]"><span>Auto</span><span>32K</span><span>64K</span><span>128K</span><span>256K</span></div>
      <p className="text-[9px] text-[#585858] mt-0.5">Auto = fast (8-16K). Higher needs more VRAM/RAM. Reloads model.</p>
    </div>
    <div>
      <label className="text-[10px] text-[#858585]">Top-P (Nucleus): {topP}</label>
      <input type="range" min="0" max="1" step="0.05" value={topP}
        onChange={e => setTopP(parseFloat(e.target.value))} className="w-full h-1 accent-[#007acc]" />
      <div className="flex justify-between text-[9px] text-[#585858]"><span>Narrow</span><span>Wide</span></div>
    </div>
    <div>
      <label className="text-[10px] text-[#858585]">Top-K: {topK}</label>
      <input type="range" min="1" max="100" step="1" value={topK}
        onChange={e => setTopK(parseInt(e.target.value))} className="w-full h-1 accent-[#007acc]" />
      <div className="flex justify-between text-[9px] text-[#585858]"><span>1</span><span>100</span></div>
    </div>
    <div>
      <label className="text-[10px] text-[#858585]">Repeat Penalty: {repeatPenalty}</label>
      <input type="range" min="1.0" max="2.0" step="0.05" value={repeatPenalty}
        onChange={e => setRepeatPenalty(parseFloat(e.target.value))} className="w-full h-1 accent-[#007acc]" />
      <div className="flex justify-between text-[9px] text-[#585858]"><span>Off</span><span>Strong</span></div>
    </div>
    <div>
      <label className="text-[10px] text-[#858585]">Seed: {seed === -1 ? 'Random' : seed}</label>
      <div className="flex items-center gap-2">
        <input type="number" min="-1" max="999999" value={seed}
          onChange={e => setSeed(parseInt(e.target.value) || -1)}
          className="flex-1 bg-[#3c3c3c] text-[#cccccc] text-[11px] px-2 py-0.5 rounded border border-[#3c3c3c] focus:border-[#007acc] outline-none" />
        <button className="text-[9px] text-[#858585] hover:text-white px-1.5 py-0.5 rounded bg-[#3c3c3c] hover:bg-[#4c4c4c]"
          onClick={() => setSeed(-1)}>Random</button>
      </div>
    </div>
    <button className="w-full text-[10px] text-[#858585] hover:text-white py-1 rounded bg-[#3c3c3c] hover:bg-[#4c4c4c] mt-1"
      onClick={resetToDefaults}>Reset to Defaults</button>
    <div className="border-t border-[#3c3c3c] mt-2 pt-2">
      <p className="text-[10px] text-[#858585] uppercase tracking-wider mb-2">Agentic Loop</p>
      <div>
        <label className="text-[10px] text-[#858585]">Max Iterations: {maxIterations}</label>
        <input type="range" min="5" max="500" step="5" value={maxIterations}
          onChange={e => setMaxIterations(parseInt(e.target.value))} className="w-full h-1 accent-[#007acc]" />
        <div className="flex justify-between text-[9px] text-[#585858]"><span>5 (quick)</span><span>500 (marathon)</span></div>
        <p className="text-[9px] text-[#585858] mt-1">How many tool cycles the AI runs before stopping. Higher = longer autonomous tasks.</p>
      </div>
    </div>
    <div className="border-t border-[#3c3c3c] mt-2 pt-2">
      <p className="text-[10px] text-[#858585] uppercase tracking-wider mb-2">Hardware</p>
      <div>
        <label className="text-[10px] text-[#858585]">GPU Mode<Applied k="gpu" /></label>
        <div className="flex gap-2 mt-1">
          <button
            className={`flex-1 text-[10px] py-1 rounded ${gpuPreference === 'auto' ? 'bg-[#007acc] text-white' : 'bg-[#3c3c3c] text-[#858585] hover:text-white hover:bg-[#4c4c4c]'}`}
            onClick={() => { setGpuPreference('auto'); (window as any).electronAPI?.gpuSetPreference?.('auto'); confirm('gpu'); }}>GPU (Auto)</button>
          <button
            className={`flex-1 text-[10px] py-1 rounded ${gpuPreference === 'cpu' ? 'bg-[#007acc] text-white' : 'bg-[#3c3c3c] text-[#858585] hover:text-white hover:bg-[#4c4c4c]'}`}
            onClick={() => { setGpuPreference('cpu'); (window as any).electronAPI?.gpuSetPreference?.('cpu'); confirm('gpu'); }}>CPU Only</button>
        </div>
        <p className="text-[9px] text-[#585858] mt-1">Auto-reloads model. "Auto" prefers CUDA/Vulkan GPU.</p>
      </div>
    </div>
  </div>
  );
};
