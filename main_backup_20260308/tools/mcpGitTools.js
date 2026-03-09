/**
 * MCP Git Tools — Git version control methods for MCPToolServer.
 * Extracted from mcpToolServer.js (ARCH-03).
 * These methods are mixed into MCPToolServer.prototype so `this` works.
 */

async function _gitStatus() {
  if (!this.gitManager) return { success: false, error: 'Git not available. Open a project first.' };
  try {
    const status = await this.gitManager.getStatus();
    return { success: true, ...status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function _gitCommit(message) {
  if (!this.gitManager) return { success: false, error: 'Git not available. Open a project first.' };
  try {
    await this.gitManager.stageAll();
    const result = await this.gitManager.commit(message);
    return { success: true, message: `Committed: "${message}"`, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function _gitDiff(filePath) {
  if (!this.gitManager) return { success: false, error: 'Git not available. Open a project first.' };
  try {
    const diff = await this.gitManager.getDiff(filePath || null, false);
    return { success: true, diff: diff || 'No changes', hasChanges: !!diff };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function _gitLog(maxCount = 20, filePath) {
  const cwd = this.projectPath;
  if (!cwd) return { success: false, error: 'No project opened' };
  const count = Math.min(Math.max(maxCount || 20, 1), 100);
  const fileArg = filePath ? ` -- "${this._sanitizeShellArg(filePath)}"` : '';
  const cmd = `git log --oneline --decorate -n ${count}${fileArg}`;
  const result = await this._runCommand(cmd, cwd, 15000);
  if (!result.success) return result;
  const commits = result.stdout.trim().split('\n').filter(Boolean).map(line => {
    const spaceIdx = line.indexOf(' ');
    return { hash: line.substring(0, spaceIdx), message: line.substring(spaceIdx + 1) };
  });
  return { success: true, commits, total: commits.length };
}

async function _gitBranch(action, name) {
  const cwd = this.projectPath;
  if (!cwd) return { success: false, error: 'No project opened' };
  let cmd;
  switch (action) {
    case 'list':
      cmd = 'git branch -a';
      break;
    case 'create':
      if (!name) return { success: false, error: 'Branch name is required for create' };
      cmd = `git checkout -b "${this._sanitizeShellArg(name)}"`;
      break;
    case 'switch':
      if (!name) return { success: false, error: 'Branch name is required for switch' };
      cmd = `git checkout "${this._sanitizeShellArg(name)}"`;
      break;
    default:
      return { success: false, error: `Invalid action: ${action}. Use 'list', 'create', or 'switch'` };
  }
  const result = await this._runCommand(cmd, cwd, 30000);
  return { success: result.exitCode === 0 || result.success, output: (result.stdout + result.stderr).trim(), action };
}

async function _gitStash(action, message) {
  const cwd = this.projectPath;
  if (!cwd) return { success: false, error: 'No project opened' };
  let cmd;
  switch (action) {
    case 'push':
      cmd = message ? `git stash push -m "${this._sanitizeShellArg(message)}"` : 'git stash push';
      break;
    case 'pop':
      cmd = 'git stash pop';
      break;
    case 'list':
      cmd = 'git stash list';
      break;
    case 'drop':
      cmd = 'git stash drop';
      break;
    default:
      return { success: false, error: `Invalid action: ${action}. Use 'push', 'pop', 'list', or 'drop'` };
  }
  const result = await this._runCommand(cmd, cwd, 30000);
  return { success: result.exitCode === 0 || result.success, output: (result.stdout + result.stderr).trim(), action };
}

async function _gitReset(filePath, hard = false) {
  const cwd = this.projectPath;
  if (!cwd) return { success: false, error: 'No project opened' };
  let cmd;
  if (hard) {
    cmd = filePath ? `git checkout -- "${this._sanitizeShellArg(filePath)}"` : 'git reset --hard HEAD';
  } else {
    cmd = filePath ? `git reset HEAD "${this._sanitizeShellArg(filePath)}"` : 'git reset HEAD';
  }
  const result = await this._runCommand(cmd, cwd, 15000);
  return { success: result.exitCode === 0 || result.success, output: (result.stdout + result.stderr).trim(), action: hard ? 'hard_reset' : 'unstage' };
}

module.exports = {
  _gitStatus,
  _gitCommit,
  _gitDiff,
  _gitLog,
  _gitBranch,
  _gitStash,
  _gitReset,
};
