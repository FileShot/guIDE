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
  if (name.includes('devstral')) return 'devstral';
  if (name.includes('qwen')) return 'qwen';
  if (name.includes('codellama') || name.includes('code-llama')) return 'codellama';
  if (name.includes('llama')) return 'llama';
  if (name.includes('phi')) return 'phi';
  if (name.includes('gemma')) return 'gemma';
  if (name.includes('mistral') || name.includes('mixtral')) return 'mistral';
  if (name.includes('deepseek')) return 'deepseek';
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

module.exports = { detectFamily, detectParamSize };
