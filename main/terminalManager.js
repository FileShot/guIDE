/**
 * guIDE — Terminal Manager
 *
 * Manages pseudo-terminal sessions via node-pty (with child_process fallback).
 * Each terminal has an id, a PTY process, and emits 'data' / 'exit' events.
 */
'use strict';

const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const log = require('./logger');

let pty;
try {
  pty = require('node-pty');
} catch {
  pty = null;
  log.warn('Terminal', 'node-pty unavailable — falling back to child_process');
}

class TerminalManager extends EventEmitter {
  constructor() {
    super();
    this._terminals = new Map(); // id → { pty, cwd }
    this._nextId = 1;
  }

  /* ── Create ────────────────────────────────────────────────────── */

  create(opts = {}) {
    const id = this._nextId++;
    const shell = opts.shell || _defaultShell();
    const cwd = opts.cwd || os.homedir();
    const cols = opts.cols || 120;
    const rows = opts.rows || 30;
    const env = { ...process.env, ...opts.env };

    if (pty) {
      const proc = pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env });
      proc.onData(data => this.emit('data', { id, data }));
      proc.onExit(({ exitCode }) => {
        this.emit('exit', { id, exitCode });
        this._terminals.delete(id);
      });
      this._terminals.set(id, { pty: proc, cwd });
    } else {
      // Fallback: child_process.spawn with piped stdio
      const { spawn } = require('child_process');
      const proc = spawn(shell, [], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
      proc.stdout.on('data', data => this.emit('data', { id, data: data.toString() }));
      proc.stderr.on('data', data => this.emit('data', { id, data: data.toString() }));
      proc.on('exit', (exitCode) => {
        this.emit('exit', { id, exitCode });
        this._terminals.delete(id);
      });
      this._terminals.set(id, { proc, cwd, fallback: true });
    }

    log.info('Terminal', `Created terminal ${id} (${shell})`);
    return id;
  }

  /* ── Write ─────────────────────────────────────────────────────── */

  write(id, data) {
    const t = this._terminals.get(id);
    if (!t) return;
    if (t.pty) {
      t.pty.write(data);
    } else if (t.proc?.stdin?.writable) {
      t.proc.stdin.write(data);
    }
  }

  /* ── Resize ────────────────────────────────────────────────────── */

  resize(id, cols, rows) {
    const t = this._terminals.get(id);
    if (!t) return;
    if (t.pty) {
      try { t.pty.resize(cols, rows); } catch (_) {}
    }
    // child_process fallback has no resize support
  }

  /* ── Destroy ───────────────────────────────────────────────────── */

  destroy(id) {
    const t = this._terminals.get(id);
    if (!t) return;
    try {
      if (t.pty) {
        t.pty.kill();
      } else if (t.proc) {
        t.proc.kill();
      }
    } catch (_) {}
    this._terminals.delete(id);
    log.info('Terminal', `Destroyed terminal ${id}`);
  }

  /* ── Query ─────────────────────────────────────────────────────── */

  list() {
    return [...this._terminals.entries()].map(([id, t]) => ({
      id,
      cwd: t.cwd,
      fallback: !!t.fallback,
    }));
  }

  /* ── Cleanup ───────────────────────────────────────────────────── */

  disposeAll() {
    for (const id of [...this._terminals.keys()]) {
      this.destroy(id);
    }
  }
}

function _defaultShell() {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

module.exports = { TerminalManager };
