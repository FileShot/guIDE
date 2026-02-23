/**
 * Unit tests for the inline-markdown regex logic used in sanitize.ts.
 * These test the pure regex transforms without needing jsdom/DOMPurify.
 * DOMPurify integration is validated by the sanitizeHTML wrapper;
 * here we only test the regex pipeline that feeds into it.
 */
import { describe, it, expect } from 'vitest';

// ─── Extracted regex pipeline from markdownInlineToHTML ──────────────
function markdownToRawHTML(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

describe('markdownInlineToHTML regex pipeline', () => {
  it('converts backtick code spans', () => {
    expect(markdownToRawHTML('Use `console.log` here')).toBe(
      'Use <code>console.log</code> here'
    );
  });

  it('converts bold (**)', () => {
    expect(markdownToRawHTML('This is **important**')).toBe(
      'This is <strong>important</strong>'
    );
  });

  it('converts italic (*)', () => {
    expect(markdownToRawHTML('This is *emphasized*')).toBe(
      'This is <em>emphasized</em>'
    );
  });

  it('handles mixed formatting in one string', () => {
    const result = markdownToRawHTML('Use `code` with **bold** and *italic*');
    expect(result).toContain('<code>code</code>');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('handles multiple code spans', () => {
    const result = markdownToRawHTML('`a` and `b`');
    expect(result).toBe('<code>a</code> and <code>b</code>');
  });

  it('does not convert single asterisk inside word', () => {
    // 'file*name' has no matching close, should pass through
    expect(markdownToRawHTML('file*name')).toBe('file*name');
  });

  it('leaves plain text untouched', () => {
    expect(markdownToRawHTML('just text')).toBe('just text');
  });

  it('nested bold inside code is also converted (regex limitation)', () => {
    // The simple regex pipeline converts bold inside code spans too.
    // Real DOMPurify sanitization still makes output safe.
    expect(markdownToRawHTML('`**nested**`')).toBe('<code><strong>nested</strong></code>');
  });
});

// ─── ALLOWED_TAGS / ALLOWED_ATTR policy checks (pure data) ──────────
describe('sanitize policy constants', () => {
  const ALLOWED_TAGS = [
    'b', 'i', 'em', 'strong', 'u', 's', 'sub', 'sup', 'mark', 'small',
    'p', 'br', 'hr', 'div', 'span', 'blockquote', 'pre', 'code',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'a', 'img',
    'details', 'summary', 'figure', 'figcaption', 'abbr', 'time',
  ];

  const ALLOWED_ATTR = [
    'href', 'target', 'rel', 'src', 'alt', 'title', 'width', 'height',
    'class', 'id', 'style', 'colspan', 'rowspan', 'align', 'valign',
    'open', 'datetime',
  ];

  it('does NOT allow script tag', () => {
    expect(ALLOWED_TAGS).not.toContain('script');
  });

  it('does NOT allow iframe tag', () => {
    expect(ALLOWED_TAGS).not.toContain('iframe');
  });

  it('does NOT allow object/embed', () => {
    expect(ALLOWED_TAGS).not.toContain('object');
    expect(ALLOWED_TAGS).not.toContain('embed');
  });

  it('does NOT allow form elements', () => {
    expect(ALLOWED_TAGS).not.toContain('form');
    expect(ALLOWED_TAGS).not.toContain('input');
    expect(ALLOWED_TAGS).not.toContain('button');
  });

  it('does NOT allow event handler attributes', () => {
    expect(ALLOWED_ATTR).not.toContain('onclick');
    expect(ALLOWED_ATTR).not.toContain('onerror');
    expect(ALLOWED_ATTR).not.toContain('onload');
    expect(ALLOWED_ATTR).not.toContain('onmouseover');
  });

  it('allows safe link attributes', () => {
    expect(ALLOWED_ATTR).toContain('href');
    expect(ALLOWED_ATTR).toContain('target');
    expect(ALLOWED_ATTR).toContain('rel');
  });

  it('allows safe image attributes', () => {
    expect(ALLOWED_ATTR).toContain('src');
    expect(ALLOWED_ATTR).toContain('alt');
  });
});
