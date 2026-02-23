/**
 * guIDE — AI-Powered Offline IDE
 * Smart Search & Navigation Handlers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Simple symbol extractors (regex-based, no Tree-sitter dependency)
const SYMBOL_PATTERNS = {
  // JavaScript / TypeScript
  js: [
    { type: 'function', pattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g },
    { type: 'class', pattern: /(?:export\s+)?class\s+(\w+)/g },
    { type: 'const', pattern: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/g },
    { type: 'method', pattern: /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm },
    { type: 'interface', pattern: /(?:export\s+)?interface\s+(\w+)/g },
    { type: 'type', pattern: /(?:export\s+)?type\s+(\w+)\s*=/g },
    { type: 'enum', pattern: /(?:export\s+)?enum\s+(\w+)/g },
    { type: 'arrow', pattern: /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g },
  ],
  // Python
  py: [
    { type: 'function', pattern: /^(?:async\s+)?def\s+(\w+)/gm },
    { type: 'class', pattern: /^class\s+(\w+)/gm },
    { type: 'variable', pattern: /^(\w+)\s*=/gm },
  ],
  // Java / C# / C++
  java: [
    { type: 'class', pattern: /(?:public|private|protected)?\s*(?:static\s+)?class\s+(\w+)/g },
    { type: 'method', pattern: /(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/g },
    { type: 'interface', pattern: /(?:public\s+)?interface\s+(\w+)/g },
  ],
  // Rust
  rs: [
    { type: 'function', pattern: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g },
    { type: 'struct', pattern: /(?:pub\s+)?struct\s+(\w+)/g },
    { type: 'enum', pattern: /(?:pub\s+)?enum\s+(\w+)/g },
    { type: 'trait', pattern: /(?:pub\s+)?trait\s+(\w+)/g },
    { type: 'impl', pattern: /impl(?:<[^>]*>)?\s+(\w+)/g },
  ],
  // Go
  go: [
    { type: 'function', pattern: /func\s+(?:\([^)]*\)\s+)?(\w+)/g },
    { type: 'struct', pattern: /type\s+(\w+)\s+struct/g },
    { type: 'interface', pattern: /type\s+(\w+)\s+interface/g },
  ],
};

// Map file extensions to language keys
const EXT_MAP = {
  '.js': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.py': 'py', '.pyw': 'py',
  '.java': 'java', '.cs': 'java', '.cpp': 'java', '.c': 'java', '.h': 'java', '.hpp': 'java',
  '.rs': 'rs',
  '.go': 'go',
};

// File extensions to include in searches
const SEARCHABLE_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyw', '.rb', '.php',
  '.java', '.kt', '.scala', '.cs',
  '.c', '.cpp', '.h', '.hpp', '.cc',
  '.rs', '.go', '.swift',
  '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.md', '.txt', '.sh', '.bat', '.ps1',
  '.sql', '.graphql',
]);

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '__pycache__',
  '.venv', 'venv', 'env', '.tox', '.mypy_cache', 'coverage',
  '.cache', '.parcel-cache', '.turbo', 'target', 'bin', 'obj',
]);

function collectFiles(rootPath, maxFiles = 2000) {
  const files = [];
  function walk(dir, depth) {
    if (depth > 12 || files.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SEARCHABLE_EXTS.has(ext)) {
          files.push(path.join(dir, entry.name));
        }
      }
    }
  }
  walk(rootPath, 0);
  return files;
}

function extractSymbols(content, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const lang = EXT_MAP[ext];
  if (!lang || !SYMBOL_PATTERNS[lang]) return [];

  const lines = content.split('\n');
  const symbols = [];
  const seen = new Set();

  for (const { type, pattern } of SYMBOL_PATTERNS[lang]) {
    // Reset regex
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (!name || name.length < 2 || seen.has(`${type}:${name}`)) continue;
      seen.add(`${type}:${name}`);

      // Find line number
      const pos = match.index;
      let lineNum = 1;
      for (let i = 0; i < pos && i < content.length; i++) {
        if (content[i] === '\n') lineNum++;
      }

      symbols.push({
        name,
        type,
        line: lineNum,
        filePath,
        context: (lines[lineNum - 1] || '').trim().slice(0, 120),
      });
    }
  }

  return symbols;
}

function register(ctx) {

  // ── Get symbol outline for a file ──
  ipcMain.handle('smart-search-symbols', async (_, params) => {
    try {
      const { filePath } = params;
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) return { success: false, error: 'File not found' };

      const content = fs.readFileSync(absPath, 'utf-8');
      const symbols = extractSymbols(content, absPath);

      return { success: true, symbols, filePath: absPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Find references to a symbol across the project ──
  ipcMain.handle('smart-search-references', async (_, params) => {
    try {
      const { symbol, rootPath: root } = params;
      const projectRoot = root || ctx.currentProjectPath;
      if (!projectRoot) return { success: false, error: 'No project open' };
      if (!symbol || symbol.length < 2) return { success: false, error: 'Symbol too short' };

      const files = collectFiles(projectRoot, 1500);
      const references = [];
      const maxRefs = 200;

      // Escape for regex
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'g');

      for (const filePath of files) {
        if (references.length >= maxRefs) break;
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (!content.includes(symbol)) continue;
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (references.length >= maxRefs) break;
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              references.push({
                filePath,
                line: i + 1,
                column: lines[i].indexOf(symbol) + 1,
                context: lines[i].trim().slice(0, 200),
                relativePath: path.relative(projectRoot, filePath),
              });
            }
          }
        } catch { /* skip unreadable files */ }
      }

      return { success: true, symbol, references, totalFiles: files.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Go to definition (find where a symbol is defined) ──
  ipcMain.handle('smart-search-definition', async (_, params) => {
    try {
      const { symbol, rootPath: root } = params;
      const projectRoot = root || ctx.currentProjectPath;
      if (!projectRoot) return { success: false, error: 'No project open' };

      const files = collectFiles(projectRoot, 1500);
      const definitions = [];

      // Patterns that indicate a definition
      const defPatterns = [
        new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
        new RegExp(`(?:export\\s+)?class\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
        new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`),
        new RegExp(`(?:export\\s+)?interface\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
        new RegExp(`(?:export\\s+)?type\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`),
        new RegExp(`(?:export\\s+)?enum\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
        new RegExp(`^(?:async\\s+)?def\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm'),
        new RegExp(`^class\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm'),
        new RegExp(`(?:pub\\s+)?(?:async\\s+)?fn\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
        new RegExp(`func\\s+(?:\\([^)]*\\)\\s+)?${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
      ];

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (!content.includes(symbol)) continue;
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            for (const pat of defPatterns) {
              pat.lastIndex = 0;
              if (pat.test(lines[i])) {
                definitions.push({
                  filePath,
                  line: i + 1,
                  context: lines[i].trim().slice(0, 200),
                  relativePath: path.relative(projectRoot, filePath),
                });
                break; // one match per line
              }
            }
          }
        } catch { /* skip */ }
      }

      return { success: true, symbol, definitions };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Semantic search (AI-powered code search) ──
  ipcMain.handle('smart-search-semantic', async (_, params) => {
    try {
      const { query, rootPath: root, cloudProvider, cloudModel, maxResults = 10 } = params;
      const projectRoot = root || ctx.currentProjectPath;
      if (!projectRoot) return { success: false, error: 'No project open' };

      // First, try RAG if available
      if (ctx.ragEngine) {
        try {
          const ragResults = await ctx.ragEngine.search(query, maxResults);
          if (ragResults && ragResults.length > 0) {
            return {
              success: true,
              results: ragResults.map(r => ({
                filePath: r.path || r.filePath,
                line: r.startLine || r.line || 1,
                score: r.score || 0,
                snippet: (r.content || r.text || '').slice(0, 300),
                relativePath: path.relative(projectRoot, r.path || r.filePath || ''),
              })),
              source: 'rag',
            };
          }
        } catch { /* fall through */ }
      }

      // Fallback: use LLM to identify relevant files/functions
      const files = collectFiles(projectRoot, 500);
      const fileList = files.map(f => path.relative(projectRoot, f)).join('\n');

      const prompt = `You are a code navigation assistant. Given this search query and list of project files, identify the most relevant files and what to look for.

Query: "${query}"

Project files:
${fileList.slice(0, 5000)}

Return a JSON array of up to ${maxResults} results, each with:
- "file": relative file path
- "reason": why this file is relevant (max 100 chars)
- "searchTerms": array of function/variable names to look for in this file

Return ONLY the JSON array. No markdown.`;

      let aiText = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const result = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 2000 });
          aiText = result.text || '';
        } catch { /* fall through */ }
      }
      if (!aiText && ctx.llmEngine) {
        try {
          const result = await ctx.llmEngine.generate(prompt, { maxTokens: 2000 });
          aiText = result.text || '';
        } catch { /* fall through */ }
      }
      if (!aiText && ctx.cloudLLM) {
        try {
          const result = await ctx.cloudLLM.generate(prompt, { maxTokens: 2000 });
          aiText = result.text || '';
        } catch { /* ignore */ }
      }

      if (!aiText) return { success: false, error: 'No LLM available for semantic search' };

      let suggestions = [];
      try {
        const jsonMatch = aiText.match(/\[[\s\S]*\]/);
        if (jsonMatch) suggestions = JSON.parse(jsonMatch[0]);
      } catch {
        return { success: true, results: [], rawResponse: aiText, source: 'ai-fallback' };
      }

      // Resolve to actual line numbers
      const results = [];
      for (const s of suggestions.slice(0, maxResults)) {
        const absPath = path.join(projectRoot, s.file);
        if (!fs.existsSync(absPath)) continue;
        try {
          const content = fs.readFileSync(absPath, 'utf-8');
          let bestLine = 1;
          let bestSnippet = content.split('\n')[0] || '';
          if (s.searchTerms && s.searchTerms.length > 0) {
            const lines = content.split('\n');
            for (const term of s.searchTerms) {
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(term)) {
                  bestLine = i + 1;
                  bestSnippet = lines[i].trim().slice(0, 200);
                  break;
                }
              }
              if (bestLine > 1) break;
            }
          }
          results.push({
            filePath: absPath,
            line: bestLine,
            snippet: bestSnippet,
            reason: s.reason || '',
            relativePath: s.file,
          });
        } catch { /* skip */ }
      }

      return { success: true, results, source: 'ai' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Find similar code patterns ──
  ipcMain.handle('smart-search-similar', async (_, params) => {
    try {
      const { code, rootPath: root, cloudProvider, cloudModel } = params;
      const projectRoot = root || ctx.currentProjectPath;
      if (!projectRoot) return { success: false, error: 'No project open' };
      if (!code || code.length < 10) return { success: false, error: 'Code snippet too short' };

      const files = collectFiles(projectRoot, 1000);

      // Extract key identifiers from the code snippet
      const identifiers = [...new Set(
        (code.match(/\b[a-zA-Z_]\w{2,}\b/g) || [])
          .filter(w => !['const', 'let', 'var', 'function', 'class', 'return', 'import', 'export', 'from', 'if', 'else', 'for', 'while', 'try', 'catch', 'async', 'await', 'new', 'this', 'true', 'false', 'null', 'undefined', 'void', 'typeof', 'instanceof'].includes(w))
      )];

      if (identifiers.length === 0) return { success: true, similar: [] };

      const similar = [];
      for (const filePath of files) {
        if (similar.length >= 50) break;
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          // Count how many identifiers appear in this file
          let matchCount = 0;
          for (const id of identifiers) {
            if (content.includes(id)) matchCount++;
          }
          const score = matchCount / identifiers.length;
          if (score > 0.3) {
            // Find the best matching line region
            const lines = content.split('\n');
            let bestLine = 0;
            let bestScore = 0;
            for (let i = 0; i < lines.length; i++) {
              let lineScore = 0;
              for (const id of identifiers) {
                if (lines[i].includes(id)) lineScore++;
              }
              if (lineScore > bestScore) {
                bestScore = lineScore;
                bestLine = i;
              }
            }

            similar.push({
              filePath,
              line: bestLine + 1,
              score: Math.round(score * 100),
              matchedIdentifiers: matchCount,
              totalIdentifiers: identifiers.length,
              context: lines.slice(Math.max(0, bestLine - 1), bestLine + 3).join('\n').slice(0, 300),
              relativePath: path.relative(projectRoot, filePath),
            });
          }
        } catch { /* skip */ }
      }

      similar.sort((a, b) => b.score - a.score);
      return { success: true, similar: similar.slice(0, 20), identifiers };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Get breadcrumb path for a position in a file ──
  ipcMain.handle('smart-search-breadcrumb', async (_, params) => {
    try {
      const { filePath, line } = params;
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) return { success: false, error: 'File not found' };

      const content = fs.readFileSync(absPath, 'utf-8');
      const symbols = extractSymbols(content, absPath);
      const fileName = path.basename(absPath);

      // Build breadcrumb: find enclosing symbols for the target line
      const breadcrumb = [fileName];
      const enclosing = symbols
        .filter(s => s.line <= line)
        .sort((a, b) => b.line - a.line);

      // Find class/module first, then method/function
      const classSymbol = enclosing.find(s => ['class', 'struct', 'interface', 'trait', 'impl'].includes(s.type));
      if (classSymbol) breadcrumb.push(classSymbol.name);

      const funcSymbol = enclosing.find(s =>
        ['function', 'method', 'arrow'].includes(s.type) &&
        (!classSymbol || s.line > classSymbol.line)
      );
      if (funcSymbol) breadcrumb.push(funcSymbol.name);

      return { success: true, breadcrumb, enclosingSymbols: enclosing.slice(0, 5) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Search across all project symbols ──
  ipcMain.handle('smart-search-project-symbols', async (_, params) => {
    try {
      const { query, rootPath: root, filter } = params;
      const projectRoot = root || ctx.currentProjectPath;
      if (!projectRoot) return { success: false, error: 'No project open' };

      const files = collectFiles(projectRoot, 1000);
      let allSymbols = [];

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const symbols = extractSymbols(content, filePath);
          allSymbols.push(...symbols.map(s => ({
            ...s,
            relativePath: path.relative(projectRoot, filePath),
          })));
        } catch { /* skip */ }
      }

      // Filter by type if specified
      if (filter) {
        allSymbols = allSymbols.filter(s => s.type === filter);
      }

      // Filter by query
      if (query) {
        const q = query.toLowerCase();
        allSymbols = allSymbols.filter(s =>
          s.name.toLowerCase().includes(q) ||
          s.context.toLowerCase().includes(q)
        );
      }

      // Sort: exact prefix matches first, then by name
      allSymbols.sort((a, b) => {
        const q = (query || '').toLowerCase();
        const aStart = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStart = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return a.name.localeCompare(b.name);
      });

      return { success: true, symbols: allSymbols.slice(0, 200), totalFound: allSymbols.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
