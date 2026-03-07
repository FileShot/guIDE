// Fix 4 v2: MCP partial recovery — trim trailing JSON closing chars from END of rawTail
// (Fix 4 v1 scanned from front, which incorrectly clipped at internal unescaped HTML quotes.)
const fs = require('fs');

const files = [
  'c:\\Users\\brend\\IDE\\pipeline-clone\\main\\tools\\mcpToolParser.js',
  'c:\\Users\\brend\\IDE\\main\\tools\\mcpToolParser.js',
];

for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');

  // Find the v1 comment we inserted
  let v1Start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('// Find where the JSON string actually ends (first unescaped double-quote).')) {
      v1Start = i;
      break;
    }
  }

  if (v1Start === -1) { console.log('v1 marker not found in:', f); continue; }

  // Find the rawTail.substring(0, contentEnd) line that v1 introduced
  let v1End = -1;
  for (let i = v1Start; i < Math.min(v1Start + 15, lines.length); i++) {
    if (lines[i].includes('rawTail.substring(0, contentEnd)')) {
      v1End = i;
      break;
    }
  }

  if (v1End === -1) { console.log('v1 end not found in:', f); continue; }

  console.log(`${f}: replacing lines ${v1Start+1}-${v1End+1}`);

  const ind = '              ';

  // Replace the entire v1 block (v1Start through v1End inclusive) with the new tail-strip approach
  const replacement = [
    ind + '// Only strip trailing JSON closing chars from the END of rawTail.',
    ind + '// Scanning from the front (v1) was wrong: it clipped at the first unescaped',
    ind + '// quote inside HTML content (e.g., lang="en"), making recoveredContent < 100 chars.',
    ind + '// Tail-strip is safe: HTML content never ends with `"}` — only JSON structure does.',
    ind + 'const trailingClose = rawTail.match(/\\s*"\\s*\\}[\\s\\}]*$/);',
    ind + 'const contentEnd = trailingClose ? rawTail.length - trailingClose[0].length : rawTail.length;',
    ind + '// Unescape JSON string escape sequences in the partial (truncated) content value',
    ind + 'recoveredContent = rawTail.substring(0, contentEnd)',
  ];

  lines.splice(v1Start, v1End - v1Start + 1, ...replacement);

  fs.writeFileSync(f, lines.join('\n'), 'utf8');
  console.log('Patched v2:', f);
}
