import { describe, it, expect } from 'vitest';
import {
  getFileExtension,
  isImageFile, isBinaryFile, isHtmlFile, isMarkdownFile, isSvgFile,
  isJsonFile, isCsvFile, isXmlFile, isYamlFile, isTomlFile,
  isPreviewableFile, isDataPreviewable, getPreviewLabel,
  isRunnableFile, getRunCommand,
  RUN_COMMANDS,
} from '../../src/components/Editor/fileUtils';

// ── getFileExtension ────────────────────────────────────────────────
describe('getFileExtension', () => {
  it('returns extension with leading dot', () => {
    expect(getFileExtension('file.py')).toBe('.py');
    expect(getFileExtension('/home/user/app.tsx')).toBe('.tsx');
  });
  it('returns lowercase extension', () => {
    expect(getFileExtension('README.MD')).toBe('.md');
  });
  it('returns empty string when no extension', () => {
    expect(getFileExtension('Makefile')).toBe('');
    expect(getFileExtension('Dockerfile')).toBe('');
  });
  it('handles dotfiles', () => {
    expect(getFileExtension('.gitignore')).toBe('.gitignore');
  });
  it('handles backslash paths', () => {
    expect(getFileExtension('C:\\Users\\code\\index.js')).toBe('.js');
  });
});

// ── Type checks ─────────────────────────────────────────────────────
describe('file type checks', () => {
  it('isImageFile recognises image extensions', () => {
    expect(isImageFile('photo.png')).toBe(true);
    expect(isImageFile('icon.svg')).toBe(true);
    expect(isImageFile('app.js')).toBe(false);
  });

  it('isBinaryFile includes images and binaries', () => {
    expect(isBinaryFile('app.exe')).toBe(true);
    expect(isBinaryFile('photo.jpg')).toBe(true);
    expect(isBinaryFile('readme.md')).toBe(false);
  });

  it('isHtmlFile', () => {
    expect(isHtmlFile('index.html')).toBe(true);
    expect(isHtmlFile('page.htm')).toBe(true);
    expect(isHtmlFile('style.css')).toBe(false);
  });

  it('isMarkdownFile', () => {
    expect(isMarkdownFile('README.md')).toBe(true);
    expect(isMarkdownFile('docs.mdx')).toBe(true);
    expect(isMarkdownFile('notes.txt')).toBe(false);
  });

  it('isSvgFile', () => {
    expect(isSvgFile('logo.svg')).toBe(true);
    expect(isSvgFile('logo.png')).toBe(false);
  });

  it('isJsonFile', () => {
    expect(isJsonFile('package.json')).toBe(true);
    expect(isJsonFile('config.jsonc')).toBe(true);
    expect(isJsonFile('data.csv')).toBe(false);
  });

  it('isCsvFile', () => {
    expect(isCsvFile('data.csv')).toBe(true);
    expect(isCsvFile('data.tsv')).toBe(true);
  });

  it('isXmlFile', () => {
    expect(isXmlFile('feed.xml')).toBe(true);
    expect(isXmlFile('feed.rss')).toBe(true);
  });

  it('isYamlFile', () => {
    expect(isYamlFile('config.yaml')).toBe(true);
    expect(isYamlFile('ci.yml')).toBe(true);
  });

  it('isTomlFile', () => {
    expect(isTomlFile('Cargo.toml')).toBe(true);
    expect(isTomlFile('config.ini')).toBe(false);
  });
});

// ── Previewable ─────────────────────────────────────────────────────
describe('previewable helpers', () => {
  it('isDataPreviewable includes json, csv, xml, yaml, toml', () => {
    expect(isDataPreviewable('d.json')).toBe(true);
    expect(isDataPreviewable('d.csv')).toBe(true);
    expect(isDataPreviewable('d.xml')).toBe(true);
    expect(isDataPreviewable('d.yaml')).toBe(true);
    expect(isDataPreviewable('d.toml')).toBe(true);
    expect(isDataPreviewable('d.py')).toBe(false);
  });

  it('isPreviewableFile includes html, md, svg, and data types', () => {
    expect(isPreviewableFile('page.html')).toBe(true);
    expect(isPreviewableFile('readme.md')).toBe(true);
    expect(isPreviewableFile('icon.svg')).toBe(true);
    expect(isPreviewableFile('data.json')).toBe(true);
    expect(isPreviewableFile('app.py')).toBe(false);
  });

  it('getPreviewLabel returns correct labels', () => {
    expect(getPreviewLabel('page.html')).toBe('Preview HTML');
    expect(getPreviewLabel('readme.md')).toBe('Preview Markdown');
    expect(getPreviewLabel('icon.svg')).toBe('Preview SVG');
    expect(getPreviewLabel('data.json')).toBe('Preview JSON');
    expect(getPreviewLabel('data.csv')).toBe('Preview Table');
    expect(getPreviewLabel('feed.xml')).toBe('Preview XML');
    expect(getPreviewLabel('config.yaml')).toBe('Preview YAML');
    expect(getPreviewLabel('Cargo.toml')).toBe('Preview TOML');
    expect(getPreviewLabel('unknown.zig')).toBe('Preview');
  });
});

// ── Run commands ────────────────────────────────────────────────────
describe('run commands', () => {
  it('isRunnableFile returns true for known extensions', () => {
    expect(isRunnableFile('app.py')).toBe(true);
    expect(isRunnableFile('index.js')).toBe(true);
    expect(isRunnableFile('main.go')).toBe(true);
    expect(isRunnableFile('page.html')).toBe(true); // html special case
  });

  it('isRunnableFile returns true for Makefile/Dockerfile', () => {
    expect(isRunnableFile('Makefile')).toBe(true);
    expect(isRunnableFile('Dockerfile')).toBe(true);
  });

  it('isRunnableFile returns false for non-runnable', () => {
    expect(isRunnableFile('style.css')).toBe(false);
    expect(isRunnableFile('readme.md')).toBe(false);
  });

  it('getRunCommand returns correct commands for common languages', () => {
    expect(getRunCommand('app.py')).toBe('python "app.py"');
    expect(getRunCommand('index.js')).toBe('node "index.js"');
    expect(getRunCommand('main.go')).toBe('go run "main.go"');
    expect(getRunCommand('script.rb')).toBe('ruby "script.rb"');
    expect(getRunCommand('app.ts')).toBe('npx tsx "app.ts"');
  });

  it('getRunCommand returns null for unknown extensions', () => {
    expect(getRunCommand('style.css')).toBeNull();
    expect(getRunCommand('readme.md')).toBeNull();
  });

  it('RUN_COMMANDS covers 40+ extensions', () => {
    expect(Object.keys(RUN_COMMANDS).length).toBeGreaterThanOrEqual(40);
  });
});
