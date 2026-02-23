/**
 * Unit tests for src/utils/helpers.ts
 * Tests pure utility functions: formatting, path manipulation, file tree ops, etc.
 */
import { describe, it, expect, vi } from 'vitest';

// We import the helpers directly — they're pure functions, no Electron deps
import {
  getFileExtension,
  getLanguageFromExtension,
  formatFileSize,
  generateId,
  sortFiles,
  filterFiles,
  shouldIgnoreFile,
  buildFileTree,
  findFileInTree,
  updateFileInTree,
  removeFileFromTree,
  debounce,
  throttle,
  isValidPath,
  normalizePath,
  getRelativePath,
} from '../../src/utils/helpers';

// ─── getFileExtension ────────────────────────────────────────────────
describe('getFileExtension', () => {
  it('returns extension for normal files', () => {
    expect(getFileExtension('test.ts')).toBe('ts');
    expect(getFileExtension('index.html')).toBe('html');
    expect(getFileExtension('README.md')).toBe('md');
  });

  it('returns extension for dotfiles with extensions', () => {
    expect(getFileExtension('.env.local')).toBe('local');
    expect(getFileExtension('file.test.tsx')).toBe('tsx');
  });

  it('returns empty string for no extension', () => {
    expect(getFileExtension('Makefile')).toBe('');
    expect(getFileExtension('Dockerfile')).toBe('');
  });

  it('returns empty for trailing dot', () => {
    expect(getFileExtension('file.')).toBe('');
  });

  it('lowercases the extension', () => {
    expect(getFileExtension('Image.PNG')).toBe('png');
    expect(getFileExtension('script.JS')).toBe('js');
  });
});

// ─── getLanguageFromExtension ────────────────────────────────────────
describe('getLanguageFromExtension', () => {
  it('maps common extensions to languages', () => {
    expect(getLanguageFromExtension('app.tsx')).toBe('typescript');
    expect(getLanguageFromExtension('main.py')).toBe('python');
    expect(getLanguageFromExtension('styles.css')).toBe('css');
    expect(getLanguageFromExtension('index.html')).toBe('html');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(getLanguageFromExtension('data.xyz')).toBe('plaintext');
    expect(getLanguageFromExtension('file.unknown')).toBe('plaintext');
  });

  it('returns plaintext for no extension', () => {
    expect(getLanguageFromExtension('Makefile')).toBe('plaintext');
  });
});

// ─── formatFileSize ──────────────────────────────────────────────────
describe('formatFileSize', () => {
  it('formats 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('formats KB', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats MB', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
  });

  it('formats GB', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
  });
});

// ─── generateId ──────────────────────────────────────────────────────
describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(10);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

// ─── isValidPath ─────────────────────────────────────────────────────
describe('isValidPath', () => {
  it('rejects empty/null paths', () => {
    expect(isValidPath('')).toBe(false);
    expect(isValidPath(null as any)).toBe(false);
    expect(isValidPath(undefined as any)).toBe(false);
  });

  it('rejects Windows invalid characters', () => {
    expect(isValidPath('file<name>.txt')).toBe(false);
    expect(isValidPath('file|name.txt')).toBe(false);
    expect(isValidPath('file?name.txt')).toBe(false);
    expect(isValidPath('file*name.txt')).toBe(false);
  });

  it('rejects Windows reserved names', () => {
    expect(isValidPath('CON')).toBe(false);
    expect(isValidPath('PRN')).toBe(false);
    expect(isValidPath('COM1')).toBe(false);
    expect(isValidPath('LPT3')).toBe(false);
    expect(isValidPath('NUL')).toBe(false);
    expect(isValidPath('CON.txt')).toBe(false);
  });

  it('accepts valid paths', () => {
    expect(isValidPath('src/main.ts')).toBe(true);
    expect(isValidPath('my-file.txt')).toBe(true);
    expect(isValidPath('/home/user/project')).toBe(true);
  });
});

// ─── normalizePath ───────────────────────────────────────────────────
describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\brend\\IDE')).toBe('C:/Users/brend/IDE');
  });

  it('collapses multiple slashes', () => {
    expect(normalizePath('src///utils//helpers.ts')).toBe('src/utils/helpers.ts');
  });

  it('handles mixed slashes', () => {
    expect(normalizePath('src\\utils//helpers.ts')).toBe('src/utils/helpers.ts');
  });
});

// ─── getRelativePath ─────────────────────────────────────────────────
describe('getRelativePath', () => {
  it('computes relative path between sibling files', () => {
    expect(getRelativePath('src/a/file.ts', 'src/b/other.ts')).toBe('../b/other.ts');
  });

  it('computes relative path to child', () => {
    expect(getRelativePath('src/index.ts', 'src/utils/helpers.ts')).toBe('utils/helpers.ts');
  });

  it('returns . for same directory', () => {
    expect(getRelativePath('src/a.ts', 'src/b.ts')).toBe('b.ts');
  });
});

// ─── sortFiles ───────────────────────────────────────────────────────
describe('sortFiles', () => {
  const files = [
    { id: '1', name: 'beta.ts', path: '/beta.ts', type: 'file' as const, size: 200 },
    { id: '2', name: 'alpha.ts', path: '/alpha.ts', type: 'file' as const, size: 100 },
    { id: '3', name: 'src', path: '/src', type: 'directory' as const },
    { id: '4', name: '.hidden', path: '/.hidden', type: 'file' as const, isHidden: true },
  ];

  it('sorts by name ascending with folders first', () => {
    const sorted = sortFiles(files, { sortBy: 'name', sortOrder: 'asc', foldersFirst: true, showHidden: true });
    expect(sorted[0].name).toBe('src');
    expect(sorted[1].name).toBe('.hidden');
    expect(sorted[2].name).toBe('alpha.ts');
  });

  it('hides hidden files when showHidden=false', () => {
    const sorted = sortFiles(files, { sortBy: 'name', sortOrder: 'asc', foldersFirst: false, showHidden: false });
    expect(sorted.find(f => f.name === '.hidden')).toBeUndefined();
  });

  it('sorts by size', () => {
    const sorted = sortFiles(files, { sortBy: 'size', sortOrder: 'asc', foldersFirst: false, showHidden: true });
    const withSize = sorted.filter(f => f.size);
    expect(withSize[0].size).toBeLessThanOrEqual(withSize[1].size!);
  });
});

// ─── findFileInTree / updateFileInTree / removeFileFromTree ──────────
describe('file tree operations', () => {
  const tree = [
    {
      id: '1', name: 'src', path: '/src', type: 'directory' as const,
      children: [
        { id: '2', name: 'main.ts', path: '/src/main.ts', type: 'file' as const },
        { id: '3', name: 'app.tsx', path: '/src/app.tsx', type: 'file' as const },
      ],
    },
    { id: '4', name: 'README.md', path: '/README.md', type: 'file' as const },
  ];

  it('findFileInTree finds nested files', () => {
    expect(findFileInTree(tree, '/src/main.ts')?.name).toBe('main.ts');
    expect(findFileInTree(tree, '/README.md')?.name).toBe('README.md');
    expect(findFileInTree(tree, '/nonexistent')).toBeNull();
  });

  it('updateFileInTree updates immutably', () => {
    const updated = updateFileInTree(tree, '/src/main.ts', { name: 'index.ts' });
    expect(findFileInTree(updated, '/src/main.ts')?.name).toBe('index.ts');
    // Original unchanged
    expect(findFileInTree(tree, '/src/main.ts')?.name).toBe('main.ts');
  });

  it('removeFileFromTree removes nested files', () => {
    const updated = removeFileFromTree(tree, '/src/app.tsx');
    expect(findFileInTree(updated, '/src/app.tsx')).toBeNull();
    expect(findFileInTree(updated, '/src/main.ts')).not.toBeNull();
  });
});

// ─── debounce ────────────────────────────────────────────────────────
describe('debounce', () => {
  it('delays execution', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// ─── throttle ────────────────────────────────────────────────────────
describe('throttle', () => {
  it('calls immediately then throttles', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);

    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

// ─── shouldIgnoreFile ────────────────────────────────────────────────
describe('shouldIgnoreFile', () => {
  it('ignores node_modules', () => {
    expect(shouldIgnoreFile('/project', 'node_modules')).toBe(true);
  });

  it('ignores .git', () => {
    expect(shouldIgnoreFile('/project', '.git')).toBe(true);
  });

  it('allows normal directories', () => {
    expect(shouldIgnoreFile('/project', 'src')).toBe(false);
    expect(shouldIgnoreFile('/project', 'components')).toBe(false);
  });
});
