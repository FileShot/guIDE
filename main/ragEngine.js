/**
 * guIDE — RAG Engine
 *
 * BM25-based code search over the project tree. Files are split into
 * 500-line chunks with 50-line overlap. Metadata is always in memory;
 * chunk content uses an LRU cache (5 000 entries) and reloads from disk
 * on miss. Supports full reindex, incremental reindex, file-name search,
 * error-context search, and relevance-filtered context retrieval.
 */
'use strict';

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const log = require('./logger');

/* ── Constants ───────────────────────────────────────────────────── */

const BM25_K1 = 1.5;
const BM25_B  = 0.75;
const CHUNK_SIZE    = 500;
const CHUNK_OVERLAP = 50;
const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
const MAX_CACHED    = 5000;

const IGNORE_RE = [
  /node_modules/, /\.git\//, /dist\//, /build\//, /\.next\//, /\.cache/,
  /\.DS_Store/, /\.env$/, /\.gguf$/, /\.exe$/, /\.dll$/, /\.so$/, /\.dylib$/,
  /\.bin$/, /\.png$/, /\.jpe?g$/, /\.gif$/, /\.ico$/, /\.svg$/, /\.woff/,
  /\.ttf$/, /\.eot$/, /\.mp[34]$/, /\.avi$/, /\.zip$/, /\.tar$/, /\.gz$/,
  /\.rar$/, /\.7z$/, /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/,
  /\.guide-memory/, /\.ide-memory/,
];

/* ── RAGEngine ───────────────────────────────────────────────────── */

class RAGEngine {
  constructor() {
    this.index       = new Map(); // term → Map<docId, {tf, positions}>
    this.documents   = new Map(); // docId → {path, relativePath, startLine, endLine, lineCount}
    this.docLengths  = new Map(); // docId → number
    this.fileIndex   = new Map(); // filePath → [docId, ...]
    this.fileMtimes  = new Map(); // filePath → mtimeMs
    this._cache      = new Map(); // docId → content (LRU)
    this._cacheSize  = 0;
    this.avgDocLength = 0;
    this.totalDocs   = 0;
    this.projectPath = null;
    this.isIndexing  = false;
    this.indexProgress = 0;
  }

  /* ── Full index ────────────────────────────────────────────────── */

  async indexProject(projectPath, onProgress) {
    if (this.isIndexing) {
      log.info('RAG', 'Already indexing — skipping');
      return { indexed: 0, skipped: 0, duration: 0 };
    }
    this.isIndexing = true;
    this.indexProgress = 0;
    this.projectPath = projectPath;
    this._clear();

    try {
      const files = await this._collectFiles(projectPath);
      const t0 = Date.now();
      let done = 0;

      for (let i = 0; i < files.length; i += 20) {
        const batch = files.slice(i, i + 20);
        await Promise.all(batch.map(f => this._indexFile(f).catch(() => {})));
        done += batch.length;
        this.indexProgress = Math.round((done / files.length) * 100);
        onProgress?.(this.indexProgress, done, files.length);
      }

      this._recalcStats();
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      log.info('RAG', `Indexed ${files.length} files (${this.totalDocs} chunks) in ${secs}s`);
      return { totalFiles: files.length, totalChunks: this.totalDocs, totalTerms: this.index.size };
    } finally {
      this.isIndexing = false;
    }
  }

  /* ── Incremental reindex ───────────────────────────────────────── */

  async reindexChanged(onProgress) {
    if (this.isIndexing || !this.projectPath) return { updated: 0, added: 0, removed: 0 };
    this.isIndexing = true;
    try {
      const files = await this._collectFiles(this.projectPath);
      const current = new Set(files);
      let updated = 0, added = 0, removed = 0, done = 0;

      for (const [fp] of this.fileIndex) {
        if (!current.has(fp)) { this._removeFile(fp); removed++; }
      }

      for (let i = 0; i < files.length; i += 20) {
        const batch = files.slice(i, i + 20);
        await Promise.all(batch.map(async fp => {
          try {
            const st = await fs.stat(fp);
            const prev = this.fileMtimes.get(fp);
            if (prev === undefined) { await this._indexFile(fp); added++; }
            else if (st.mtimeMs > prev) { this._removeFile(fp); await this._indexFile(fp); updated++; }
          } catch {}
        }));
        done += batch.length;
        onProgress?.(Math.round((done / files.length) * 100), done, files.length);
      }

      this._recalcStats();
      log.info('RAG', `Incremental: ${updated} updated, ${added} added, ${removed} removed`);
      return { updated, added, removed };
    } finally {
      this.isIndexing = false;
    }
  }

  /* ── BM25 search ───────────────────────────────────────────────── */

  search(query, maxResults = 10) {
    if (!this.totalDocs) return [];
    const terms = _tokenize(query);
    const scores = new Map();

    for (const term of terms) {
      const postings = this.index.get(term);
      if (!postings) continue;
      const idf = Math.log((this.totalDocs - postings.size + 0.5) / (postings.size + 0.5) + 1);
      for (const [docId, { tf }] of postings) {
        const dl = this.docLengths.get(docId) || 0;
        const score = idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / this.avgDocLength))));
        scores.set(docId, (scores.get(docId) || 0) + score);
      }
    }

    // Apply temporal recency boost — recently modified files score higher
    const now = Date.now();
    for (const [docId, score] of scores) {
      const doc = this.documents.get(docId);
      if (doc) {
        const mtime = this.fileMtimes.get(doc.path) || 0;
        const ageHours = (now - mtime) / 3600000;
        const recencyBoost = 1 + 0.3 * Math.exp(-ageHours / 24);
        scores.set(docId, score * recencyBoost);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults)
      .map(([id, score]) => {
        const doc = this.documents.get(id);
        return { docId: id, score, path: doc.path, relativePath: doc.relativePath,
                 content: this._getContent(id, doc), startLine: doc.startLine,
                 endLine: doc.endLine, lineCount: doc.lineCount };
      });
  }

  searchFiles(query, maxResults = 20) {
    const q = query.toLowerCase();
    const results = [];
    for (const [fp] of this.fileIndex) {
      const rel = path.relative(this.projectPath, fp).toLowerCase();
      const name = path.basename(fp).toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.startsWith(q)) score = 80;
      else if (name.includes(q)) score = 60;
      else if (rel.includes(q)) score = 40;
      if (score) results.push({ path: fp, relativePath: path.relative(this.projectPath, fp), score, fileName: path.basename(fp) });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  /* ── Context retrieval ─────────────────────────────────────────── */

  getContextForQuery(query, maxChunks = 5, maxTokens = 3000) {
    const results = this.search(query, maxChunks * 3);
    const topScore = results[0]?.score || 0;
    const threshold = Math.max(1.5, topScore * 0.25);

    const chunks = [];
    let tokens = 0;
    for (const r of results) {
      if (r.score < threshold) continue;
      const ct = Math.ceil(r.content.length / 4);
      if (tokens + ct > maxTokens) break;
      chunks.push({ file: r.relativePath, startLine: r.startLine + 1, endLine: r.endLine, content: r.content, score: r.score });
      tokens += ct;
      if (chunks.length >= maxChunks) break;
    }
    return { chunks, totalTokens: tokens, filesSearched: this.fileIndex.size, chunksSearched: this.totalDocs };
  }

  /* ── Error context ─────────────────────────────────────────────── */

  findErrorContext(errorMessage, stackTrace = '') {
    const combined = `${errorMessage} ${stackTrace}`;
    const fileRefs = [];
    const fileRe = /(?:at\s+.*?\s+\()?([a-zA-Z]:[\\\/].*?|\.?[\/\\].*?):(\d+)(?::(\d+))?\)?/g;
    let m;
    while ((m = fileRe.exec(combined))) fileRefs.push({ path: m[1], line: +m[2], col: m[3] ? +m[3] : 0 });

    const ids = new Set();
    const idRe = /\b([a-zA-Z_$][a-zA-Z0-9_$]{2,})\b/g;
    const skip = new Set(['undefined', 'null', 'true', 'false', 'function', 'const', 'let', 'var', 'class', 'import', 'export', 'from', 'return', 'Error', 'TypeError', 'ReferenceError', 'SyntaxError']);
    while ((m = idRe.exec(combined))) { if (!skip.has(m[1])) ids.add(m[1]); }

    const results = this.search([...ids].join(' ') + ' ' + errorMessage, 10);
    for (const r of results) {
      for (const ref of fileRefs) {
        if (r.path.endsWith(ref.path) || ref.path.endsWith(path.basename(r.path))) {
          r.score *= 3;
          r.errorLine = ref.line;
        }
      }
    }
    results.sort((a, b) => b.score - a.score);
    return { results: results.slice(0, 5), fileReferences: fileRefs, identifiers: [...ids] };
  }

  /* ── Misc ──────────────────────────────────────────────────────── */

  async getFileContent(filePath) {
    try { return await fs.readFile(filePath, 'utf8'); } catch { return null; }
  }

  getProjectSummary() {
    const files = [...this.fileIndex.keys()].map(f => path.relative(this.projectPath, f));
    const dirs = new Set();
    for (const f of files) {
      const parts = f.split(path.sep);
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    return { projectPath: this.projectPath, totalFiles: files.length, totalChunks: this.totalDocs, directories: [...dirs].sort(), files: files.sort() };
  }

  getStatus() {
    return { isIndexing: this.isIndexing, indexProgress: this.indexProgress, totalFiles: this.fileIndex.size, totalChunks: this.totalDocs, totalTerms: this.index.size, projectPath: this.projectPath };
  }

  clear() { this._clear(); }

  /* ── Internals ─────────────────────────────────────────────────── */

  _clear() {
    this.index.clear(); this.documents.clear(); this.docLengths.clear();
    this.fileIndex.clear(); this.fileMtimes.clear();
    this._cache.clear(); this._cacheSize = 0;
    this.totalDocs = 0; this.avgDocLength = 0;
  }

  _recalcStats() {
    let total = 0;
    for (const l of this.docLengths.values()) total += l;
    this.totalDocs = this.documents.size;
    this.avgDocLength = this.totalDocs ? total / this.totalDocs : 0;
  }

  _removeFile(fp) {
    const docIds = this.fileIndex.get(fp);
    if (!docIds) return;
    for (const id of docIds) {
      for (const [term, postings] of this.index) { postings.delete(id); if (!postings.size) this.index.delete(term); }
      this.documents.delete(id); this.docLengths.delete(id);
      if (this._cache.has(id)) { this._cache.delete(id); this._cacheSize--; }
    }
    this.fileIndex.delete(fp); this.fileMtimes.delete(fp);
  }

  async _collectFiles(dir, out = []) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(this.projectPath, full);
      if (IGNORE_RE.some(r => r.test(rel) || r.test(e.name))) continue;
      if (e.isDirectory()) { await this._collectFiles(full, out); }
      else if (e.isFile()) {
        try { const st = await fs.stat(full); if (st.size > 0 && st.size <= MAX_FILE_SIZE) out.push(full); } catch {}
      }
    }
    return out;
  }

  async _indexFile(fp) {
    const content = await fs.readFile(fp, 'utf8');
    const st = await fs.stat(fp);
    this.fileMtimes.set(fp, st.mtimeMs);
    const lines = content.split('\n');
    const docIds = [];

    // Try function-boundary chunking for code files
    const ext = path.extname(fp).toLowerCase();
    const codeExts = ['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cs', '.go', '.rs', '.c', '.cpp', '.h'];
    let boundaries = null;
    if (codeExts.includes(ext) && lines.length > CHUNK_SIZE) {
      boundaries = this._findFunctionBoundaries(lines);
    }

    if (boundaries && boundaries.length > 1) {
      // Semantic chunking: split at function boundaries, merge small adjacent chunks
      for (let i = 0; i < boundaries.length; i++) {
        let start = boundaries[i];
        let end = (i + 1 < boundaries.length) ? boundaries[i + 1] : lines.length;
        // Merge small chunks with next boundary
        while (end - start < 30 && i + 1 < boundaries.length) {
          i++;
          end = (i + 1 < boundaries.length) ? boundaries[i + 1] : lines.length;
        }
        // Split oversized chunks
        if (end - start > CHUNK_SIZE) {
          for (let s = start; s < end; s += CHUNK_SIZE - CHUNK_OVERLAP) {
            const e = Math.min(s + CHUNK_SIZE, end);
            this._addChunk(fp, lines, s, e, docIds);
            if (s + CHUNK_SIZE >= end) break;
          }
        } else {
          this._addChunk(fp, lines, start, end, docIds);
        }
      }
    } else {
      // Fallback: fixed-size line-based chunking
      for (let start = 0; start < lines.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
        const end = Math.min(start + CHUNK_SIZE, lines.length);
        this._addChunk(fp, lines, start, end, docIds);
        if (start + CHUNK_SIZE >= lines.length) break;
      }
    }

    this.fileIndex.set(fp, docIds);
  }

  _addChunk(fp, lines, start, end, docIds) {
    const chunk = lines.slice(start, end).join('\n');
    const id = `${fp}:${start}-${end}`;

    this.documents.set(id, { path: fp, relativePath: path.relative(this.projectPath, fp), startLine: start, endLine: end, lineCount: lines.length });
    this._putCache(id, chunk);

    const terms = _tokenize(chunk);
    this.docLengths.set(id, terms.length);

    const freq = new Map();
    terms.forEach((t, pos) => {
      const e = freq.get(t) || { count: 0, positions: [] };
      e.count++; e.positions.push(pos);
      freq.set(t, e);
    });

    for (const [term, { count, positions }] of freq) {
      if (!this.index.has(term)) this.index.set(term, new Map());
      this.index.get(term).set(id, { tf: count, positions });
    }

    docIds.push(id);
  }

  _findFunctionBoundaries(lines) {
    // Detect function/class/method start lines via common patterns
    const boundaryRe = /^(?:export\s+)?(?:async\s+)?(?:function\s+\w|class\s+\w|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?function|\w+\s*\([^)]*\)\s*\{|(?:public|private|protected|static)\s+(?:async\s+)?\w+\s*\(|def\s+\w+|func\s+\w+)/;
    const boundaries = [0];
    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.length > 0 && boundaryRe.test(trimmed)) {
        // Only add if at top-level indentation (0-1 levels) or if line starts at col 0-4
        const indent = lines[i].length - trimmed.length;
        if (indent <= 4) boundaries.push(i);
      }
    }
    return boundaries.length > 1 ? boundaries : null;
  }

  /* ── LRU content cache ─────────────────────────────────────────── */

  _putCache(id, content) {
    if (this._cache.has(id)) this._cache.delete(id);
    else this._cacheSize++;
    this._cache.set(id, content);
    while (this._cacheSize > MAX_CACHED) {
      this._cache.delete(this._cache.keys().next().value);
      this._cacheSize--;
    }
  }

  _getContent(id, doc) {
    if (this._cache.has(id)) {
      const c = this._cache.get(id);
      this._cache.delete(id);
      this._cache.set(id, c);
      return c;
    }
    try {
      const lines = fsSync.readFileSync(doc.path, 'utf8').split('\n');
      const chunk = lines.slice(doc.startLine, doc.endLine).join('\n');
      this._putCache(id, chunk);
      return chunk;
    } catch (e) {
      return `[Content unavailable: ${e.message}]`;
    }
  }
}

/* ── Tokenizer ───────────────────────────────────────────────────── */

function _tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9_\-\.]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
}

module.exports = { RAGEngine };
