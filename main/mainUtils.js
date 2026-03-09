/**
 * guIDE — Main Process Utilities
 * 
 * Shared helpers: tool result truncation, GPU detection, CPU usage.
 */
'use strict';

const os = require('os');

/**
 * Strip non-BMP Unicode (emoji, symbols) that crash node-llama-cpp tokenizer.
 */
function sanitizeForTokenizer(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * Truncate tool result fields to prevent context overflow.
 * Pre-truncates before JSON.stringify to keep prompt size manageable.
 */
function _truncateResult(result, maxFieldLen = 3000) {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };

  const textFields = ['content', 'output', 'snapshot', 'stdout', 'stderr', 'html', 'text', 'data', 'snippet', 'title', 'error'];
  for (const key of textFields) {
    if (typeof out[key] === 'string') {
      out[key] = sanitizeForTokenizer(out[key]);
      if (out[key].length > maxFieldLen) {
        out[key] = out[key].substring(0, maxFieldLen) + '... (truncated)';
      }
    }
  }

  if (Array.isArray(out.results)) {
    if (out.results.length > 10) out.results = out.results.slice(0, 10);
    out.results = out.results.map(r => {
      if (!r || typeof r !== 'object') return r;
      const clean = { ...r };
      for (const k of ['title', 'snippet', 'url', 'content', 'text']) {
        if (typeof clean[k] === 'string') clean[k] = sanitizeForTokenizer(clean[k]);
      }
      return clean;
    });
  }

  if (Array.isArray(out.files) && out.files.length > 30) {
    out.files = out.files.slice(0, 30);
    out.files.push('... (truncated)');
  }

  return out;
}

// ── GPU Detection (cached — hardware doesn't change mid-session) ──
let gpuCache = null;
let gpuCacheTime = 0;

async function _detectGPU() {
  if (gpuCache && (Date.now() - gpuCacheTime) < 3600000) return gpuCache;

  const { execFile } = require('child_process');
  const execAsync = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 3000, encoding: 'utf8', windowsHide: true, ...opts },
      (err, stdout) => err ? reject(err) : resolve(stdout));
  });

  let vramGB = 0, gpuName = 'No GPU detected';
  try {
    const out = await execAsync('nvidia-smi', ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits']);
    const parts = out.trim().split(', ');
    vramGB = parseFloat(parts[0]) / 1024;
    gpuName = parts[1] || 'NVIDIA GPU';
  } catch (_) {
    try {
      const out = await execAsync('wmic', ['path', 'win32_videocontroller', 'get', 'name,adapterram', '/format:csv']);
      const lines = out.trim().split('\n').filter(l => l.trim());
      if (lines.length > 1) {
        const cols = lines[lines.length - 1].split(',');
        vramGB = parseInt(cols[cols.length - 1]) / (1024 ** 3) || 0;
        gpuName = cols[cols.length - 2] || 'GPU';
      }
    } catch (_) {}
  }

  gpuCache = { vramGB: Math.round(vramGB * 10) / 10, gpuName };
  gpuCacheTime = Date.now();
  return gpuCache;
}

// ── CPU Usage ──
let prevCpu = null;

function getCpuUsage() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  }
  if (prevCpu) {
    const idleDiff = idle - prevCpu.idle;
    const totalDiff = total - prevCpu.total;
    prevCpu = { idle, total };
    return totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
  }
  prevCpu = { idle, total };
  return 0;
}

module.exports = { _truncateResult, _detectGPU, getCpuUsage };
