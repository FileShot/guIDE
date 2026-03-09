/**
 * guIDE RAG Engine - Retrieval-Augmented Generation for codebase understanding
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * Uses BM25 text search + file chunking for efficient context retrieval
 */
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

// BM25 parameters
const BM25_K1 = 1.5;
const BM25_B = 0.75;

// Chunk settings
const CHUNK_SIZE = 500; // lines per chunk
const CHUNK_OVERLAP = 50; // overlap between chunks
const MAX_FILE_SIZE = 1024 * 1024; // 1MB max file size to index
const MAX_CACHED_CHUNKS = 5000; // LRU cap on in-memory chunk content

// File patterns to ignore
const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /\.cache/,
  /\.DS_Store/,
  /\.env/,
  /\.gguf$/,
  /\.exe$/,
  /\.dll$/,
  /\.so$/,
  /\.dylib$/,
  /\.bin$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.ico$/,
  /\.svg$/,
  /\.woff/,
  /\.ttf$/,
  /\.eot$/,
  /\.mp3$/,
  /\.mp4$/,
  /\.avi$/,
  /\.zip$/,
  /\.tar$/,
  /\.gz$/,
  /\.rar$/,
  /\.7z$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

class RAGEngine {
  constructor() {
    this.index = new Map(); // term -> { docId -> { tf, positions } }
    this.documents = new Map(); // docId -> { path, content, lines, chunk }
    this.docLengths = new Map(); // docId -> length (in terms)
    this.avgDocLength = 0;
    this.totalDocs = 0;
    this.projectPath = null;
    this.isIndexing = false;
    this.indexProgress = 0;
    this.fileIndex = new Map(); // filePath -> [docIds] for file-level lookup
    this.fileMtimes = new Map(); // filePath -> mtimeMs for incremental re-index

    // LRU content cache — content is evicted when cache exceeds MAX_CACHED_CHUNKS.
    // Metadata (path, startLine, endLine, lineCount) is always kept in this.documents.
    // Evicted content is reloaded from disk on-demand during search.
    this._contentCache = new Map(); // docId -> content string (LRU ordered by insertion)
    this._contentCacheSize = 0;
  }

  async indexProject(projectPath, onProgress) {
    // Guard against concurrent indexing — if already running, skip
    if (this.isIndexing) {
      console.log('[RAG] indexProject called while already indexing, skipping');
      return { indexed: 0, skipped: 0, duration: 0 };
    }
    this.isIndexing = true;
    this.indexProgress = 0;
    this.projectPath = projectPath;

    // Clear existing index
    this.index.clear();
    this.documents.clear();
    this.docLengths.clear();
    this.fileIndex.clear();
    this.fileMtimes.clear();
    this._contentCache.clear();
    this._contentCacheSize = 0;

    try {
      // Collect all indexable files
      const files = await this._collectFiles(projectPath);
      const totalFiles = files.length;
      let processedFiles = 0;
      const startTime = Date.now();

      // Index files in parallel batches of 20 for throughput
      const BATCH_SIZE = 20;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (filePath) => {
          try {
            await this._indexFile(filePath);
          } catch (e) {
            // Skip files that can't be read
          }
        }));
        processedFiles += batch.length;
        this.indexProgress = Math.round((processedFiles / totalFiles) * 100);
        if (onProgress) onProgress(this.indexProgress, processedFiles, totalFiles);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[RAG] Indexed ${totalFiles} files in ${elapsed}s`);

      // Calculate average document length
      let totalLength = 0;
      for (const len of this.docLengths.values()) {
        totalLength += len;
      }
      this.totalDocs = this.documents.size;
      this.avgDocLength = this.totalDocs > 0 ? totalLength / this.totalDocs : 0;

      this.isIndexing = false;
      return {
        totalFiles: totalFiles,
        totalChunks: this.totalDocs,
        totalTerms: this.index.size,
      };
    } catch (error) {
      this.isIndexing = false;
      throw error;
    }
  }

  /**
   * Incremental re-index — only re-indexes files whose mtime has changed,
   * plus indexes new files and removes deleted files from the index.
   */
  async reindexChanged(onProgress) {
    if (this.isIndexing || !this.projectPath) {
      return { updated: 0, added: 0, removed: 0 };
    }
    this.isIndexing = true;
    const startTime = Date.now();

    try {
      const files = await this._collectFiles(this.projectPath);
      const currentFileSet = new Set(files);
      let updated = 0, added = 0, removed = 0;
      let processed = 0;

      // Remove index entries for deleted files
      for (const [filePath] of this.fileIndex) {
        if (!currentFileSet.has(filePath)) {
          this._removeFileFromIndex(filePath);
          removed++;
        }
      }

      // Check each current file for changes
      const BATCH_SIZE = 20;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (filePath) => {
          try {
            const stats = await fs.stat(filePath);
            const prevMtime = this.fileMtimes.get(filePath);
            if (prevMtime === undefined) {
              // New file
              await this._indexFile(filePath);
              added++;
            } else if (stats.mtimeMs > prevMtime) {
              // Changed file — remove old entries, re-index
              this._removeFileFromIndex(filePath);
              await this._indexFile(filePath);
              updated++;
            }
            // Unchanged: skip
          } catch (e) { /* skip unreadable */ }
        }));
        processed += batch.length;
        if (onProgress) onProgress(Math.round((processed / files.length) * 100), processed, files.length);
      }

      // Recalculate stats
      this._recalculateStats();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[RAG] Incremental re-index in ${elapsed}s: ${updated} updated, ${added} added, ${removed} removed`);
      this.isIndexing = false;
      return { updated, added, removed };
    } catch (error) {
      this.isIndexing = false;
      throw error;
    }
  }

  /** Remove all index entries for a single file */
  _removeFileFromIndex(filePath) {
    const docIds = this.fileIndex.get(filePath);
    if (!docIds) return;
    for (const docId of docIds) {
      // Remove from inverted index
      for (const [term, postings] of this.index) {
        postings.delete(docId);
        if (postings.size === 0) this.index.delete(term);
      }
      this.documents.delete(docId);
      this.docLengths.delete(docId);
      this._evictContent(docId);
    }
    this.fileIndex.delete(filePath);
    this.fileMtimes.delete(filePath);
  }

  /** Recalculate totalDocs and avgDocLength after incremental changes */
  _recalculateStats() {
    let totalLength = 0;
    for (const len of this.docLengths.values()) {
      totalLength += len;
    }
    this.totalDocs = this.documents.size;
    this.avgDocLength = this.totalDocs > 0 ? totalLength / this.totalDocs : 0;
  }

  async _collectFiles(dirPath, files = []) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.projectPath, fullPath);

        // Check ignore patterns
        if (IGNORE_PATTERNS.some(p => p.test(relativePath) || p.test(entry.name))) {
          continue;
        }

        if (entry.isDirectory()) {
          await this._collectFiles(fullPath, files);
        } else if (entry.isFile()) {
          try {
            const stats = await fs.stat(fullPath);
            if (stats.size <= MAX_FILE_SIZE && stats.size > 0) {
              files.push(fullPath);
            }
          } catch (e) { /* skip */ }
        }
      }
    } catch (e) { /* skip unreadable dirs */ }
    return files;
  }

  async _indexFile(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    const stats = await fs.stat(filePath);
    this.fileMtimes.set(filePath, stats.mtimeMs);
    const lines = content.split('\n');
    const docIds = [];

    // Create chunks with overlap
    for (let start = 0; start < lines.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
      const end = Math.min(start + CHUNK_SIZE, lines.length);
      const chunkLines = lines.slice(start, end);
      const chunkContent = chunkLines.join('\n');

      const docId = `${filePath}:${start}-${end}`;
      // Store metadata always; content goes to LRU cache
      this.documents.set(docId, {
        path: filePath,
        relativePath: path.relative(this.projectPath, filePath),
        startLine: start,
        endLine: end,
        lineCount: lines.length,
      });
      this._cacheContent(docId, chunkContent);

      // Tokenize and index
      const terms = this._tokenize(chunkContent);
      this.docLengths.set(docId, terms.length);

      // Build term frequency map
      const termFreqs = new Map();
      terms.forEach((term, pos) => {
        if (!termFreqs.has(term)) {
          termFreqs.set(term, { count: 0, positions: [] });
        }
        const tf = termFreqs.get(term);
        tf.count++;
        tf.positions.push(pos);
      });

      // Add to inverted index
      for (const [term, { count, positions }] of termFreqs) {
        if (!this.index.has(term)) {
          this.index.set(term, new Map());
        }
        this.index.get(term).set(docId, { tf: count, positions });
      }

      docIds.push(docId);

      if (start + CHUNK_SIZE >= lines.length) break;
    }

    this.fileIndex.set(filePath, docIds);
  }

  _tokenize(text) {
    // Split on non-alphanumeric, convert to lowercase, filter short tokens
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_\-\.]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }

  /**
   * BM25 search across the indexed codebase
   */
  search(query, maxResults = 10) {
    if (this.totalDocs === 0) return [];

    const queryTerms = this._tokenize(query);
    const scores = new Map();

    for (const term of queryTerms) {
      const postings = this.index.get(term);
      if (!postings) continue;

      // IDF calculation
      const df = postings.size;
      const idf = Math.log((this.totalDocs - df + 0.5) / (df + 0.5) + 1);

      for (const [docId, { tf }] of postings) {
        const docLen = this.docLengths.get(docId) || 0;
        // BM25 score
        const numerator = tf * (BM25_K1 + 1);
        const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / this.avgDocLength));
        const score = idf * (numerator / denominator);

        scores.set(docId, (scores.get(docId) || 0) + score);
      }
    }

    // Sort by score and return top results
    const results = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults)
      .map(([docId, score]) => {
        const doc = this.documents.get(docId);
        return {
          docId,
          score,
          path: doc.path,
          relativePath: doc.relativePath,
          content: this._getContent(docId, doc),
          startLine: doc.startLine,
          endLine: doc.endLine,
          lineCount: doc.lineCount,
        };
      });

    return results;
  }

  /**
   * Search for files by name/path
   */
  searchFiles(query, maxResults = 20) {
    const queryLower = query.toLowerCase();
    const results = [];

    for (const [filePath, docIds] of this.fileIndex) {
      const relativePath = path.relative(this.projectPath, filePath).toLowerCase();
      const fileName = path.basename(filePath).toLowerCase();

      let score = 0;
      if (fileName === queryLower) score = 100;
      else if (fileName.startsWith(queryLower)) score = 80;
      else if (fileName.includes(queryLower)) score = 60;
      else if (relativePath.includes(queryLower)) score = 40;

      if (score > 0) {
        results.push({
          path: filePath,
          relativePath: path.relative(this.projectPath, filePath),
          score,
          fileName: path.basename(filePath),
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  /**
   * Get relevant context for an AI query about the codebase
   */
  getContextForQuery(query, maxChunks = 5, maxTokens = 3000) {
    const results = this.search(query, maxChunks * 3);
    const context = [];
    let totalTokens = 0;
    const seenFiles = new Set();

    // --- Relevance filtering ---
    // Absolute minimum: discard very weak BM25 matches that are just
    // coincidental single-word overlaps (e.g. "file" appearing everywhere)
    const MIN_SCORE = 1.5;
    // Relative threshold: only keep results within 25% of the top score
    const topScore = results.length > 0 ? results[0].score : 0;
    const relativeThreshold = topScore * 0.25;
    const scoreThreshold = Math.max(MIN_SCORE, relativeThreshold);

    for (const result of results) {
      // Skip results below relevance threshold
      if (result.score < scoreThreshold) continue;

      // Approximate token count (4 chars per token)
      const chunkTokens = Math.ceil(result.content.length / 4);
      if (totalTokens + chunkTokens > maxTokens) break;

      context.push({
        file: result.relativePath,
        startLine: result.startLine + 1, // 1-indexed
        endLine: result.endLine,
        content: result.content,
        score: result.score,
      });
      totalTokens += chunkTokens;
      seenFiles.add(result.path);

      if (context.length >= maxChunks) break;
    }

    return {
      chunks: context,
      totalTokens,
      filesSearched: this.fileIndex.size,
      chunksSearched: this.totalDocs,
    };
  }

  /**
   * Get the full content of a specific file (reads from disk on demand)
   */
  async getFileContent(filePath) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Find files that might contain a specific error
   */
  findErrorContext(errorMessage, stackTrace = '') {
    const combined = `${errorMessage} ${stackTrace}`;

    // Extract file references from error/stack trace
    const fileRefs = [];
    const fileRegex = /(?:at\s+.*?\s+\()?([a-zA-Z]:[\\\/].*?|\.?[\/\\].*?):(\d+)(?::(\d+))?\)?/g;
    let match;
    while ((match = fileRegex.exec(combined)) !== null) {
      fileRefs.push({ path: match[1], line: parseInt(match[2]), col: match[3] ? parseInt(match[3]) : 0 });
    }

    // Also extract potential identifiers (function names, variable names)
    const identRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]{2,})\b/g;
    const identifiers = new Set();
    while ((match = identRegex.exec(combined)) !== null) {
      const id = match[1];
      // Filter out common words
      if (!['undefined', 'null', 'true', 'false', 'function', 'const', 'let', 'var', 'class', 'import', 'export', 'from', 'return', 'Error', 'TypeError', 'ReferenceError', 'SyntaxError'].includes(id)) {
        identifiers.add(id);
      }
    }

    // Search for error-related content
    const searchQuery = Array.from(identifiers).join(' ') + ' ' + errorMessage;
    const searchResults = this.search(searchQuery, 10);

    // Boost results that match file references
    for (const result of searchResults) {
      for (const ref of fileRefs) {
        if (result.path.endsWith(ref.path) || ref.path.endsWith(path.basename(result.path))) {
          result.score *= 3; // Strongly boost files mentioned in stack trace
          result.errorLine = ref.line;
        }
      }
    }

    // Re-sort
    searchResults.sort((a, b) => b.score - a.score);

    return {
      results: searchResults.slice(0, 5),
      fileReferences: fileRefs,
      identifiers: Array.from(identifiers),
    };
  }

  /**
   * Get project structure summary for context
   */
  getProjectSummary() {
    const files = Array.from(this.fileIndex.keys()).map(f => path.relative(this.projectPath, f));
    const dirs = new Set();
    files.forEach(f => {
      const parts = f.split(path.sep);
      for (let i = 1; i <= parts.length - 1; i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    });

    return {
      projectPath: this.projectPath,
      totalFiles: files.length,
      totalChunks: this.totalDocs,
      directories: Array.from(dirs).sort(),
      files: files.sort(),
    };
  }

  getStatus() {
    return {
      isIndexing: this.isIndexing,
      indexProgress: this.indexProgress,
      totalFiles: this.fileIndex.size,
      totalChunks: this.totalDocs,
      totalTerms: this.index.size,
      projectPath: this.projectPath,
    };
  }

  clear() {
    this.index.clear();
    this.documents.clear();
    this.docLengths.clear();
    this.fileIndex.clear();
    this._contentCache.clear();
    this._contentCacheSize = 0;
    this.totalDocs = 0;
    this.avgDocLength = 0;
    this.projectPath = null;
  }

  // ── LRU Content Cache ──────────────────────────────────────────
  // The inverted index (this.index) and metadata (this.documents) are always kept.
  // Only chunk *content* (the largest memory consumer) is cached with LRU eviction.
  // Evicted content is reloaded from disk on demand during search.

  /** Store content in LRU cache, evicting oldest entries if over limit */
  _cacheContent(docId, content) {
    if (this._contentCache.has(docId)) {
      // Move to end (most recently used)
      this._contentCache.delete(docId);
    } else {
      this._contentCacheSize++;
    }
    this._contentCache.set(docId, content);

    // Evict oldest entries if over limit
    while (this._contentCacheSize > MAX_CACHED_CHUNKS) {
      const oldest = this._contentCache.keys().next().value;
      this._contentCache.delete(oldest);
      this._contentCacheSize--;
    }
  }

  /** Get content for a docId — from cache or reload from disk */
  _getContent(docId, doc) {
    // Cache hit — move to end (most recently used)
    if (this._contentCache.has(docId)) {
      const content = this._contentCache.get(docId);
      this._contentCache.delete(docId);
      this._contentCache.set(docId, content);
      return content;
    }

    // Cache miss — reload from disk synchronously
    try {
      const fileContent = require('fs').readFileSync(doc.path, 'utf8');
      const lines = fileContent.split('\n');
      const chunkContent = lines.slice(doc.startLine, doc.endLine).join('\n');
      this._cacheContent(docId, chunkContent);
      return chunkContent;
    } catch (e) {
      return `[Content unavailable: ${e.message}]`;
    }
  }

  /** Remove content from cache when doc is removed from index */
  _evictContent(docId) {
    if (this._contentCache.has(docId)) {
      this._contentCache.delete(docId);
      this._contentCacheSize--;
    }
  }
}

module.exports = { RAGEngine };
