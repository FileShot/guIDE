/**
 * guIDE — Path Validator
 * 
 * Ensures file operations stay within allowed directories.
 * Blocks system directories, credential files, and other sensitive paths.
 */
'use strict';

const { app } = require('electron');
const path = require('path');

function createPathValidator(appBasePath, modelsBasePath, getCurrentProjectPath) {
  const ALLOWED_ROOTS = [
    appBasePath,
    modelsBasePath,
    app.getPath('userData'),
    app.getPath('home'),
    app.getPath('documents'),
    app.getPath('desktop'),
    app.getPath('downloads'),
  ];

  const BLOCKED_PATTERNS = [
    /[\\/]windows[\\/]system32/i,
    /[\\/]program files/i,
    /[\\/]programdata/i,
    /[\\/](etc|boot|sbin|proc|sys)[\\/]/i,
    /[\\/]\.ssh[\\/]?/i,
    /[\\/]\.gnupg[\\/]?/i,
    /[\\/]\.aws[\\/]?/i,
    /[\\/]\.azure[\\/]?/i,
    /[\\/]\.kube[\\/]?/i,
    /[\\/]\.docker[\\/]?/i,
    /[\\/]\.npmrc$/i,
    /[\\/]\.pypirc$/i,
    /[\\/]\.netrc$/i,
    /[\\/]\.bash_history$/i,
    /[\\/]\.zsh_history$/i,
    /[\\/]\.gitconfig$/i,
    /[\\/]\.git-credentials$/i,
  ];

  /**
   * Check if a file path is within allowed boundaries.
   * Sanitizes control characters that can result from malformed JSON
   * (e.g., \\b becoming backspace in parsed strings).
   */
  function isPathAllowed(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return false;
    // Strip control characters — none are valid in file paths
    const sanitized = targetPath.replace(/[\x00-\x1F]/g, '');
    const resolved = path.resolve(sanitized);

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(resolved)) return false;
    }

    const roots = [...ALLOWED_ROOTS];
    const projectPath = getCurrentProjectPath();
    if (projectPath) roots.push(projectPath);

    for (const root of roots) {
      if (root && resolved.startsWith(path.resolve(root))) return true;
    }
    return false;
  }

  return isPathAllowed;
}

module.exports = { createPathValidator };
