/**
 * Unit tests for pathValidator — blocking system dirs, allowing project paths.
 * We replicate the pure logic without Electron's `app` module.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';

// ─── Extracted from main/pathValidator.js (no Electron dependency) ───
function createPathValidator(
  appBasePath: string,
  modelsBasePath: string,
  allowedPaths: string[],
  getCurrentProjectPath: () => string | null
) {
  const ALLOWED_PATH_ROOTS = [appBasePath, modelsBasePath, ...allowedPaths];

  const BLOCKED_PATH_PATTERNS = [
    /[\\/]windows[\\/]system32/i,
    /[\\/]program files/i,
    /[\\/]programdata/i,
    /[\\/](etc|boot|sbin|proc|sys)[\\/]/i,
    /[\\/]\.ssh[\\/]/i,
    /[\\/]\.gnupg[\\/]/i,
  ];

  function isPathAllowed(targetPath: string | null | undefined): boolean {
    if (!targetPath || typeof targetPath !== 'string') return false;
    const resolved = path.resolve(targetPath);
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

// ─── Tests ───────────────────────────────────────────────────────────
describe('pathValidator (isPathAllowed)', () => {
  const appBase = 'C:\\Users\\test\\AppData\\Local\\guIDE';
  const modelsBase = 'C:\\Users\\test\\models';
  const userHome = 'C:\\Users\\test';
  const userDocs = 'C:\\Users\\test\\Documents';
  let isPathAllowed: ReturnType<typeof createPathValidator>;

  beforeEach(() => {
    isPathAllowed = createPathValidator(
      appBase,
      modelsBase,
      [userHome, userDocs],
      () => null
    );
  });

  describe('blocks system directories', () => {
    it('blocks Windows\\System32', () => {
      expect(isPathAllowed('C:\\Windows\\System32\\cmd.exe')).toBe(false);
    });

    it('blocks Program Files', () => {
      expect(isPathAllowed('C:\\Program Files\\SomeApp\\app.exe')).toBe(false);
    });

    it('blocks ProgramData', () => {
      expect(isPathAllowed('C:\\ProgramData\\secrets')).toBe(false);
    });

    it('blocks .ssh directory', () => {
      expect(isPathAllowed('C:\\Users\\test\\.ssh\\id_rsa')).toBe(false);
    });

    it('blocks .gnupg directory', () => {
      expect(isPathAllowed('C:\\Users\\test\\.gnupg\\private-keys')).toBe(false);
    });

    it('blocks Linux system paths', () => {
      expect(isPathAllowed('/etc/passwd')).toBe(false);
      expect(isPathAllowed('/boot/vmlinuz')).toBe(false);
      expect(isPathAllowed('/proc/cpuinfo')).toBe(false);
    });
  });

  describe('allows permitted directories', () => {
    it('allows app base path', () => {
      expect(isPathAllowed('C:\\Users\\test\\AppData\\Local\\guIDE\\config.json')).toBe(true);
    });

    it('allows models base path', () => {
      expect(isPathAllowed('C:\\Users\\test\\models\\llama.gguf')).toBe(true);
    });

    it('allows user home', () => {
      expect(isPathAllowed('C:\\Users\\test\\project\\file.js')).toBe(true);
    });

    it('allows documents folder', () => {
      expect(isPathAllowed('C:\\Users\\test\\Documents\\work\\readme.md')).toBe(true);
    });
  });

  describe('project path support', () => {
    it('allows files within project path', () => {
      const check = createPathValidator(appBase, modelsBase, [], () => 'D:\\Projects\\myapp');
      expect(check('D:\\Projects\\myapp\\src\\index.ts')).toBe(true);
    });

    it('blocks files outside all roots and project', () => {
      const check = createPathValidator(appBase, modelsBase, [], () => 'D:\\Projects\\myapp');
      expect(check('E:\\OtherDrive\\secret.txt')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for null', () => {
      expect(isPathAllowed(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isPathAllowed(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isPathAllowed('')).toBe(false);
    });

    it('blocked patterns win over allowed roots', () => {
      // .ssh is under user home (allowed) but blocked pattern takes priority
      expect(isPathAllowed('C:\\Users\\test\\.ssh\\known_hosts')).toBe(false);
    });
  });
});
