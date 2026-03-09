/**
 * guIDE Git Manager — Real git integration using child_process
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Provides: status, diff, stage, unstage, commit, branch, log, blame
 * No external dependencies — uses the system's git binary directly.
 */
const { exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

class GitManager {
  constructor() {
    this.projectPath = null;
    this.gitAvailable = false;
  }

  /**
   * Set the working directory and verify git is available
   */
  async setProjectPath(projectPath) {
    this.projectPath = projectPath;
    this.gitAvailable = false;

    if (!projectPath) return { isRepo: false };

    try {
      // Check if git is installed
      await this._exec('git --version');
      // Check if this is a git repo
      await this._exec('git rev-parse --git-dir');
      this.gitAvailable = true;
      return { isRepo: true };
    } catch {
      return { isRepo: false };
    }
  }

  /**
   * Get current branch name
   */
  async getBranch() {
    try {
      const branch = (await this._exec('git branch --show-current')).trim();
      return branch || 'HEAD (detached)';
    } catch {
      return '';
    }
  }

  /**
   * Get list of all local branches
   */
  async getBranches() {
    try {
      const output = await this._exec('git branch --no-color');
      return output.split('\n')
        .map(b => b.trim())
        .filter(Boolean)
        .map(b => ({
          name: b.replace(/^\*\s+/, ''),
          current: b.startsWith('* '),
        }));
    } catch {
      return [];
    }
  }

  /**
   * Switch to a different branch
   */
  async checkout(branch) {
    try {
      await this._exec(`git checkout ${this._sanitize(branch)}`);
      return { success: true, branch };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get file status (staged, modified, untracked, deleted)
   */
  async getStatus() {
    if (!this.gitAvailable) return { files: [], branch: '' };

    try {
      const [statusOutput, branch] = await Promise.all([
        this._exec('git status --porcelain=v1 -uall'),
        this.getBranch(),
      ]);

      const files = statusOutput.split('\n').filter(Boolean).map(line => {
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.substring(3).trim();

        // Handle renames (R old -> new)
        const parts = filePath.split(' -> ');
        const name = parts.length > 1 ? parts[1] : filePath;
        const oldName = parts.length > 1 ? parts[0] : undefined;

        let status = 'modified';
        let staged = false;

        // Index (staged) status
        if (indexStatus === 'A') { status = 'added'; staged = true; }
        else if (indexStatus === 'M') { status = 'modified'; staged = true; }
        else if (indexStatus === 'D') { status = 'deleted'; staged = true; }
        else if (indexStatus === 'R') { status = 'renamed'; staged = true; }

        // Work tree (unstaged) status
        if (workTreeStatus === 'M') { status = 'modified'; if (indexStatus === ' ') staged = false; }
        else if (workTreeStatus === 'D') { status = 'deleted'; if (indexStatus === ' ') staged = false; }
        else if (workTreeStatus === '?') { status = 'untracked'; staged = false; }

        // Both staged and unstaged changes
        if (indexStatus !== ' ' && indexStatus !== '?' && workTreeStatus !== ' ' && workTreeStatus !== '?') {
          staged = true; // Show in staged, but mark as partially staged
        }

        return { path: name, oldPath: oldName, status, staged, indexStatus, workTreeStatus };
      });

      return { files, branch };
    } catch (error) {
      return { files: [], branch: '', error: error.message };
    }
  }

  /**
   * Get diff for a specific file
   */
  async getDiff(filePath, staged = false) {
    try {
      const flag = staged ? '--cached ' : '';
      const diff = await this._exec(`git diff ${flag}-- ${this._sanitize(filePath)}`);
      return { success: true, diff };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Stage a file
   */
  async stage(filePath) {
    try {
      await this._exec(`git add -- ${this._sanitize(filePath)}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Stage all files
   */
  async stageAll() {
    try {
      await this._exec('git add -A');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Unstage a file
   */
  async unstage(filePath) {
    try {
      await this._exec(`git reset HEAD -- ${this._sanitize(filePath)}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Unstage all files
   */
  async unstageAll() {
    try {
      await this._exec('git reset HEAD');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Discard changes in a file (checkout from HEAD)
   */
  async discardChanges(filePath) {
    try {
      await this._exec(`git checkout -- ${this._sanitize(filePath)}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Commit staged changes
   */
  async commit(message) {
    if (!message || !message.trim()) {
      return { success: false, error: 'Commit message cannot be empty' };
    }
    try {
      const output = await this._exec(`git commit -m ${this._sanitize(message)}`);
      return { success: true, output };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get recent commit log
   */
  async getLog(count = 20) {
    try {
      const output = await this._exec(`git log --oneline --no-color -${count}`);
      return output.split('\n').filter(Boolean).map(line => {
        const spaceIdx = line.indexOf(' ');
        return {
          hash: line.substring(0, spaceIdx),
          message: line.substring(spaceIdx + 1),
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Get number of commits ahead/behind remote
   */
  async getAheadBehind() {
    try {
      const output = await this._exec('git rev-list --left-right --count HEAD...@{upstream}');
      const [ahead, behind] = output.trim().split(/\s+/).map(Number);
      return { ahead: ahead || 0, behind: behind || 0 };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  /**
   * Initialize a new git repo
   */
  async init() {
    try {
      await this._exec('git init');
      this.gitAvailable = true;
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── NEW: Push / Pull / Fetch ──────────────────────────────────────

  /**
   * Push to remote
   */
  async push(remote = 'origin', branch = '') {
    try {
      const branchArg = branch ? ` ${this._sanitize(branch)}` : '';
      const output = await this._exec(`git push ${this._sanitize(remote)}${branchArg}`);
      return { success: true, output };
    } catch (error) {
      // Check if upstream needs to be set
      if (error.message.includes('no upstream branch') || error.message.includes('set-upstream')) {
        try {
          const currentBranch = await this.getBranch();
          const output = await this._exec(`git push --set-upstream ${this._sanitize(remote)} ${this._sanitize(currentBranch)}`);
          return { success: true, output, setUpstream: true };
        } catch (e2) {
          return { success: false, error: e2.message };
        }
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Pull from remote
   */
  async pull(remote = 'origin', branch = '') {
    try {
      const branchArg = branch ? ` ${this._sanitize(branch)}` : '';
      const output = await this._exec(`git pull ${this._sanitize(remote)}${branchArg}`);
      return { success: true, output };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch from remote
   */
  async fetch(remote = 'origin') {
    try {
      const output = await this._exec(`git fetch ${this._sanitize(remote)}`);
      return { success: true, output };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── NEW: Branch creation / deletion / merge ──────────────────────

  /**
   * Create a new branch and optionally switch to it
   */
  async createBranch(name, checkout = true) {
    try {
      if (checkout) {
        await this._exec(`git checkout -b ${this._sanitize(name)}`);
      } else {
        await this._exec(`git branch ${this._sanitize(name)}`);
      }
      return { success: true, branch: name };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a branch (local only)
   */
  async deleteBranch(name, force = false) {
    try {
      const flag = force ? '-D' : '-d';
      await this._exec(`git branch ${flag} ${this._sanitize(name)}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Merge a branch into the current branch
   */
  async merge(branch) {
    try {
      const output = await this._exec(`git merge ${this._sanitize(branch)}`);
      return { success: true, output };
    } catch (error) {
      // Detect merge conflicts
      if (error.message.includes('CONFLICT') || error.message.includes('Automatic merge failed')) {
        try {
          const statusOutput = await this._exec('git status --porcelain=v1');
          const conflictFiles = statusOutput.split('\n')
            .filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD') || l.startsWith('UA') || l.startsWith('AU'))
            .map(l => l.substring(3).trim());
          return { success: false, conflict: true, conflictFiles, error: error.message };
        } catch {
          return { success: false, conflict: true, conflictFiles: [], error: error.message };
        }
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Abort in-progress merge
   */
  async mergeAbort() {
    try {
      await this._exec('git merge --abort');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ─── NEW: Detailed commit info for AI ──────────────────────────────

  /**
   * Get full commit details (message, author, date, diff stats, full diff)
   */
  async getCommitDetail(hash) {
    try {
      const detail = await this._exec(`git show --stat --format="%H%n%an%n%ae%n%ai%n%s%n%b%n---STAT---" ${this._sanitize(hash)}`);
      const lines = detail.split('\n');
      const fullHash = lines[0];
      const author = lines[1];
      const email = lines[2];
      const date = lines[3];
      const subject = lines[4];
      const bodyLines = [];
      let i = 5;
      while (i < lines.length && lines[i] !== '---STAT---') {
        bodyLines.push(lines[i]);
        i++;
      }
      const body = bodyLines.join('\n').trim();
      // Everything after ---STAT--- is the stat output
      const stats = lines.slice(i + 1).join('\n').trim();

      return {
        success: true,
        commit: { hash: fullHash, author, email, date, subject, body, stats }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get full diff for staged changes (for AI commit message generation)
   */
  async getStagedDiff() {
    try {
      const diff = await this._exec('git diff --cached');
      return { success: true, diff };
    } catch (error) {
      return { success: false, diff: '', error: error.message };
    }
  }

  /**
   * Get full diff of all uncommitted changes (staged + unstaged)
   */
  async getAllDiff() {
    try {
      const [staged, unstaged] = await Promise.all([
        this._exec('git diff --cached').catch(() => ''),
        this._exec('git diff').catch(() => ''),
      ]);
      return { success: true, diff: (staged + '\n' + unstaged).trim() };
    } catch (error) {
      return { success: false, diff: '', error: error.message };
    }
  }

  /**
   * Get the diff of a specific commit
   */
  async getCommitDiff(hash) {
    try {
      const diff = await this._exec(`git show --format="" ${this._sanitize(hash)}`);
      return { success: true, diff };
    } catch (error) {
      return { success: false, diff: '', error: error.message };
    }
  }

  /**
   * Check if we're currently in a merge conflict state
   */
  async getMergeState() {
    try {
      const mergeHeadPath = path.join(this.projectPath, '.git', 'MERGE_HEAD');
      const inMerge = fs.existsSync(mergeHeadPath);
      if (!inMerge) return { inMerge: false, conflictFiles: [] };

      const statusOutput = await this._exec('git status --porcelain=v1');
      const conflictFiles = statusOutput.split('\n')
        .filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD') || l.startsWith('UA') || l.startsWith('AU'))
        .map(l => l.substring(3).trim());
      return { inMerge: true, conflictFiles };
    } catch {
      return { inMerge: false, conflictFiles: [] };
    }
  }

  /**
   * Get git blame for a file — returns per-line authorship info
   */
  async getBlame(filePath) {
    if (!this.gitAvailable || !filePath) return [];
    try {
      // Use --porcelain for machine-readable output
      const relPath = path.relative(this.projectPath, filePath).replace(/\\/g, '/');
      const output = await this._exec(`git blame --porcelain ${this._sanitize(relPath)}`);
      const lines = output.split('\n');
      const blameData = [];
      let current = {};

      for (const line of lines) {
        if (line.startsWith('\t')) {
          // Content line — this marks end of a blame entry
          blameData.push({ ...current });
        } else if (/^[0-9a-f]{40}/.test(line)) {
          const parts = line.split(' ');
          current = { hash: parts[0], originalLine: parseInt(parts[1]), finalLine: parseInt(parts[2]) };
        } else if (line.startsWith('author ')) {
          current.author = line.substring(7);
        } else if (line.startsWith('author-time ')) {
          current.timestamp = parseInt(line.substring(12)) * 1000;
        } else if (line.startsWith('summary ')) {
          current.summary = line.substring(8);
        }
      }

      // Format for UI: one entry per line
      return blameData.map(b => ({
        line: b.finalLine,
        hash: b.hash?.substring(0, 7) || '',
        author: b.author || '',
        date: b.timestamp ? new Date(b.timestamp).toLocaleDateString() : '',
        summary: b.summary || '',
      }));
    } catch {
      return [];
    }
  }

  // ── Helpers ──

  _sanitize(input) {
    // Escape for shell: wrap in double quotes, escape inner double quotes
    return `"${(input || '').replace(/"/g, '\\"')}"`;
  }

  _exec(command) {
    return new Promise((resolve, reject) => {
      exec(command, {
        cwd: this.projectPath,
        maxBuffer: 1024 * 1024, // 1MB
        timeout: 15000,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}

module.exports = { GitManager };
