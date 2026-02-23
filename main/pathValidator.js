/**
 * Path validation — ensures file operations stay within allowed boundaries.
 * Blocks access to system directories, other users' folders, etc.
 */
const { app } = require('electron');
const path = require('path');

function createPathValidator(appBasePath, modelsBasePath, getCurrentProjectPath) {
  const ALLOWED_PATH_ROOTS = [
    appBasePath,
    modelsBasePath,
    app.getPath('userData'),
    app.getPath('home'),
    app.getPath('documents'),
    app.getPath('desktop'),
    app.getPath('downloads'),
  ];

  const BLOCKED_PATH_PATTERNS = [
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

  function isPathAllowed(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return false;
    // LLMs sometimes output Windows paths as unescaped backslashes in JSON, causing
    // JSON.parse to interpret \b as backspace (ASCII 8), \t as tab, etc., corrupting
    // path segments. E.g. "C:\Users\brend\" becomes "C:\Users[BS]rend\".
    // Strip all control characters (U+0000–U+001F) — none are valid in file paths on
    // any OS, so this repair is always safe and introduces no security regression.
    const sanitized = targetPath.replace(/[\x00-\x1F]/g, '');
    const resolved = path.resolve(sanitized);
    for (const pattern of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(resolved)) return false;
    }
    const roots = [...ALLOWED_PATH_ROOTS];
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
