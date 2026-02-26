import DOMPurify from 'dompurify';

/**
 * Sanitize HTML for safe rendering with dangerouslySetInnerHTML.
 * Strips all scripts, event handlers, and dangerous elements.
 * Use this instead of raw dangerouslySetInnerHTML everywhere.
 */
export function sanitizeHTML(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      // Text formatting
      'b', 'i', 'em', 'strong', 'u', 's', 'sub', 'sup', 'mark', 'small',
      // Structure
      'p', 'br', 'hr', 'div', 'span', 'blockquote', 'pre', 'code',
      // Lists
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      // Headings
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      // Tables
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      // Links and media
      'a', 'img',
      // Misc
      'details', 'summary', 'figure', 'figcaption', 'abbr', 'time',
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel', 'src', 'alt', 'title', 'width', 'height',
      'class', 'id', 'style', 'colspan', 'rowspan', 'align', 'valign',
      'open', 'datetime',
    ],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Sanitize SVG content for safe inline rendering.
 * Allows SVG-specific tags but strips scripts and event handlers.
 */
export function sanitizeSVG(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use', 'clipPath', 'defs', 'symbol'],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Apply inline markdown transformations only (bold, italic, code).
 * Does NOT sanitize — call sanitizeHTML on the final result.
 */
function applyInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:1px 4px;font-family:monospace;font-size:0.9em;white-space:nowrap">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#3794ff;text-decoration:underline;text-decoration-color:rgba(55,148,255,0.4);cursor:pointer">$1</a>');
}

/**
 * Markdown to HTML — handles block-level (headings, lists) and inline (bold, italic, code).
 * Returns sanitized HTML safe for dangerouslySetInnerHTML.
 * Used by InlineMarkdownText during streaming and anywhere inline markdown is rendered.
 */
export function markdownInlineToHTML(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (/^#{4} /.test(line)) {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push(`<h4>${applyInlineMarkdown(line.slice(5))}</h4>`);
    } else if (/^#{3} /.test(line)) {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push(`<h3>${applyInlineMarkdown(line.slice(4))}</h3>`);
    } else if (/^#{2} /.test(line)) {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push(`<h2>${applyInlineMarkdown(line.slice(3))}</h2>`);
    } else if (/^# /.test(line)) {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push(`<h1>${applyInlineMarkdown(line.slice(2))}</h1>`);
    } else if (/^[-*] /.test(line)) {
      if (!inList) { output.push('<ul>'); inList = true; }
      output.push(`<li>${applyInlineMarkdown(line.slice(2))}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (!inList) { output.push('<ul>'); inList = true; }
      output.push(`<li>${applyInlineMarkdown(line.replace(/^\d+\. /, ''))}</li>`);
    } else {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push(applyInlineMarkdown(line));
    }
  }

  if (inList) output.push('</ul>');
  return sanitizeHTML(output.join('\n'));
}
