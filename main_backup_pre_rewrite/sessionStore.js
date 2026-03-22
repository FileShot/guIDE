'use strict';

/**
 * SessionStore — Persistent session state for context management recovery.
 * 
 * Saves rolling summary state, checkpoints, and conversation metadata to disk
 * so the agentic loop can recover from app restarts, crashes, and context rotations.
 * 
 * Uses JSON file persistence (one file per session) in the app data directory.
 * Debounced saves (3s) to avoid perf impact; flush() for immediate writes on rotation.
 * 
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */

const fs = require('fs');
const path = require('path');

class SessionStore {
  constructor(basePath) {
    this._basePath = basePath; // e.g. <userData>/sessions
    this._data = null;
    this._sessionId = null;
    this._dirty = false;
    this._saveTimer = null;
    this._filePath = null;
  }

  /**
   * Initialize the store for a conversation session.
   * @param {string} sessionId - Unique session identifier
   * @returns {boolean} true if an existing session was recovered
   */
  initialize(sessionId) {
    this._sessionId = sessionId;
    try {
      fs.mkdirSync(this._basePath, { recursive: true });
    } catch (_) {}
    this._filePath = path.join(this._basePath, `${this._safeId(sessionId)}.json`);

    // Try to load existing session
    try {
      if (fs.existsSync(this._filePath)) {
        const raw = fs.readFileSync(this._filePath, 'utf8');
        this._data = JSON.parse(raw);
        console.log(`[SessionStore] Recovered session: ${sessionId}`);
        return true;
      }
    } catch (err) {
      console.warn(`[SessionStore] Failed to recover session: ${err.message}`);
    }

    this._data = {
      sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rollingSummary: null,
      checkpoint: null,
      rotationCount: 0,
      toolCallCount: 0,
    };
    return false;
  }

  _safeId(id) {
    return (id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100);
  }

  /**
   * Save the rolling summary state.
   * Called after each tool execution batch and on rotation.
   */
  saveRollingSummary(rollingSummary) {
    if (!this._data) return;
    this._data.rollingSummary = rollingSummary.toJSON();
    this._data.updatedAt = Date.now();
    this._data.toolCallCount = (rollingSummary._completedWork || []).length;
    this._data.rotationCount = rollingSummary._rotationCount || 0;
    this._scheduleSave();
  }

  /**
   * Load a rolling summary from persisted state.
   * @param {Function} RollingSummaryClass - The RollingSummary class (for fromJSON)
   * @returns {RollingSummary|null}
   */
  loadRollingSummary(RollingSummaryClass) {
    if (!this._data?.rollingSummary) return null;
    try {
      return RollingSummaryClass.fromJSON(this._data.rollingSummary);
    } catch (err) {
      console.warn(`[SessionStore] Failed to deserialize rolling summary: ${err.message}`);
      return null;
    }
  }

  /**
   * Save a checkpoint (lightweight metadata for recovery).
   */
  saveCheckpoint(checkpoint) {
    if (!this._data) return;
    this._data.checkpoint = checkpoint;
    this._data.updatedAt = Date.now();
    this._scheduleSave();
  }

  /**
   * Load the most recent checkpoint.
   */
  loadCheckpoint() {
    return this._data?.checkpoint || null;
  }

  /**
   * Force immediate write to disk (called on rotation and conversation end).
   */
  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._writeToDisk();
  }

  /**
   * Schedule a debounced save (3 seconds).
   */
  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._writeToDisk();
    }, 3000);
  }

  _writeToDisk() {
    if (!this._dirty || !this._filePath || !this._data) return;
    try {
      fs.writeFileSync(this._filePath, JSON.stringify(this._data), 'utf8');
      this._dirty = false;
    } catch (err) {
      console.error(`[SessionStore] Failed to save: ${err.message}`);
    }
  }

  /**
   * Clean up old session files (default: older than 7 days).
   */
  cleanup(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
      if (!fs.existsSync(this._basePath)) return;
      const files = fs.readdirSync(this._basePath).filter(f => f.endsWith('.json'));
      const now = Date.now();
      for (const file of files) {
        try {
          const filePath = path.join(this._basePath, file);
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  /**
   * Find the most recent recoverable session (for crash recovery).
   * @param {string} basePath - Sessions directory
   * @param {number} maxAge - Max age in ms (default: 30 minutes)
   * @returns {Object|null} Session metadata or null
   */
  static findRecoverableSession(basePath, maxAge = 30 * 60 * 1000) {
    try {
      if (!fs.existsSync(basePath)) return null;
      const files = fs.readdirSync(basePath).filter(f => f.endsWith('.json'));
      if (files.length === 0) return null;

      let newest = null;
      let newestTime = 0;
      for (const file of files) {
        const stat = fs.statSync(path.join(basePath, file));
        if (stat.mtimeMs > newestTime) {
          newestTime = stat.mtimeMs;
          newest = file;
        }
      }

      if (newest && Date.now() - newestTime < maxAge) {
        const data = JSON.parse(fs.readFileSync(path.join(basePath, newest), 'utf8'));
        return {
          sessionId: data.sessionId,
          filePath: path.join(basePath, newest),
          goal: data.rollingSummary?.goal || '',
          age: Date.now() - newestTime,
          toolCallCount: data.toolCallCount || 0,
          rotationCount: data.rotationCount || 0,
          hasRollingSummary: !!data.rollingSummary,
          hasCheckpoint: !!data.checkpoint,
        };
      }
    } catch (_) {}
    return null;
  }
}

module.exports = { SessionStore };
