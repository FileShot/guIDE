/**
 * guIDE — Web Search
 *
 * DuckDuckGo HTML-based web search + page content extraction.
 * No API keys required. SSRF protection blocks private/local URLs.
 * Results cached 5 minutes, max 100 entries.
 */
'use strict';

const https = require('https');
const http = require('http');
const log = require('./logger');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

const PRIVATE_URL_RE = /^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

class WebSearch {
  constructor() {
    this.userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    this._cache = new Map();
    this._cacheTTL = 5 * 60 * 1000;
  }

  /* ── Public API ────────────────────────────────────────────────── */

  async search(query, maxResults = 5) {
    const key = `search:${query}:${maxResults}`;
    const hit = this._cacheGet(key);
    if (hit) return hit;

    try {
      const html = await this._fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
      const results = this._parseDDGResults(html, maxResults);
      this._cacheSet(key, results);
      return results;
    } catch (e) {
      log.warn('WebSearch', 'Search failed:', e.message);
      return { results: [], error: e.message };
    }
  }

  async fetchPage(url) {
    const key = `page:${url}`;
    const hit = this._cacheGet(key);
    if (hit) return hit;

    try {
      const html = await this._fetch(url);
      const result = {
        url,
        title: _extractTitle(html),
        content: _extractMainContent(html),
        fetchedAt: new Date().toISOString(),
      };
      this._cacheSet(key, result);
      return result;
    } catch (e) {
      return { url, title: '', content: '', error: e.message };
    }
  }

  async searchCode(query) {
    return this.search(`${query} site:stackoverflow.com OR site:developer.mozilla.org OR site:github.com`, 5);
  }

  /* ── DDG parser ────────────────────────────────────────────────── */

  _parseDDGResults(html, maxResults) {
    const linkRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const links = [];
    let m;
    while ((m = linkRe.exec(html)) !== null && links.length < maxResults) {
      const url = _decodeRedirectUrl(m[1]);
      const title = _stripHtml(m[2]);
      if (url && title && !url.includes('duckduckgo.com')) links.push({ url, title });
    }

    const snippets = [];
    while ((m = snippetRe.exec(html)) !== null) snippets.push(_stripHtml(m[1]));

    const results = links.map((l, i) => ({
      title: l.title, url: l.url, snippet: snippets[i] || '', position: i + 1,
    }));

    return { results, query: '', totalResults: results.length };
  }

  /* ── HTTP fetch with SSRF protection ───────────────────────────── */

  _fetch(url, maxRedirects = 5, retryCount = 0, triedAgents = new Set()) {
    const MAX_RETRIES = 5;

    // SSRF: block private / local URLs
    if (!/^https?:\/\//.test(url) || PRIVATE_URL_RE.test(url)) {
      return Promise.reject(new Error('Blocked private or invalid URL'));
    }

    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

      const uaList = USER_AGENTS.filter(ua => !triedAgents.has(ua));
      const ua = uaList.length ? uaList[0] : this.userAgent;
      triedAgents.add(ua);

      const proto = url.startsWith('https') ? https : http;
      const opts = {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0',
        },
        timeout: 15000 * (retryCount + 1),
      };

      const req = proto.get(url, opts, (res) => {
        // Redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redir = res.headers.location;
          if (redir.startsWith('/')) {
            const parsed = new URL(url);
            redir = parsed.origin + redir;
          }
          res.resume();
          return this._fetch(redir, maxRedirects - 1, retryCount, triedAgents).then(resolve, reject);
        }

        // 202 retry
        if (res.statusCode === 202 && retryCount < MAX_RETRIES) {
          res.resume();
          return setTimeout(() => this._fetch(url, maxRedirects, retryCount + 1, triedAgents).then(resolve, reject), (retryCount + 1) * 1500);
        }

        // Non-200: rotate UA then backoff
        if (res.statusCode !== 200 && res.statusCode !== 202) {
          res.resume();
          if (uaList.length > 1) {
            return setTimeout(() => this._fetch(url, maxRedirects, retryCount, triedAgents).then(resolve, reject), 1000 * (retryCount + 1));
          }
          if (retryCount < MAX_RETRIES) {
            return setTimeout(() => this._fetch(url, maxRedirects, retryCount + 1, new Set()).then(resolve, reject), 2000 * (retryCount + 1));
          }
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', (err) => {
        if (uaList.length > 1) {
          return setTimeout(() => this._fetch(url, maxRedirects, retryCount, triedAgents).then(resolve, reject), 1000 * (retryCount + 1));
        }
        if (retryCount < MAX_RETRIES) {
          return setTimeout(() => this._fetch(url, maxRedirects, retryCount + 1, new Set()).then(resolve, reject), 2000 * (retryCount + 1));
        }
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        if (uaList.length > 1) {
          return setTimeout(() => this._fetch(url, maxRedirects, retryCount, triedAgents).then(resolve, reject), 1000 * (retryCount + 1));
        }
        if (retryCount < MAX_RETRIES) {
          return setTimeout(() => this._fetch(url, maxRedirects, retryCount + 1, new Set()).then(resolve, reject), 2000 * (retryCount + 1));
        }
        reject(new Error('Request timeout'));
      });
    });
  }

  /* ── Cache ─────────────────────────────────────────────────────── */

  _cacheGet(key) {
    const e = this._cache.get(key);
    if (e && Date.now() - e.time < this._cacheTTL) return e.data;
    this._cache.delete(key);
    return null;
  }

  _cacheSet(key, data) {
    this._cache.set(key, { data, time: Date.now() });
    if (this._cache.size > 100) {
      this._cache.delete(this._cache.keys().next().value);
    }
  }
}

/* ── Standalone helpers ──────────────────────────────────────────── */

function _decodeRedirectUrl(url) {
  const m = url.match(/uddg=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

function _stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? _stripHtml(m[1]) : '';
}

function _extractMainContent(html) {
  let c = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');

  const main = c.match(/<main[\s\S]*?<\/main>/i)
    || c.match(/<article[\s\S]*?<\/article>/i)
    || c.match(/<div[^>]*(?:content|main|article|post)[^>]*>[\s\S]*?<\/div>/i);
  if (main) c = main[0];

  // Preserve code blocks
  const codeBlocks = [];
  c = c.replace(/<(?:pre|code)[^>]*>([\s\S]*?)<\/(?:pre|code)>/gi, (_, code) => {
    codeBlocks.push(_stripHtml(code));
    return `\n\`\`\`\n__CB_${codeBlocks.length - 1}__\n\`\`\`\n`;
  });

  c = _stripHtml(c);
  codeBlocks.forEach((code, i) => { c = c.replace(`__CB_${i}__`, code); });
  c = c.replace(/\n{3,}/g, '\n\n').trim();

  return c.length > 5000 ? c.substring(0, 5000) + '\n\n[Content truncated...]' : c;
}

module.exports = { WebSearch };
