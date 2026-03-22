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
    .replace(/`([^`]+)`/g, '<code style="background:rgba(224,123,57,0.08);color:var(--theme-accent,#e07b39);border-radius:3px;padding:1px 4px;font-family:monospace;font-size:11px;white-space:nowrap">$1</code>')
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
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];
  const emitTable = () => {
    if (tableRows.length === 0) return;
    const isSeparator = (r: string) => /^\|[\s|\-:]+\|$/.test(r);
    const parseCells = (r: string) =>
      r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const dataRows = tableRows.filter(r => !isSeparator(r));
    if (dataRows.length === 0) { tableRows = []; inTable = false; return; }
    const headerCells = parseCells(dataRows[0])
      .map(c => `<th style="padding:5px 10px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.2);font-weight:600">${applyInlineMarkdown(c)}</th>`)
      .join('');
    const bodyRows = dataRows.slice(1).map((r, i) => {
      const cells = parseCells(r)
        .map(c => `<td style="padding:4px 10px;border-bottom:1px solid rgba(255,255,255,0.08)">${applyInlineMarkdown(c)}</td>`)
        .join('');
      const bg = i % 2 === 1 ? 'background:rgba(255,255,255,0.03);' : '';
      return `<tr style="${bg}">${cells}</tr>`;
    }).join('');
    output.push(
      `<table style="border-collapse:collapse;width:100%;margin:6px 0;font-size:0.9em">` +
      `<thead><tr style="background:rgba(255,255,255,0.06)">${headerCells}</tr></thead>` +
      `<tbody>${bodyRows}</tbody></table>`
    );
    tableRows = [];
    inTable = false;
  };

  for (let line of lines) {
    // Fenced code block handling — detect ``` openers/closers
    if (!inCodeBlock && /^\s*```/.test(line)) {
      // Opening fence — extract language tag
      if (inList) { output.push('</ul>'); inList = false; }
      inCodeBlock = true;
      codeBlockLang = line.replace(/^\s*```/, '').trim();
      codeBlockLines = [];
      continue;
    }
    if (inCodeBlock && /^\s*```\s*$/.test(line)) {
      // Closing fence — emit the code block as <pre><code>
      const escapedCode = codeBlockLines.join('\n')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const langAttr = codeBlockLang ? ` class="language-${codeBlockLang}"` : '';
      output.push(`<pre style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:10px 12px 16px;overflow-x:auto;margin:4px 0 12px 0"><code${langAttr} style="font-family:monospace;font-size:0.9em;white-space:pre">${escapedCode}</code></pre>`);
      inCodeBlock = false;
      codeBlockLang = '';
      codeBlockLines = [];
      continue;
    }
    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Escape raw HTML tags so model output doesn't render as actual DOM elements.
    // This runs BEFORE markdown processing, so markdown-generated HTML (from
    // applyInlineMarkdown) is unaffected. Only raw model-output HTML is escaped.
    line = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Pipe table rows — buffer the entire table then emit when the row sequence ends
    if (/^\|.*\|/.test(line.trim())) {
      if (!inTable) {
        if (inList) { output.push('</ul>'); inList = false; }
        inTable = true;
      }
      tableRows.push(line);
      continue;
    } else if (inTable) {
      emitTable();
    }

    // Horizontal rule (--- or *** or ___ on their own line)
    if (/^(?:[-*_]\s*){3,}$/.test(line.trim())) {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:8px 0" />');
    } else if (/^#{4} /.test(line)) {
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
  if (inTable) emitTable();

  // If we're still inside a code block (streaming — closing fence hasn't arrived yet),
  // render what we have so far as a partial code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    const escapedCode = codeBlockLines.join('\n')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const langAttr = codeBlockLang ? ` class="language-${codeBlockLang}"` : '';
    output.push(`<pre style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:10px 12px 16px;overflow-x:auto;margin:4px 0 12px 0"><code${langAttr} style="font-family:monospace;font-size:0.9em;white-space:pre">${escapedCode}</code></pre>`);
  }

  return sanitizeHTML(output.join('\n'));
}
