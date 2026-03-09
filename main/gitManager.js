'use strict';
/**
 * guIDE Git Manager — shell-based git integration
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Every operation shells out to the system git binary.
 * No external dependencies.
 */

const { exec } = require('child_process');
const path     = require('path');
const fs       = require('fs');

class GitManager {
  constructor() {
    this.projectPath  = null;
    this.gitAvailable = false;
  }

  /* ── Setup ────────────────────────────────────────────────────── */

  async setProjectPath(projectPath) {
    this.projectPath  = projectPath;
    this.gitAvailable = false;
    if (!projectPath) return { isRepo: false };
    try {
      await this._exec('git --version');
      await this._exec('git rev-parse --git-dir');
      this.gitAvailable = true;
      return { isRepo: true };
    } catch { return { isRepo: false }; }
  }

  /* ── Branch queries ───────────────────────────────────────────── */

  async getBranch() {
    try {
      const b = (await this._exec('git branch --show-current')).trim();
      return b || 'HEAD (detached)';
    } catch { return ''; }
  }

  async getBranches() {
    try {
      const out = await this._exec('git branch --no-color');
      return out.split('\n').map(l => l.trim()).filter(Boolean).map(l => ({
        name: l.replace(/^\*\s+/, ''), current: l.startsWith('* '),
      }));
    } catch { return []; }
  }

  async checkout(branch) {
    try { await this._exec(`git checkout ${this._q(branch)}`); return { success: true, branch }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  /* ── Status & diff ────────────────────────────────────────────── */

  async getStatus() {
    if (!this.gitAvailable) return { files: [], branch: '' };
    try {
      const [raw, branch] = await Promise.all([
        this._exec('git status --porcelain=v1 -uall'), this.getBranch(),
      ]);
      const files = raw.split('\n').filter(Boolean).map(line => {
        const ix = line[0], wt = line[1];
        const fp = line.substring(3).trim();
        const parts = fp.split(' -> ');
        const name    = parts.length > 1 ? parts[1] : fp;
        const oldPath = parts.length > 1 ? parts[0] : undefined;
        let status = 'modified', staged = false;
        if (ix === 'A') { status = 'added';     staged = true; }
        else if (ix === 'M') { status = 'modified';  staged = true; }
        else if (ix === 'D') { status = 'deleted';   staged = true; }
        else if (ix === 'R') { status = 'renamed';   staged = true; }
        if (wt === 'M') { status = 'modified';  if (ix === ' ') staged = false; }
        else if (wt === 'D') { status = 'deleted';   if (ix === ' ') staged = false; }
        else if (wt === '?') { status = 'untracked'; staged = false; }
        if (ix !== ' ' && ix !== '?' && wt !== ' ' && wt !== '?') staged = true;
        return { path: name, oldPath, status, staged, indexStatus: ix, workTreeStatus: wt };
      });
      return { files, branch };
    } catch (e) { return { files: [], branch: '', error: e.message }; }
  }

  async getDiff(filePath, staged = false) {
    try {
      const flag = staged ? '--cached ' : '';
      const diff = await this._exec(`git diff ${flag}-- ${this._q(filePath)}`);
      return { success: true, diff };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async getStagedDiff() {
    try { return { success: true, diff: await this._exec('git diff --cached') }; }
    catch (e) { return { success: false, diff: '', error: e.message }; }
  }

  async getAllDiff() {
    try {
      const [s, u] = await Promise.all([
        this._exec('git diff --cached').catch(() => ''),
        this._exec('git diff').catch(() => ''),
      ]);
      return { success: true, diff: (s + '\n' + u).trim() };
    } catch (e) { return { success: false, diff: '', error: e.message }; }
  }

  /* ── Stage / unstage / discard ────────────────────────────────── */

  async stage(filePath) {
    try { await this._exec(`git add -- ${this._q(filePath)}`); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  async stageAll() {
    try { await this._exec('git add -A'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  async unstage(filePath) {
    try { await this._exec(`git reset HEAD -- ${this._q(filePath)}`); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  async unstageAll() {
    try { await this._exec('git reset HEAD'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  async discardChanges(filePath) {
    try { await this._exec(`git checkout -- ${this._q(filePath)}`); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  /* ── Commit ───────────────────────────────────────────────────── */

  async commit(message) {
    if (!message?.trim()) return { success: false, error: 'Commit message cannot be empty' };
    try {
      const out = await this._exec(`git commit -m ${this._q(message)}`);
      return { success: true, output: out };
    } catch (e) { return { success: false, error: e.message }; }
  }

  /* ── Log ──────────────────────────────────────────────────────── */

  async getLog(count = 20) {
    try {
      const out = await this._exec(`git log --oneline --no-color -${Math.max(1, count | 0)}`);
      return out.split('\n').filter(Boolean).map(l => {
        const i = l.indexOf(' ');
        return { hash: l.substring(0, i), message: l.substring(i + 1) };
      });
    } catch { return []; }
  }

  async getCommitDetail(hash) {
    try {
      const raw = await this._exec(
        `git show --stat --format="%H%n%an%n%ae%n%ai%n%s%n%b%n---STAT---" ${this._q(hash)}`
      );
      const lines = raw.split('\n');
      const bodyLines = [];
      let i = 5;
      while (i < lines.length && lines[i] !== '---STAT---') { bodyLines.push(lines[i]); i++; }
      return {
        success: true,
        commit: {
          hash: lines[0], author: lines[1], email: lines[2], date: lines[3],
          subject: lines[4], body: bodyLines.join('\n').trim(),
          stats: lines.slice(i + 1).join('\n').trim(),
        },
      };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async getCommitDiff(hash) {
    try { return { success: true, diff: await this._exec(`git show --format="" ${this._q(hash)}`) }; }
    catch (e) { return { success: false, diff: '', error: e.message }; }
  }

  async getAheadBehind() {
    try {
      const out = await this._exec('git rev-list --left-right --count HEAD...@{upstream}');
      const [a, b] = out.trim().split(/\s+/).map(Number);
      return { ahead: a || 0, behind: b || 0 };
    } catch { return { ahead: 0, behind: 0 }; }
  }

  /* ── Init ─────────────────────────────────────────────────────── */

  async init() {
    try { await this._exec('git init'); this.gitAvailable = true; return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  /* ── Push / pull / fetch ──────────────────────────────────────── */

  async push(remote = 'origin', branch = '') {
    try {
      const ba = branch ? ` ${this._q(branch)}` : '';
      const out = await this._exec(`git push ${this._q(remote)}${ba}`);
      return { success: true, output: out };
    } catch (e) {
      if (e.message.includes('no upstream branch') || e.message.includes('set-upstream')) {
        try {
          const cur = await this.getBranch();
          const out = await this._exec(`git push --set-upstream ${this._q(remote)} ${this._q(cur)}`);
          return { success: true, output: out, setUpstream: true };
        } catch (e2) { return { success: false, error: e2.message }; }
      }
      return { success: false, error: e.message };
    }
  }

  async pull(remote = 'origin', branch = '') {
    try {
      const ba = branch ? ` ${this._q(branch)}` : '';
      return { success: true, output: await this._exec(`git pull ${this._q(remote)}${ba}`) };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async fetch(remote = 'origin') {
    try { return { success: true, output: await this._exec(`git fetch ${this._q(remote)}`) }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  /* ── Branch create / delete / merge ───────────────────────────── */

  async createBranch(name, checkout = true) {
    try {
      await this._exec(checkout ? `git checkout -b ${this._q(name)}` : `git branch ${this._q(name)}`);
      return { success: true, branch: name };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async deleteBranch(name, force = false) {
    try {
      await this._exec(`git branch ${force ? '-D' : '-d'} ${this._q(name)}`);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  }

  async merge(branch) {
    try {
      const out = await this._exec(`git merge ${this._q(branch)}`);
      return { success: true, output: out };
    } catch (e) {
      if (e.message.includes('CONFLICT') || e.message.includes('Automatic merge failed')) {
        try {
          const st = await this._exec('git status --porcelain=v1');
          const cf = st.split('\n')
            .filter(l => /^(UU|AA|DD|UA|AU)/.test(l))
            .map(l => l.substring(3).trim());
          return { success: false, conflict: true, conflictFiles: cf, error: e.message };
        } catch { return { success: false, conflict: true, conflictFiles: [], error: e.message }; }
      }
      return { success: false, error: e.message };
    }
  }

  async mergeAbort() {
    try { await this._exec('git merge --abort'); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  }

  async getMergeState() {
    try {
      const mergeHead = path.join(this.projectPath, '.git', 'MERGE_HEAD');
      if (!fs.existsSync(mergeHead)) return { inMerge: false, conflictFiles: [] };
      const st = await this._exec('git status --porcelain=v1');
      const cf = st.split('\n')
        .filter(l => /^(UU|AA|DD|UA|AU)/.test(l))
        .map(l => l.substring(3).trim());
      return { inMerge: true, conflictFiles: cf };
    } catch { return { inMerge: false, conflictFiles: [] }; }
  }

  /* ── Blame ────────────────────────────────────────────────────── */

  async getBlame(filePath) {
    if (!this.gitAvailable || !filePath) return [];
    try {
      const rel = path.relative(this.projectPath, filePath).replace(/\\/g, '/');
      const out = await this._exec(`git blame --porcelain ${this._q(rel)}`);
      const lines = out.split('\n');
      const result = [];
      let cur = {};
      for (const line of lines) {
        if (line.startsWith('\t')) {
          result.push({ ...cur });
        } else if (/^[0-9a-f]{40}/.test(line)) {
          const p = line.split(' ');
          cur = { hash: p[0], originalLine: +p[1], finalLine: +p[2] };
        } else if (line.startsWith('author '))      cur.author    = line.substring(7);
          else if (line.startsWith('author-time ')) cur.timestamp = +line.substring(12) * 1000;
          else if (line.startsWith('summary '))     cur.summary   = line.substring(8);
      }
      return result.map(b => ({
        line: b.finalLine, hash: b.hash?.substring(0, 7) || '',
        author: b.author || '', summary: b.summary || '',
        date: b.timestamp ? new Date(b.timestamp).toLocaleDateString() : '',
      }));
    } catch { return []; }
  }

  /* ── Helpers ──────────────────────────────────────────────────── */

  _q(input) { return `"${(input || '').replace(/"/g, '\\"')}"`; }

  _exec(command) {
    return new Promise((resolve, reject) => {
      exec(command, {
        cwd: this.projectPath, maxBuffer: 1024 * 1024,
        timeout: 15000, windowsHide: true,
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }
}

module.exports = { GitManager };
