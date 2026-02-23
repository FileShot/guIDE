/**
 * guIDE Web Search - DuckDuckGo-based web search
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 *
 * No API keys required - uses DuckDuckGo HTML search
 */
const https = require('https');
const http = require('http');

class WebSearch {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ];
    this.userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Search the web using DuckDuckGo
   */
  async search(query, maxResults = 5) {
    const cacheKey = `search:${query}:${maxResults}`;
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const html = await this._fetch(url);
      const results = this._parseDDGResults(html, maxResults);

      this._setCache(cacheKey, results);
      return results;
    } catch (error) {
      console.error('Web search failed:', error.message);
      return { results: [], error: error.message };
    }
  }

  /**
   * Fetch and extract main content from a URL
   */
  async fetchPage(url) {
    const cacheKey = `page:${url}`;
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    try {
      const html = await this._fetch(url);
      const content = this._extractMainContent(html);

      const result = { url, title: this._extractTitle(html), content, fetchedAt: new Date().toISOString() };
      this._setCache(cacheKey, result);
      return result;
    } catch (error) {
      return { url, title: '', content: '', error: error.message };
    }
  }

  /**
   * Search for programming-specific queries (Stack Overflow, MDN, etc.)
   */
  async searchCode(query) {
    const enhancedQuery = `${query} site:stackoverflow.com OR site:developer.mozilla.org OR site:github.com`;
    return this.search(enhancedQuery, 5);
  }

  _parseDDGResults(html, maxResults) {
    const results = [];
    // Parse DuckDuckGo HTML results
    const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    const links = [];
    while ((match = resultRegex.exec(html)) !== null && links.length < maxResults) {
      const url = this._decodeRedirectUrl(match[1]);
      const title = this._stripHtml(match[2]);
      if (url && title && !url.includes('duckduckgo.com')) {
        links.push({ url, title });
      }
    }

    const snippets = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(this._stripHtml(match[1]));
    }

    for (let i = 0; i < links.length; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || '',
        position: i + 1,
      });
    }

    return { results, query: '', totalResults: results.length };
  }

  _decodeRedirectUrl(url) {
    // DuckDuckGo wraps URLs in a redirect
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      return decodeURIComponent(uddgMatch[1]);
    }
    // Direct URL
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  }

  _stripHtml(html) {
    return html
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractTitle(html) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return titleMatch ? this._stripHtml(titleMatch[1]) : '';
  }

  _extractMainContent(html) {
    // Remove scripts, styles, nav, header, footer
    let content = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '');

    // Try to find main content area
    const mainMatch = content.match(/<main[\s\S]*?<\/main>/i) ||
                      content.match(/<article[\s\S]*?<\/article>/i) ||
                      content.match(/<div[^>]*(?:content|main|article|post)[^>]*>[\s\S]*?<\/div>/i);

    if (mainMatch) {
      content = mainMatch[0];
    }

    // Extract text, preserving code blocks
    const codeBlocks = [];
    content = content.replace(/<(?:pre|code)[^>]*>([\s\S]*?)<\/(?:pre|code)>/gi, (match, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(this._stripHtml(code));
      return `\n\`\`\`\n__CODE_BLOCK_${idx}__\n\`\`\`\n`;
    });

    // Strip remaining HTML
    content = this._stripHtml(content);

    // Restore code blocks
    codeBlocks.forEach((code, idx) => {
      content = content.replace(`__CODE_BLOCK_${idx}__`, code);
    });

    // Clean up whitespace
    content = content.replace(/\n{3,}/g, '\n\n').trim();

    // Truncate to reasonable size
    if (content.length > 5000) {
      content = content.substring(0, 5000) + '\n\n[Content truncated...]';
    }

    return content;
  }

  _fetch(url, maxRedirects = 5, retryCount = 0, triedAgents = new Set()) {
    const MAX_RETRIES = 5;
    // Block private/local URLs
    if (!/^https?:\/\//.test(url) || /^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url)) {
      return Promise.reject(new Error('Blocked private or invalid URL'));
    }
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) {
        reject(new Error('Too many redirects'));
        return;
      }
      // Try all user agents before giving up
      const uaList = this.userAgents.filter(ua => !triedAgents.has(ua));
      const ua = uaList.length ? uaList[0] : this.userAgent;
      triedAgents.add(ua);
      const protocol = url.startsWith('https') ? https : http;
      const options = {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
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
      const req = protocol.get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            const parsed = new URL(url);
            redirectUrl = parsed.origin + redirectUrl;
          }
          this._fetch(redirectUrl, maxRedirects - 1, retryCount, triedAgents).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode === 202 && retryCount < MAX_RETRIES) {
          res.resume();
          const delay = (retryCount + 1) * 1500;
          setTimeout(() => {
            this._fetch(url, maxRedirects, retryCount + 1, triedAgents).then(resolve).catch(reject);
          }, delay);
          return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 202) {
          // Try all user agents, then exponential backoff
          if (uaList.length > 1) {
            res.resume();
            setTimeout(() => {
              this._fetch(url, maxRedirects, retryCount, triedAgents).then(resolve).catch(reject);
            }, 1000 * (retryCount + 1));
            return;
          }
          if (retryCount < MAX_RETRIES) {
            res.resume();
            setTimeout(() => {
              this._fetch(url, maxRedirects, retryCount + 1, new Set()).then(resolve).catch(reject);
            }, 2000 * (retryCount + 1));
            return;
          }
          console.error(`[fetch_webpage] FAIL: ${url} HTTP ${res.statusCode}`);
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', (err) => {
        if (uaList.length > 1) {
          setTimeout(() => {
            this._fetch(url, maxRedirects, retryCount, triedAgents).then(resolve).catch(reject);
          }, 1000 * (retryCount + 1));
        } else if (retryCount < MAX_RETRIES) {
          setTimeout(() => {
            this._fetch(url, maxRedirects, retryCount + 1, new Set()).then(resolve).catch(reject);
          }, 2000 * (retryCount + 1));
        } else {
          console.error(`[fetch_webpage] ERROR: ${url} ${err.message}`);
          reject(err);
        }
      });
      req.on('timeout', () => {
        req.destroy();
        if (uaList.length > 1) {
          setTimeout(() => {
            this._fetch(url, maxRedirects, retryCount, triedAgents).then(resolve).catch(reject);
          }, 1000 * (retryCount + 1));
        } else if (retryCount < MAX_RETRIES) {
          setTimeout(() => {
            this._fetch(url, maxRedirects, retryCount + 1, new Set()).then(resolve).catch(reject);
          }, 2000 * (retryCount + 1));
        } else {
          console.error(`[fetch_webpage] TIMEOUT: ${url}`);
          reject(new Error('Request timeout'));
        }
      });
    });
  }

  _getCache(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.time < this.cacheTimeout) {
      return entry.data;
    }
    this.cache.delete(key);
    return null;
  }

  _setCache(key, data) {
    this.cache.set(key, { data, time: Date.now() });
    // Limit cache size
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }
}

module.exports = { WebSearch };
