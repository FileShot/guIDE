'use strict';

// ─── Tier Boundaries ───
const TIER_BOUNDARIES = {
  tiny:   { min: 0,  max: 1 },
  small:  { min: 1,  max: 4 },
  medium: { min: 4,  max: 8 },
  large:  { min: 8,  max: 14 },
  xlarge: { min: 14, max: Infinity },
};

function getSizeTier(paramSize) {
  if (!paramSize || paramSize <= 0) return 'medium';
  for (const [tier, { min, max }] of Object.entries(TIER_BOUNDARIES)) {
    if (paramSize >= min && paramSize < max) return tier;
  }
  return 'xlarge';
}

// ─── Base Defaults (applied to ALL models before family overrides) ───
const BASE_DEFAULTS = {
  sampling: {
    temperature: 0.6,
    topP: 0.90,
    topK: 40,
    repeatPenalty: 1.10,
    frequencyPenalty: 0,
    presencePenalty: 0,
    lastTokensPenaltyCount: 128,
  },
  context: {
    effectiveContextSize: 32768,
    sysPromptBudgetPct: 0.15,
    responseReservePct: 0.25,
    maxResponseTokens: 4096,
  },
  prompt: {
    style: 'full',
    toolPromptStyle: 'full',
    fewShotExamples: 0,
    preferJsonCodeFence: true,
  },
  thinkTokens: {
    mode: 'strip',
    budget: 0,
  },
  retry: {
    maxRetries: 3,
    onLoop: 'increase-penalty',
    onTruncation: 'reduce-response',
    onRefusal: 'rephrase-prompt',
  },
  generation: {
    grammarConstrained: false,
    stopStrings: [],
    maxToolsPerTurn: 14,
  },
  quirks: {
    loopsFrequently: false,
    truncatesMidTool: false,
    overlyVerbose: false,
    refusesOften: false,
    halluccinatesToolResults: false,
    needsExplicitStop: false,
    emitsSpecialTokens: false,
    poorMultiTool: false,
  },
};

// ─── Family Profiles ───
const FAMILY_PROFILES = {
  qwen: {
    base: {
      sampling: { temperature: 0.5, topP: 0.90, topK: 30, repeatPenalty: 1.08 },
      thinkTokens: { mode: 'none', budget: 0 },
      quirks: { emitsSpecialTokens: true },
    },
    tiny: {
      sampling: { temperature: 0.45, topP: 0.85, topK: 20, repeatPenalty: 1.10, lastTokensPenaltyCount: 512 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'none', budget: 0, _thinkBudgetWhenActive: 128 },
      generation: { maxToolsPerTurn: 10 },
      quirks: { truncatesMidTool: true, poorMultiTool: true },
    },
    small: {
      sampling: { temperature: 0.35, topP: 0.88, topK: 25, repeatPenalty: 1.12, lastTokensPenaltyCount: 512 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'none', budget: 0, _thinkBudgetWhenActive: 256 },
      generation: { maxToolsPerTurn: 14 },
      quirks: { poorMultiTool: true },
    },
    medium: {
      sampling: { temperature: 0.55, topP: 0.90, topK: 30, repeatPenalty: 1.05 },
      context: { effectiveContextSize: 16384 },
      prompt: { style: 'full' },
      generation: { maxToolsPerTurn: 15 },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      prompt: { style: 'full' },
      generation: { maxToolsPerTurn: 25 },
      thinkTokens: { _thinkBudgetWhenActive: 2048 },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
      prompt: { style: 'full' },
      generation: { maxToolsPerTurn: 50 },
      thinkTokens: { _thinkBudgetWhenActive: 4096 },
    },
  },

  llama: {
    base: {
      sampling: { temperature: 0.5, topP: 0.90, topK: 40, repeatPenalty: 1.10 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    tiny: {
      sampling: { temperature: 0.35, topP: 0.80, topK: 15, repeatPenalty: 1.15, lastTokensPenaltyCount: 512 },
      prompt: { style: 'compact', fewShotExamples: 2 },
      thinkTokens: { mode: 'none', budget: 0 },
      generation: { maxToolsPerTurn: 10 },
      quirks: { truncatesMidTool: true, poorMultiTool: true, loopsFrequently: true },
    },
    small: {
      sampling: { temperature: 0.4, topP: 0.85, topK: 20, repeatPenalty: 1.12 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'none', budget: 0 },
      generation: { maxToolsPerTurn: 14 },
    },
    medium: {
      sampling: { temperature: 0.5, topP: 0.90, topK: 30, repeatPenalty: 1.08 },
      context: { effectiveContextSize: 16384 },
      prompt: { style: 'full' },
      generation: { maxToolsPerTurn: 15 },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      generation: { maxToolsPerTurn: 25 },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
      generation: { maxToolsPerTurn: 50 },
    },
  },

  phi: {
    base: {
      sampling: { temperature: 0.35, topP: 0.80, topK: 20, repeatPenalty: 1.20, frequencyPenalty: 0.05, lastTokensPenaltyCount: 256 },
      thinkTokens: { mode: 'budget', budget: 1024 },
      quirks: { loopsFrequently: true, overlyVerbose: true },
    },
    tiny: {
      sampling: { temperature: 0.30, topP: 0.75, topK: 15, repeatPenalty: 1.25, lastTokensPenaltyCount: 512 },
      prompt: { style: 'compact' },
      thinkTokens: { mode: 'budget', budget: 128 },
      generation: { maxToolsPerTurn: 10 },
      quirks: { loopsFrequently: true, truncatesMidTool: true, poorMultiTool: true },
    },
    small: {
      sampling: { temperature: 0.35, topP: 0.80, topK: 20, repeatPenalty: 1.20 },
      prompt: { style: 'compact' },
      thinkTokens: { mode: 'budget', budget: 256 },
      generation: { maxToolsPerTurn: 14 },
      quirks: { loopsFrequently: true, overlyVerbose: true },
    },
    medium: {
      sampling: { temperature: 0.40, topP: 0.85, topK: 25, repeatPenalty: 1.15 },
      context: { effectiveContextSize: 16384 },
      prompt: { style: 'full' },
      generation: { maxToolsPerTurn: 14 },
    },
    large: {
      sampling: { temperature: 0.45, topP: 0.88, topK: 30, repeatPenalty: 1.12 },
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
      prompt: { style: 'full' },
      generation: { maxToolsPerTurn: 20 },
      quirks: { loopsFrequently: false },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
    },
  },

  gemma: {
    base: {
      sampling: { temperature: 0.45, topP: 0.88, topK: 30, repeatPenalty: 1.12 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    tiny: {
      sampling: { temperature: 0.35, topP: 0.80, topK: 15, repeatPenalty: 1.18, lastTokensPenaltyCount: 512 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'budget', budget: 128 },
      generation: { maxToolsPerTurn: 10 },
      quirks: { truncatesMidTool: true, poorMultiTool: true },
    },
    small: {
      sampling: { temperature: 0.40, topP: 0.85, topK: 20, repeatPenalty: 1.15 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      thinkTokens: { mode: 'budget', budget: 256 },
      generation: { maxToolsPerTurn: 14 },
    },
    medium: {
      context: { effectiveContextSize: 16384 },
      prompt: { style: 'full' },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
    },
  },

  deepseek: {
    base: {
      sampling: { temperature: 0.5, topP: 0.90, topK: 30, repeatPenalty: 1.08 },
      thinkTokens: { mode: 'budget', budget: 4096 },
    },
    tiny: {
      sampling: { temperature: 0.45, topP: 0.85, topK: 20, repeatPenalty: 1.12, lastTokensPenaltyCount: 512 },
      prompt: { style: 'compact' },
      thinkTokens: { mode: 'budget', budget: 128 },
      generation: { maxToolsPerTurn: 10 },
      quirks: { overlyVerbose: true, truncatesMidTool: true },
    },
    small: {
      sampling: { temperature: 0.5, topP: 0.88, topK: 25, repeatPenalty: 1.08 },
      prompt: { style: 'compact' },
      thinkTokens: { mode: 'budget', budget: 256 },
      generation: { maxToolsPerTurn: 14 },
    },
    medium: {
      context: { effectiveContextSize: 16384 },
      thinkTokens: { mode: 'budget', budget: 2048 },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
    },
  },

  mistral: {
    base: {
      sampling: { temperature: 0.5, topP: 0.90, topK: 40, repeatPenalty: 1.10 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 4096 },
      prompt: { style: 'compact' },
    },
    medium: {
      context: { effectiveContextSize: 16384, maxResponseTokens: 4096 },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
    },
  },

  granite: {
    base: {
      sampling: { temperature: 0.5, topP: 0.88, topK: 30, repeatPenalty: 1.10 },
      thinkTokens: { mode: 'budget', budget: 1024 },
      quirks: { refusesOften: true },
      retry: { onRefusal: 'add-permission' },
    },
    small: {
      context: { effectiveContextSize: 32768 },
      prompt: { style: 'compact' },
    },
    medium: {
      context: { effectiveContextSize: 16384 },
    },
  },

  codellama: {
    base: {
      sampling: { temperature: 0.35, topP: 0.85, topK: 25, repeatPenalty: 1.12 },
      thinkTokens: { mode: 'budget', budget: 1024 },
      quirks: { poorMultiTool: true },
    },
    small: {
      context: { effectiveContextSize: 32768 },
      prompt: { style: 'compact' },
    },
    medium: {
      context: { effectiveContextSize: 16384 },
    },
  },

  starcoder: {
    base: {
      sampling: { temperature: 0.35, topP: 0.85, topK: 25, repeatPenalty: 1.12 },
      thinkTokens: { mode: 'budget', budget: 1024 },
      quirks: { poorMultiTool: true },
    },
    small: {
      context: { effectiveContextSize: 32768 },
      prompt: { style: 'compact' },
    },
  },

  yi: {
    base: {
      sampling: { temperature: 0.45, topP: 0.88, topK: 30, repeatPenalty: 1.10 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      context: { effectiveContextSize: 32768 },
      prompt: { style: 'compact' },
    },
    medium: {
      context: { effectiveContextSize: 16384 },
    },
  },

  internlm: {
    base: {
      sampling: { temperature: 0.5, topP: 0.90, topK: 30, repeatPenalty: 1.08 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      context: { effectiveContextSize: 32768 },
      prompt: { style: 'compact' },
    },
  },

  lfm: {
    base: {
      sampling: { temperature: 0.45, topP: 0.88, topK: 25, repeatPenalty: 1.10 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    tiny: {
      sampling: { temperature: 0.40, topP: 0.85, topK: 20, repeatPenalty: 1.12, lastTokensPenaltyCount: 512 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 10 },
    },
    small: {
      sampling: { temperature: 0.45, topP: 0.88, topK: 25, repeatPenalty: 1.10 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 14 },
    },
  },

  nanbeige: {
    base: {
      sampling: { temperature: 0.50, topP: 0.90, topK: 30, repeatPenalty: 1.08 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      sampling: { temperature: 0.48, topP: 0.88, topK: 25, repeatPenalty: 1.10 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 14 },
    },
  },

  bitnet: {
    base: {
      sampling: { temperature: 0.40, topP: 0.85, topK: 20, repeatPenalty: 1.15 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      sampling: { temperature: 0.38, topP: 0.82, topK: 18, repeatPenalty: 1.15 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 14 },
    },
  },

  exaone: {
    base: {
      sampling: { temperature: 0.45, topP: 0.88, topK: 25, repeatPenalty: 1.10 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    tiny: {
      sampling: { temperature: 0.40, topP: 0.85, topK: 20, repeatPenalty: 1.12, lastTokensPenaltyCount: 512 },
      prompt: { style: 'compact', fewShotExamples: 1 },
      generation: { maxToolsPerTurn: 10 },
    },
  },

  devstral: {
    base: {
      sampling: { temperature: 0.45, topP: 0.88, topK: 30, repeatPenalty: 1.10 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      context: { effectiveContextSize: 32768 },
      prompt: { style: 'compact' },
      generation: { maxToolsPerTurn: 10 },
    },
    large: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 8192 },
      prompt: { style: 'full' },
      generation: { maxToolsPerTurn: 25 },
    },
    xlarge: {
      context: { effectiveContextSize: 131072, maxResponseTokens: 16384 },
      generation: { maxToolsPerTurn: 50 },
    },
  },

  olmo: {
    base: {
      sampling: { temperature: 0.50, topP: 0.90, topK: 30, repeatPenalty: 1.08 },
      thinkTokens: { mode: 'budget', budget: 1024 },
    },
    small: {
      context: { effectiveContextSize: 32768 },
      prompt: { style: 'compact' },
    },
    large: {
      context: { effectiveContextSize: 32768, maxResponseTokens: 8192 },
    },
    xlarge: {
      context: { effectiveContextSize: 65536, maxResponseTokens: 16384 },
    },
  },
};

// ─── Deep Merge (non-mutating, arrays replaced not concatenated) ───
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ─── Profile Resolution ───
function getModelProfile(family, paramSize) {
  const tier = getSizeTier(paramSize);
  const familyDef = FAMILY_PROFILES[family] || FAMILY_PROFILES.llama;

  // Merge order: BASE_DEFAULTS → family.base → family[tier]
  let profile = deepMerge(BASE_DEFAULTS, familyDef.base || {});
  if (familyDef[tier]) {
    profile = deepMerge(profile, familyDef[tier]);
  }

  profile._meta = {
    family: family || 'unknown',
    paramSize: paramSize || 0,
    tier,
    profileSource: FAMILY_PROFILES[family] ? family : 'llama (fallback)',
  };

  return profile;
}

function getModelSamplingParams(family, paramSize) {
  return getModelProfile(family, paramSize).sampling;
}

function getEffectiveContextSize(family, paramSize) {
  return getModelProfile(family, paramSize).context.effectiveContextSize;
}

function getAvailableFamilies() {
  return Object.keys(FAMILY_PROFILES);
}

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
  BASE_DEFAULTS,
  FAMILY_PROFILES,
  TIER_BOUNDARIES,
};
