/**
 * Shared utility functions for the main process.
 */
const os = require('os');

// ─── Tool result truncation (pre-truncate before JSON.stringify) ─────
// Strip non-BMP Unicode (emoji, symbols) that crash node-llama-cpp tokenizer regex.
// Keeps ASCII + common Latin/CJK/Cyrillic — strips emoji, dingbats, musical symbols, etc.
function _sanitizeForTokenizer(str) {
  if (typeof str !== 'string') return str;
  // Remove surrogate pairs (emoji, symbols above U+FFFF) and control chars except \n\r\t
  return str.replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function _truncateResult(result, maxFieldLen = 3000) {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };
  for (const key of ['content', 'output', 'snapshot', 'stdout', 'stderr', 'html', 'text', 'data', 'snippet', 'title', 'error']) {
    if (typeof out[key] === 'string') {
      out[key] = _sanitizeForTokenizer(out[key]);
      if (out[key].length > maxFieldLen) {
        out[key] = out[key].substring(0, maxFieldLen) + '... (truncated)';
      }
    }
  }
  if (Array.isArray(out.results)) {
    if (out.results.length > 10) out.results = out.results.slice(0, 10);
    // Sanitize nested result objects (e.g., web search results with emoji in snippets)
    out.results = out.results.map(r => {
      if (!r || typeof r !== 'object') return r;
      const clean = { ...r };
      for (const k of ['title', 'snippet', 'url', 'content', 'text']) {
        if (typeof clean[k] === 'string') clean[k] = _sanitizeForTokenizer(clean[k]);
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

// ─── GPU Detection Cache (runs once, hardware doesn't change mid-session) ────
let _gpuCacheResult = null;
let _gpuCacheTime = 0;

async function _detectGPU() {
  if (_gpuCacheResult && (Date.now() - _gpuCacheTime) < 3600000) return _gpuCacheResult;
  const { execFile } = require('child_process');
  const execAsync = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 3000, encoding: 'utf8', windowsHide: true, ...opts }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
  let vramGB = 0, gpuName = 'No GPU detected';
  try {
    const nvOut = await execAsync('nvidia-smi', ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits']);
    const parts = nvOut.trim().split(', ');
    vramGB = parseFloat(parts[0]) / 1024;
    gpuName = parts[1] || 'NVIDIA GPU';
  } catch (_) {
    try {
      const wmicOut = await execAsync('wmic', ['path', 'win32_videocontroller', 'get', 'name,adapterram', '/format:csv']);
      const lines = wmicOut.trim().split('\n').filter(l => l.trim());
      if (lines.length > 1) {
        const cols = lines[lines.length - 1].split(',');
        vramGB = parseInt(cols[cols.length - 1]) / (1024 ** 3) || 0;
        gpuName = cols[cols.length - 2] || 'GPU';
      }
    } catch (_) {}
  }
  _gpuCacheResult = { vramGB: Math.round(vramGB * 10) / 10, gpuName };
  _gpuCacheTime = Date.now();
  return _gpuCacheResult;
}

// ─── CPU Usage Monitoring ────────────────────────────────────────────
let _prevCpuTimes = null;

function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  if (_prevCpuTimes) {
    const idleDiff = totalIdle - _prevCpuTimes.idle;
    const totalDiff = totalTick - _prevCpuTimes.total;
    _prevCpuTimes = { idle: totalIdle, total: totalTick };
    return totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
  }
  _prevCpuTimes = { idle: totalIdle, total: totalTick };
  return 0;
}

module.exports = { _truncateResult, _detectGPU, getCpuUsage };
