/**
 * ModelProfile Registry — Dynamic runtime configuration per model family & size.
 *
 * Each model family (qwen, llama, phi, gemma, deepseek, mistral, granite, etc.)
 * has fundamentally different training data, instruction formats, and behavioral
 * characteristics. Treating them identically leads to systematically poor results
 * for some families even when the model itself is capable.
 *
 * This registry provides per-family, per-size-tier overrides for:
 *   - Sampling parameters (temperature, topP, topK, repeatPenalty, etc.)
 *   - Context window sizing (what the model actually handles well vs. advertised max)
 *   - Prompt strategy (concise vs verbose, few-shot vs zero-shot)
 *   - Tool format preference (JSON style hint)
 *   - Think-token handling (strip, budget, or ignore)
 *   - Retry strategy (what to change when the model fails)
 *   - Known quirks and failure modes
 *
 * Sources:
 *   - Official model cards from HuggingFace / model authors
 *   - node-llama-cpp community best practices
 *   - Empirical testing in guIDE gauntlet benchmarks
 *   - Community-reported optimal settings (LocalLLaMA, etc.)
 */

// ── Size tier boundaries (in billions of parameters) ────────
const TIER_BOUNDARIES = {
  tiny:   { min: 0,    max: 1 },
  small:  { min: 1,    max: 4 },
  medium: { min: 4,    max: 8 },
  large:  { min: 8,    max: 14 },
  xlarge: { min: 14,   max: Infinity },
};

// ── Base defaults applied to ALL models ─────────────────────
// These are conservative, safe-for-all defaults.
// Family/size overrides below replace these values.
const BASE_DEFAULTS = {
  sampling: {
    temperature: 0.6,
    topP: 0.90,
    topK: 40,
    repeatPenalty: 1.10,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    lastTokensPenaltyCount: 128,
  },
  context: {
    effectiveContextSize: 32768,      // Aim high — engine auto-shrinks if VRAM insufficient
    sysPromptBudgetPct: 0.15,         // Max 15% of context for system prompt
    responseReservePct: 0.25,         // Reserve 25% of context for response
    maxResponseTokens: 4096,          // Hard cap on response length
  },
  prompt: {
    style: 'full',                    // 'compact' or 'full' — which preamble to use
    toolPromptStyle: 'full',          // 'full', 'compact', or 'grammar-only'
    fewShotExamples: 0,               // Number of few-shot examples to include
    preferJsonCodeFence: true,        // Wrap tool calls in ```json blocks
  },
  thinkTokens: {
    mode: 'strip',                    // 'strip' (remove), 'budget' (limit), 'none' (no think tokens)
    budget: 0,                        // If mode='budget', max think tokens
  },
  retry: {
    maxRetries: 3,                    // Per-tool retry budget
    onLoop: 'increase-penalty',       // 'increase-penalty', 'increase-temperature', 'truncate-context'
    onTruncation: 'reduce-response',  // 'reduce-response', 'summarize-context', 'drop-old'
    onRefusal: 'rephrase-prompt',     // 'rephrase-prompt', 'add-permission', 'switch-model'
  },
  generation: {
    grammarConstrained: false,        // Grammar DISABLED — causes infinite loops and stuck generation
    stopStrings: [],                  // Additional stop strings
    maxToolsPerTurn: 10,              // Max tool calls per generation
  },
  quirks: {
    loopsFrequently: false,           // Model tends to repeat itself
    truncatesMidTool: false,          // Model tends to cut off mid-JSON
    overlyVerbose: false,             // Model tends to narrate excessively
    refusesOften: false,              // Model tends to refuse requests
    halluccinatesToolResults: false,  // Model tends to fabricate tool outputs
    needsExplicitStop: false,         // Model doesn't stop generation cleanly
    emitsSpecialTokens: false,        // Model leaks <|im_end|> etc. in output
    poorMultiTool: false,             // Struggles with multiple tool calls per turn
  },
};

// ══════════════════════════════════════════════════════════════
//  FAMILY PROFILES — Empirically tuned per model family
// ══════════════════════════════════════════════════════════════
//
// Each family has a `base` (applied to all sizes) and optional
// size-tier overrides (tiny, small, medium, large, xlarge).
// Overrides are SHALLOW-MERGED: nested objects are replaced, not deep-merged.
//

const FAMILY_PROFILES = {

  // ── QWEN ────────────────────────────────────────────────────
  // Well-calibrated, strong instruction following.
  // Qwen3 has native <think> support. Rarely loops.
  // Works well with structured prompts. Higher temperature tolerant.
  // Context: Qwen2.5 supports 32K, Qwen3 supports 32K-128K.
  qwen: {
    base: {
      sampling: {
        temperature: 0.5,
        topP: 0.90,
        topK: 30,
        repeatPenalty: 1.08,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      // thinkTokens defaults to mode:'none' — thinking is only enabled at load time
      // when isThinkingVariant detects a thinking-capable model (e.g. qwen3, r1-distill).
      // Applying a budget to non-thinking models (e.g. Qwen2.5) produces garbage output.
      thinkTokens: { mode: 'none' },
      quirks: { emitsSpecialTokens: true }, // Qwen occasionally leaks <|im_end|>
    },
    tiny: {
      // Qwen3-0.6B: surprisingly capable but needs tight sampling
      // Community benchmarks show Qwen3-0.6B ties #1 in tool calling (0.880)
      // 0.6B thinking loops after ~1 pass — tight budget prevents waste
      // Thinking enabled only for actual thinking-variant models via isThinkingVariant override.
      sampling: { temperature: 0.45, topP: 0.85, topK: 20, repeatPenalty: 1.10 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'none' },
      _thinkBudgetWhenActive: 128, // used by isThinkingVariant override in llmEngine.js
      generation: { maxToolsPerTurn: 6 },
      quirks: { truncatesMidTool: true, poorMultiTool: true },
    },
    small: {
      // Qwen3-1.7B, Qwen2.5-1.5B/3B: strong tool callers
      // NOTE: Qwen2.5 does NOT support thinking. Qwen3 does.
      // mode:'none' ensures non-thinking Qwen2.5 models don't get a thought budget.
      // Qwen3 variants are promoted to thinking at load time by isThinkingVariant in llmEngine.js.
      sampling: { temperature: 0.5, topP: 0.88, topK: 25, repeatPenalty: 1.08 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'none' },
      _thinkBudgetWhenActive: 256, // used by isThinkingVariant override in llmEngine.js
      generation: { maxToolsPerTurn: 12 },
    },
    medium: {
      // Qwen2.5-7B, Qwen3-8B: excellent all-round
      sampling: { temperature: 0.55, topP: 0.90, topK: 30, repeatPenalty: 1.05 },
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
      prompt: { style: 'full', toolPromptStyle: 'full' },
      generation: { grammarConstrained: false, maxToolsPerTurn: 15 },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      prompt: { style: 'full', toolPromptStyle: 'full' },
      generation: { grammarConstrained: false, maxToolsPerTurn: 25 },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
      prompt: { style: 'full', toolPromptStyle: 'full' },
      generation: { grammarConstrained: false, maxToolsPerTurn: 50 },
    },
  },

  // ── LLAMA ───────────────────────────────────────────────────
  // Meta's models. Strong instruction following with few-shot examples.
  // Llama-3.2 has 128K context but small models work better at 8K.
  // Responds well to explicit role framing. No native think tokens.
  llama: {
    base: {
      sampling: {
        temperature: 0.5,
        topP: 0.90,
        topK: 40,
        repeatPenalty: 1.10,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    tiny: {
      // Llama-3.2-1B: basic capability, tight sampling needed
      sampling: { temperature: 0.35, topP: 0.80, topK: 15, repeatPenalty: 1.15 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 2 },
      thinkTokens: { mode: 'none' }, // Llama 3.2 is not a thinking model
      generation: { maxToolsPerTurn: 6 },
      quirks: { truncatesMidTool: true, poorMultiTool: true, loopsFrequently: true },
    },
    small: {
      // Llama-3.2-3B: good tool caller with few-shot
      sampling: { temperature: 0.4, topP: 0.85, topK: 20, repeatPenalty: 1.12 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'none' }, // Llama 3.2 is not a thinking model
      generation: { maxToolsPerTurn: 12 },
    },
    medium: {
      // Llama-3.1-8B: solid
      sampling: { temperature: 0.5, topP: 0.90, topK: 30, repeatPenalty: 1.08 },
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
      prompt: { style: 'full', toolPromptStyle: 'full' },
      generation: { grammarConstrained: false, maxToolsPerTurn: 15 },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      generation: { grammarConstrained: false, maxToolsPerTurn: 25 },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
      generation: { grammarConstrained: false, maxToolsPerTurn: 50 },
    },
  },

  // ── PHI ─────────────────────────────────────────────────────
  // Microsoft's efficient models. Very sensitive to prompt length.
  // Tend to loop under low repeat penalty. Benefit from ultra-terse prompts.
  // Phi-4 is excellent but Phi-3-mini needs careful handling.
  // No native think tokens. Training favors concise instructions.
  phi: {
    base: {
      sampling: {
        temperature: 0.35,
        topP: 0.80,
        topK: 20,
        repeatPenalty: 1.20,
        frequencyPenalty: 0.05,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 256,   // Phi needs longer lookback to avoid loops
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
      quirks: { loopsFrequently: true, overlyVerbose: true },
    },
    tiny: {
      // No known Phi tiny models, but future-proof
      sampling: { temperature: 0.30, topP: 0.75, topK: 15, repeatPenalty: 1.25 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
      thinkTokens: { mode: 'budget', budget: 128 },
      generation: { maxToolsPerTurn: 6 },
      quirks: { loopsFrequently: true, truncatesMidTool: true, poorMultiTool: true },
    },
    small: {
      // Phi-3-mini (3.8B), Phi-4-mini (3.8B)
      sampling: { temperature: 0.35, topP: 0.80, topK: 20, repeatPenalty: 1.20 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
      thinkTokens: { mode: 'budget', budget: 256 },
      generation: { maxToolsPerTurn: 12 },
      quirks: { loopsFrequently: true, overlyVerbose: true },
    },
    medium: {
      // Phi-3-medium (7B)
      sampling: { temperature: 0.40, topP: 0.85, topK: 25, repeatPenalty: 1.15 },
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
      prompt: { style: 'full', toolPromptStyle: 'full' },
      generation: { maxToolsPerTurn: 12 },
    },
    large: {
      // Phi-4 (14B)
      sampling: { temperature: 0.45, topP: 0.88, topK: 30, repeatPenalty: 1.12 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      generation: { grammarConstrained: false, maxToolsPerTurn: 20 },
      quirks: { loopsFrequently: false }, // Phi-4 14B is well-calibrated
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
      generation: { grammarConstrained: false },
    },
  },

  // ── GEMMA ───────────────────────────────────────────────────
  // Google's models. Strong at tasks with explicit framing.
  // Gemma 2 (2B, 9B, 27B) — instruction-tuned variants are good.
  // Moderate temperature sweet spot. No native think tokens.
  gemma: {
    base: {
      sampling: {
        temperature: 0.45,
        topP: 0.88,
        topK: 30,
        repeatPenalty: 1.12,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    tiny: {
      sampling: { temperature: 0.35, topP: 0.80, topK: 15, repeatPenalty: 1.18 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'budget', budget: 128 },
      generation: { maxToolsPerTurn: 6 },
      quirks: { truncatesMidTool: true, poorMultiTool: true },
    },
    small: {
      // Gemma-2-2B
      sampling: { temperature: 0.40, topP: 0.85, topK: 20, repeatPenalty: 1.15 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'budget', budget: 256 },
      generation: { maxToolsPerTurn: 12 },
    },
    medium: {
      // Gemma-2-9B
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
      prompt: { style: 'full', toolPromptStyle: 'full' },
    },
    large: {
      // Gemma-2-27B
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      generation: { grammarConstrained: false },
    },
  },

  // ── DEEPSEEK ────────────────────────────────────────────────
  // DeepSeek models with chain-of-thought reasoning.
  // R1-distilled variants have <think> tokens requiring budget.
  // Need more room for reasoning tokens. Higher temp for exploration.
  deepseek: {
    base: {
      sampling: {
        temperature: 0.5,
        topP: 0.90,
        topK: 30,
        repeatPenalty: 1.08,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 4096 },  // DeepSeek thinks a LOT
    },
    tiny: {
      // DeepSeek-R1-Distill-Qwen-1.5B
      // R1-1.5B thinks excessively — tight budget prevents looping
      sampling: { temperature: 0.45, topP: 0.85, topK: 20, repeatPenalty: 1.12 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
      thinkTokens: { mode: 'budget', budget: 128 },
      generation: { maxToolsPerTurn: 6 },
      quirks: { overlyVerbose: true, truncatesMidTool: true },
    },
    small: {
      sampling: { temperature: 0.5, topP: 0.88, topK: 25, repeatPenalty: 1.08 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
      thinkTokens: { mode: 'budget', budget: 256 },
      generation: { maxToolsPerTurn: 12 },
    },
    medium: {
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
      thinkTokens: { mode: 'budget', budget: 2048 },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      generation: { grammarConstrained: false },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
      generation: { grammarConstrained: false },
    },
  },

  // ── MISTRAL / MIXTRAL ───────────────────────────────────────
  // French lab models. Good instruction following. Standard settings work well.
  // Mixtral is MoE — large but fast. Works well with standard prompts.
  mistral: {
    base: {
      sampling: {
        temperature: 0.5,
        topP: 0.90,
        topK: 40,
        repeatPenalty: 1.10,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      // No common tiny/small Mistral, but Mistral-7B is medium
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
    },
    medium: {
      // Mistral-7B
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
    },
    large: {
      // Mixtral-8x7B (appears as ~12B active)
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      generation: { grammarConstrained: false },
    },
    xlarge: {
      // Mixtral-8x22B, Mistral-Large
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
      generation: { grammarConstrained: false },
    },
  },

  // ── GRANITE ─────────────────────────────────────────────────
  // IBM's enterprise models. Conservative, tend to be cautious.
  // May refuse more often than other families.
  granite: {
    base: {
      sampling: {
        temperature: 0.5,
        topP: 0.88,
        topK: 30,
        repeatPenalty: 1.10,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
      quirks: { refusesOften: true },
      retry: { onRefusal: 'add-permission' },
    },
    small: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
    },
    medium: {
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
    },
  },

  // ── CODELLAMA / STARCODER ───────────────────────────────────
  // Code-specialized. Not great at general instruction following.
  // Best with code-focused tasks. Low conversational ability.
  codellama: {
    base: {
      sampling: {
        temperature: 0.35,
        topP: 0.85,
        topK: 25,
        repeatPenalty: 1.12,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
      quirks: { poorMultiTool: true },
    },
    small: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
    },
    medium: {
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
    },
  },

  starcoder: {
    base: {
      sampling: {
        temperature: 0.35,
        topP: 0.85,
        topK: 25,
        repeatPenalty: 1.12,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
      quirks: { poorMultiTool: true },
    },
    small: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
    },
  },

  // ── YI ──────────────────────────────────────────────────────
  // 01.AI models. Reasonable instruction following. Chinese/English bilingual.
  yi: {
    base: {
      sampling: {
        temperature: 0.45,
        topP: 0.88,
        topK: 30,
        repeatPenalty: 1.10,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
    },
    medium: {
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
    },
  },

  // ── INTERNLM ───────────────────────────────────────────────
  // Shanghai AI Lab. Good tool-use capability in larger sizes.
  internlm: {
    base: {
      sampling: {
        temperature: 0.5,
        topP: 0.90,
        topK: 30,
        repeatPenalty: 1.08,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
    },
  },

  // ── LFM (Liquid Foundation Models) ──────────────────────────
  // Liquid AI's state-space hybrid architecture. Very fast inference.
  // LFM2.5-1.2B tied #1 in community tool-calling benchmarks (0.880).
  // Uses bracket notation for tool calls: [tool_name(param="value")]
  // Fastest latency in top tier (~1.5s on CPU).
  lfm: {
    base: {
      sampling: {
        temperature: 0.45,
        topP: 0.88,
        topK: 25,
        repeatPenalty: 1.10,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    tiny: {
      // LFM2.5-1.2B — tied #1 tool calling on CPU
      sampling: { temperature: 0.40, topP: 0.85, topK: 20, repeatPenalty: 1.12 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 6 },
    },
    small: {
      // LFM2-2.6B
      sampling: { temperature: 0.45, topP: 0.88, topK: 25, repeatPenalty: 1.10 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 12 },
    },
  },

  // ── NANBEIGE ────────────────────────────────────────────────
  // Chinese/English bilingual models. Nanbeige4.1-3B is highly praised
  // in community for multi-step tool calling at 35K context.
  nanbeige: {
    base: {
      sampling: {
        temperature: 0.50,
        topP: 0.90,
        topK: 30,
        repeatPenalty: 1.08,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      // Nanbeige4.1-3B — praised for multi-step tool calling
      sampling: { temperature: 0.48, topP: 0.88, topK: 25, repeatPenalty: 1.10 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 12 },
    },
  },

  // ── BITNET ──────────────────────────────────────────────────
  // Microsoft 1-bit models. Extremely fast on CPU.
  // BitNet-2B-4T produces perfect JSON tool calls at 2.3s on CPU.
  // Very low VRAM requirements due to 1-bit weights.
  bitnet: {
    base: {
      sampling: {
        temperature: 0.40,
        topP: 0.85,
        topK: 20,
        repeatPenalty: 1.15,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      // BitNet-2B-4T: instruction-tuned, good JSON tool calls
      sampling: { temperature: 0.38, topP: 0.82, topK: 18, repeatPenalty: 1.15 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 12 },
    },
  },

  // ── EXAONE ──────────────────────────────────────────────────
  // LG AI Research. EXAONE 4.0 1.2B is a recent small-model contender.
  // Bilingual Korean/English with strong instruction following.
  exaone: {
    base: {
      sampling: {
        temperature: 0.45,
        topP: 0.88,
        topK: 25,
        repeatPenalty: 1.10,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    tiny: {
      // EXAONE 4.0 1.2B
      sampling: { temperature: 0.40, topP: 0.85, topK: 20, repeatPenalty: 1.12 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 6 },
    },
  },

  // ── DEVSTRAL ────────────────────────────────────────────────
  // Mistral's code-focused models. Strong tool use and coding.
  devstral: {
    base: {
      sampling: {
        temperature: 0.45,
        topP: 0.88,
        topK: 30,
        repeatPenalty: 1.10,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
      generation: { maxToolsPerTurn: 8 },
    },
    large: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 8192 },
      prompt: { style: 'full', toolPromptStyle: 'full' },
      generation: { grammarConstrained: false, maxToolsPerTurn: 25 },
    },
    xlarge: {
      context: { effectiveContextSize: 131072, maxResponseTokens: 16384 },
      generation: { grammarConstrained: false, maxToolsPerTurn: 50 },
    },
  },

  // ── OLMO ────────────────────────────────────────────────────
  // AI2's open models. OLMo 3 has thinking variants.
  olmo: {
    base: {
      sampling: {
        temperature: 0.50,
        topP: 0.90,
        topK: 30,
        repeatPenalty: 1.08,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        lastTokensPenaltyCount: 128,
      },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact', toolPromptStyle: 'compact' },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      generation: { grammarConstrained: false },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
      generation: { grammarConstrained: false },
    },
  },
};

// ══════════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════════

/**
 * Get the size tier string for a given parameter count.
 * @param {number} paramSize - Model parameter count in billions (0 = unknown)
 * @returns {string} 'tiny' | 'small' | 'medium' | 'large' | 'xlarge'
 */
function getSizeTier(paramSize) {
  // Unknown param size (0) defaults to 'medium' — safe middle-ground.
  // This prevents unrecognized models from being crippled with tiny-tier config
  // (2048 context, grammar-only tools) when they could be any size.
  if (!paramSize || paramSize <= 0) return 'medium';
  if (paramSize <= TIER_BOUNDARIES.tiny.max) return 'tiny';
  if (paramSize <= TIER_BOUNDARIES.small.max) return 'small';
  if (paramSize <= TIER_BOUNDARIES.medium.max) return 'medium';
  if (paramSize <= TIER_BOUNDARIES.large.max) return 'large';
  return 'xlarge';
}

/**
 * Deep merge source into target. Source values override target values.
 * Handles nested objects without destroying sibling keys.
 * @param {Object} target
 * @param {Object} source
 * @returns {Object} merged result (new object, inputs not mutated)
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Resolve the complete ModelProfile for a given model family and parameter size.
 *
 * Merge order (later wins):
 *   1. BASE_DEFAULTS
 *   2. family.base (if family exists)
 *   3. family[tier] (if size tier exists for family)
 *
 * @param {string} family - Model family identifier (e.g., 'qwen', 'llama', 'phi')
 * @param {number} paramSize - Model parameter count in billions
 * @returns {Object} Complete profile with all fields populated
 */
function getModelProfile(family, paramSize) {
  const tier = getSizeTier(paramSize);
  const familyProfile = FAMILY_PROFILES[family];

  // Start with base defaults
  let profile = JSON.parse(JSON.stringify(BASE_DEFAULTS));

  // Merge family base if available
  if (familyProfile?.base) {
    profile = deepMerge(profile, familyProfile.base);
  }

  // Merge size-tier override if available
  if (familyProfile?.[tier]) {
    profile = deepMerge(profile, familyProfile[tier]);
  }

  // Attach metadata
  profile._meta = {
    family,
    paramSize,
    tier,
    profileSource: familyProfile ? `${family}/${tier}` : `unknown/${tier}`,
  };

  return profile;
}

/**
 * Get just the sampling parameters for a model, ready to pass to generation.
 * @param {string} family
 * @param {number} paramSize
 * @returns {Object} { temperature, topP, topK, repeatPenalty, ... }
 */
function getModelSamplingParams(family, paramSize) {
  const profile = getModelProfile(family, paramSize);
  return profile.sampling;
}

/**
 * Get the effective context size for a model.
 * This is the USABLE context — not the advertised max.
 * @param {string} family
 * @param {number} paramSize
 * @returns {number}
 */
function getEffectiveContextSize(family, paramSize) {
  const profile = getModelProfile(family, paramSize);
  return profile.context.effectiveContextSize;
}

/**
 * List all available family names.
 * @returns {string[]}
 */
function getAvailableFamilies() {
  return Object.keys(FAMILY_PROFILES);
}

/**
 * Check if a model family is known (has a dedicated profile).
 * @param {string} family
 * @returns {boolean}
 */
function isFamilyKnown(family) {
  return family in FAMILY_PROFILES;
}

module.exports = {
  getModelProfile,
  getModelSamplingParams,
  getEffectiveContextSize,
  getSizeTier,
  getAvailableFamilies,
  isFamilyKnown,
  deepMerge,
  // Exported for testing/inspection
  BASE_DEFAULTS,
  FAMILY_PROFILES,
  TIER_BOUNDARIES,
};
