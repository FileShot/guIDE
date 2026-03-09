'use strict';

// Git tool methods — mixed onto MCPToolServer.prototype
// All methods use `this` to access gitManager, _runCommand, _sanitizeShellArg

async function _gitStatus() {
  if (this.gitManager) return this.gitManager.getStatus();
  return { success: false, error: 'Git manager not available' };
}

async function _gitCommit(message) {
  if (!this.gitManager) return { success: false, error: 'Git manager not available' };
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { success: false, error: 'Commit message is required' };
  }
  await this.gitManager.stageAll();
  return this.gitManager.commit(message.trim());
}

async function _gitDiff(options = {}) {
  if (this.gitManager) return this.gitManager.getDiff(options);
  return { success: false, error: 'Git manager not available' };
}

async function _gitLog(count = 20) {
  count = Math.min(100, Math.max(1, parseInt(count) || 20));
  const result = await this._runCommand(`git log --oneline -${count}`);
  if (!result || result.exitCode !== 0) {
    return { success: false, error: result?.stderr || 'git log failed' };
  }
  const entries = result.stdout.split('\n').filter(Boolean).map(line => {
    const spaceIdx = line.indexOf(' ');
    return {
      hash: spaceIdx > 0 ? line.slice(0, spaceIdx) : line,
      message: spaceIdx > 0 ? line.slice(spaceIdx + 1) : '',
    };
  });
  return { success: true, entries };
}

async function _gitBranch(action, name) {
  const safe = name ? this._sanitizeShellArg(name) : '';
  switch (action) {
    case 'list':
      return this._runCommand('git branch -a');
    case 'create':
      if (!safe) return { success: false, error: 'Branch name required' };
      return this._runCommand(`git checkout -b ${safe}`);
    case 'switch':
      if (!safe) return { success: false, error: 'Branch name required' };
      return this._runCommand(`git checkout ${safe}`);
    default:
      return this._runCommand('git branch');
  }
}

async function _gitStash(action = 'push', message) {
  switch (action) {
    case 'push': {
      const msg = message ? ` -m ${this._sanitizeShellArg(message)}` : '';
      return this._runCommand(`git stash push${msg}`);
    }
    case 'pop':
      return this._runCommand('git stash pop');
    case 'list':
      return this._runCommand('git stash list');
    case 'drop':
      return this._runCommand('git stash drop');
    default:
      return this._runCommand('git stash');
  }
}

async function _gitReset(mode = 'soft', filePath) {
  if (mode === 'hard' && filePath) {
    const safe = this._sanitizeShellArg(filePath);
    return this._runCommand(`git checkout -- ${safe}`);
  }
  if (mode === 'soft') {
    if (filePath) {
      const safe = this._sanitizeShellArg(filePath);
      return this._runCommand(`git reset HEAD ${safe}`);
    }
    return this._runCommand('git reset HEAD');
  }
  return { success: false, error: 'Use mode "soft" or "hard"' };
}

module.exports = {
  _gitStatus, _gitCommit, _gitDiff, _gitLog,
  _gitBranch, _gitStash, _gitReset,
};
