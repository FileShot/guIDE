/**
 * guIDE Terminal Manager - Manages PTY instances for integrated terminal
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Uses node-pty for real terminal emulation
 */
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

class TerminalManager extends EventEmitter {
  constructor() {
    super();
    this.terminals = new Map(); // id -> { pty, title, cwd }
    this.nextId = 1;
    this.pty = null;

    // Try to load node-pty
    try {
      this.pty = require('node-pty');
    } catch (e) {
      console.warn('node-pty not available; terminal will use fallback mode');
    }
  }

  /**
   * Create a new terminal instance
   */
  create(options = {}) {
    const id = this.nextId++;
    const cwd = options.cwd || os.homedir();
    const shell = this._getDefaultShell();

    if (!this.pty) {
      // Fallback: use child_process
      return this._createFallbackTerminal(id, cwd, options);
    }

    try {
      const ptyProcess = this.pty.spawn(shell.command, shell.args, {
        name: 'xterm-256color',
        cols: options.cols || 120,
        rows: options.rows || 30,
        cwd: cwd,
        env: { ...process.env, ...options.env },
        useConpty: process.platform === 'win32',
      });

      const terminal = {
        id,
        pty: ptyProcess,
        title: options.title || `Terminal ${id}`,
        cwd,
        pid: ptyProcess.pid,
        shell: shell.command,
      };

      this.terminals.set(id, terminal);

      // Forward data events
      ptyProcess.onData((data) => {
        this.emit('data', { id, data });
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        this.emit('exit', { id, exitCode, signal });
        this.terminals.delete(id);
      });

      return { id, pid: ptyProcess.pid, shell: shell.command, title: terminal.title };
    } catch (error) {
      console.error('Failed to create PTY terminal:', error);
      return this._createFallbackTerminal(id, cwd, options);
    }
  }

  _createFallbackTerminal(id, cwd, options = {}) {
    const { spawn } = require('child_process');
    const shell = this._getDefaultShell();

    const proc = spawn(shell.command, shell.args, {
      cwd,
      env: { ...process.env, ...options.env },
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const terminal = {
      id,
      process: proc,
      title: options.title || `Terminal ${id}`,
      cwd,
      pid: proc.pid,
      shell: shell.command,
      isFallback: true,
    };

    this.terminals.set(id, terminal);

    proc.stdout.on('data', (data) => {
      this.emit('data', { id, data: data.toString() });
    });

    proc.stderr.on('data', (data) => {
      this.emit('data', { id, data: data.toString() });
    });

    proc.on('exit', (exitCode, signal) => {
      this.emit('exit', { id, exitCode, signal });
      this.terminals.delete(id);
    });

    return { id, pid: proc.pid, shell: shell.command, title: terminal.title, fallback: true };
  }

  /**
   * Write data to terminal
   */
  write(id, data) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;

    if (terminal.pty) {
      terminal.pty.write(data);
    } else if (terminal.process) {
      terminal.process.stdin.write(data);
    }
    return true;
  }

  /**
   * Resize terminal
   */
  resize(id, cols, rows) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;

    if (terminal.pty) {
      try {
        terminal.pty.resize(cols, rows);
      } catch (e) {
        // Ignore resize errors
      }
    }
    return true;
  }

  /**
   * Destroy a terminal
   */
  destroy(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;

    if (terminal.pty) {
      terminal.pty.kill();
    } else if (terminal.process) {
      terminal.process.kill();
    }
    this.terminals.delete(id);
    return true;
  }

  /**
   * Get all terminal info
   */
  list() {
    return Array.from(this.terminals.entries()).map(([id, t]) => ({
      id,
      title: t.title,
      cwd: t.cwd,
      pid: t.pid,
      shell: t.shell,
    }));
  }

  /**
   * Get default shell for the platform
   */
  _getDefaultShell() {
    if (process.platform === 'win32') {
      // Prefer PowerShell 7 → Windows PowerShell → cmd.exe
      const fs = require('fs');
      const pwsh7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
      const pwsh5 = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      let command = process.env.COMSPEC || 'cmd.exe'; // last resort
      if (fs.existsSync(pwsh7)) {
        command = pwsh7;
      } else if (fs.existsSync(pwsh5)) {
        command = pwsh5;
      }
      return { command, args: [] };
    } else if (process.platform === 'darwin') {
      return { command: process.env.SHELL || '/bin/zsh', args: ['-l'] };
    } else {
      return { command: process.env.SHELL || '/bin/bash', args: ['-l'] };
    }
  }

  /**
   * Clean up all terminals
   */
  disposeAll() {
    for (const [id] of this.terminals) {
      this.destroy(id);
    }
  }
}

module.exports = { TerminalManager };
