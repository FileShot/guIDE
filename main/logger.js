/**
 * Structured logger for the guIDE main process.
 * Provides leveled logging (debug/info/warn/error) with consistent formatting.
 * All log entries include a timestamp and source tag.
 * 
 * PERSISTENT FILE LOGGING: All logs at info+ are written to a rotating log file
 * at %APPDATA%/guIDE/logs/guide-main.log (max 10MB, keeps 1 backup).
 * Debug logs go to file only when LOG_LEVEL=debug.
 *
 * Usage:
 *   const log = require('./main/logger');
 *   log.info('IDE', 'Service initialized');
 *   log.warn('Security', 'Denied permission', permission);
 *   log.error('LLM', 'Failed to load model', err.message);
 *   log.debug('RAG', 'Indexed chunk', chunkId);
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Default level — can be overridden via LOG_LEVEL env var
// Default to 'debug' for maximum verbosity in log file
let currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.debug;

// ── Persistent log file setup ──
// Use Electron's actual userData path (guide-ide), not a hardcoded name.
// In the main process, app may not be ready yet, so we use the package.json name
// which Electron derives the userData directory from.
const LOG_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'guide-ide', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'guide-main.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

let _logStream = null;
let _logBytes = 0;

function _ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (_) {}
}

function _getLogStream() {
  if (_logStream) return _logStream;
  try {
    _ensureLogDir();
    // Check existing file size for rotation
    try {
      const stat = fs.statSync(LOG_FILE);
      _logBytes = stat.size;
    } catch (_) { _logBytes = 0; }
    _logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    _logStream.on('error', () => { _logStream = null; });
    return _logStream;
  } catch (_) { return null; }
}

function _rotateIfNeeded() {
  if (_logBytes < MAX_LOG_SIZE) return;
  try {
    if (_logStream) { _logStream.end(); _logStream = null; }
    const backup = LOG_FILE + '.1';
    try { fs.unlinkSync(backup); } catch (_) {}
    fs.renameSync(LOG_FILE, backup);
    _logBytes = 0;
  } catch (_) {}
}

function _writeToFile(line) {
  _rotateIfNeeded();
  const stream = _getLogStream();
  if (stream) {
    stream.write(line + '\n');
    _logBytes += line.length + 1;
  }
}

function _format(level, tag, args) {
  const ts = new Date().toISOString().substring(11, 23); // HH:mm:ss.SSS
  const prefix = `${ts} [${tag}]`;
  return [prefix, ...args];
}

function _formatFileLine(level, tag, args) {
  const ts = new Date().toISOString(); // Full ISO timestamp for file logs
  const msgParts = args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
    return String(a);
  });
  return `${ts} ${level.toUpperCase().padEnd(5)} [${tag}] ${msgParts.join(' ')}`;
}

const logger = {
  /** Set minimum log level: 'debug' | 'info' | 'warn' | 'error' */
  setLevel(level) {
    currentLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  },

  /** Get current log level name */
  getLevel() {
    return Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === currentLevel) || 'info';
  },

  /** Get path to the active log file */
  getLogPath() {
    return LOG_FILE;
  },

  debug(tag, ...args) {
    if (currentLevel <= LOG_LEVELS.debug) {
      console.log(..._format('DEBUG', tag, args));
      _writeToFile(_formatFileLine('debug', tag, args));
    }
  },

  info(tag, ...args) {
    if (currentLevel <= LOG_LEVELS.info) {
      console.log(..._format('INFO', tag, args));
    }
    // Always write info+ to file regardless of console level
    _writeToFile(_formatFileLine('info', tag, args));
  },

  warn(tag, ...args) {
    if (currentLevel <= LOG_LEVELS.warn) {
      console.warn(..._format('WARN', tag, args));
    }
    _writeToFile(_formatFileLine('warn', tag, args));
  },

  error(tag, ...args) {
    if (currentLevel <= LOG_LEVELS.error) {
      console.error(..._format('ERROR', tag, args));
    }
    _writeToFile(_formatFileLine('error', tag, args));
  },

  /** Flush and close the log stream (call on app quit) */
  close() {
    if (_logStream) { _logStream.end(); _logStream = null; }
  },

  /**
   * Install console intercepts so ALL console.log/warn/error calls across every
   * module automatically get written to the persistent log file.
   * This must be called ONCE at startup from electron-main.js.
   */
  installConsoleIntercepts() {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    console.log = (...args) => {
      origLog(...args);
      const msg = args.map(a => {
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
        return String(a);
      }).join(' ');
      _writeToFile(`${new Date().toISOString()} LOG   ${msg}`);
    };
    console.warn = (...args) => {
      origWarn(...args);
      const msg = args.map(a => {
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
        return String(a);
      }).join(' ');
      _writeToFile(`${new Date().toISOString()} WARN  ${msg}`);
    };
    console.error = (...args) => {
      origError(...args);
      const msg = args.map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return String(a); } }
        return String(a);
      }).join(' ');
      _writeToFile(`${new Date().toISOString()} ERROR ${msg}`);
    };

    // Also capture uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (err) => {
      _writeToFile(`${new Date().toISOString()} FATAL [UncaughtException] ${err.stack || err.message || err}`);
    });
    process.on('unhandledRejection', (reason) => {
      const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
      _writeToFile(`${new Date().toISOString()} ERROR [UnhandledRejection] ${msg}`);
    });
  },
};

// Write session start marker
_writeToFile(`\n${'='.repeat(80)}\n${new Date().toISOString()} SESSION START — guIDE v${require('../package.json').version || '?'}\n${'='.repeat(80)}`);

module.exports = logger;
