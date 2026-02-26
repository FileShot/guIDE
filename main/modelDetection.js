/**
 * Model Detection — Shared utility for detecting model family and parameter size.
 *
 * Single source of truth used by llmEngine.js, gauntlet-v3.js, and any other
 * scripts that need to identify model characteristics from filenames.
 *
 * Previously duplicated across llmEngine._getModelFamily(), llmEngine._getModelParamSize(),
 * gauntlet-v3.js detectFamily(), gauntlet-v3.js detectParamSize().
 */

const path = require('path');

/**
 * Detect model family from filename.
 * Returns a string identifier used for family-specific prompt/sampling tweaks.
 * @param {string} modelPath - Path to the model file
 * @returns {string} Family identifier (e.g., 'qwen', 'llama', 'phi', 'unknown')
 */
function detectFamily(modelPath) {
  if (!modelPath) return 'unknown';
  const name = path.basename(modelPath).toLowerCase();
  // Order matters: more specific patterns first to avoid false matches
  // (e.g. 'devstral' before 'mistral', 'codellama' before 'llama')
  // IMPORTANT: 'deepseek' must come before 'qwen' — DeepSeek-R1-Distill-Qwen models
  // contain both words; we want the deepseek profile, not the qwen profile.
  if (name.includes('devstral')) return 'devstral';
  if (name.includes('deepseek') || name.includes('r1-distill')) return 'deepseek';
  if (name.includes('qwen')) return 'qwen';
  if (name.includes('codellama') || name.includes('code-llama')) return 'codellama';
  if (name.includes('llama')) return 'llama';
  if (name.includes('phi')) return 'phi';
  if (name.includes('gemma')) return 'gemma';
  if (name.includes('mistral') || name.includes('mixtral')) return 'mistral';
  if (name.includes('granite')) return 'granite';
  if (name.includes('internlm')) return 'internlm';
  if (name.includes('yi')) return 'yi';
  if (name.includes('starcoder')) return 'starcoder';
  if (name.includes('lfm')) return 'lfm';
  if (name.includes('nanbeige')) return 'nanbeige';
  if (name.includes('bitnet')) return 'bitnet';
  if (name.includes('exaone')) return 'exaone';
  if (name.includes('olmo')) return 'olmo';
  return 'unknown';
}

/**
 * Estimate model parameter count from filename.
 * @param {string} modelPath - Path to the model file
 * @returns {number} Parameter count in billions (0 = unknown)
 */
function detectParamSize(modelPath) {
  if (!modelPath) return 0;
  const name = path.basename(modelPath).toLowerCase();
  // Standard format: "3B", "1.7B", "135M" — number immediately followed by B or M
  const match = name.match(/(\d+\.?\d*)[bm]/i);
  if (match) {
    const num = parseFloat(match[1]);
    const unit = match[0].slice(-1).toLowerCase();
    return unit === 'b' ? num : num / 1000;
  }
  // Fallback: known model names where param count isn't in standard format
  if (/phi.?4.?mini/i.test(name)) return 3.8;
  if (/phi.?4(?![\d])/i.test(name)) return 14;
  if (/phi.?3\.?5.?mini/i.test(name)) return 3.8;
  if (/phi.?3.?mini/i.test(name)) return 3.8;
  return 0;
}

/**
 * Detect whether a model file is a diffusion (image generation) model
 * vs a standard language model.
 *
 * Diffusion models (Stable Diffusion, SDXL, FLUX, ControlNet, VAE) use completely
 * different architecture from LLMs and must route to localImageEngine, not llmEngine.
 *
 * @param {string} modelPath - Path to the model file
 * @returns {'diffusion' | 'llm'}
 */
function detectModelType(modelPath) {
  if (!modelPath) return 'llm';
  const name = path.basename(modelPath).toLowerCase();
  if (
    /stable[_-]?diffusion/i.test(name) ||
    /\bsd[_-]?v?[123][_-]/i.test(name) ||
    /\bsdxl\b/i.test(name) ||
    /\bflux[_\-. ](dev|schnell|pro|1|lite)/i.test(name) ||
    /\bflux1\b/i.test(name) ||
    /controlnet/i.test(name) ||
    /\bt2i[_-]adapter/i.test(name) ||
    /[_-]vae[_-]/i.test(name)
  ) {
    return 'diffusion';
  }
  return 'llm';
}

module.exports = { detectFamily, detectParamSize, detectModelType };
