const fs = require('fs');
const filePath = 'C:\\Users\\brend\\all site work\\pocket-guide\\tools.js';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Lines 1929-2015 (0-indexed: 1928-2014)
const before = lines.slice(0, 1928);
const after = lines.slice(2015);

const newBlock = `    // Attempt 1: Playwright (fast 2s timeout)
    try {
      await doClick();
      await this.browserPage.waitForTimeout(100);
      const snap = await this._browserSnapshot({});
      await this._emitBrowserFrame();
      return { success: true, message: \`Clicked \${roleParams.role ? \`role=\${roleParams.role}\${roleParams.name ? \` name=\${roleParams.name}\` : ''}\` : sel}\`, snapshot: snap.content };
    } catch (firstErr) {
      // Attempt 2: Immediate JS fallback \u2014 skip overlays, just blast through with raw JS
      try {
        let clicked = false;
        if (roleParams.role && roleParams.name) {
          clicked = await this.browserPage.evaluate(({ role, name }) => {
            const allElements = document.querySelectorAll(\`[role="\${role}"], \${role}, button, a, input, select, label\`);
            for (const el of allElements) {
              if (el.textContent?.trim()?.toLowerCase().includes(name.toLowerCase()) || el.getAttribute('aria-label')?.toLowerCase().includes(name.toLowerCase())) {
                el.scrollIntoView({ block: 'center' });
                el.click(); return true;
              }
            }
            return false;
          }, { role: roleParams.role, name: roleParams.name });
        } else if (sel && sel.startsWith('aria-ref=')) {
          try {
            await this.browserPage.locator(sel).first().evaluate(el => { el.scrollIntoView({ block: 'center' }); el.click(); });
            clicked = true;
          } catch {}
        } else if (sel) {
          clicked = await this.browserPage.evaluate(s => { const el = document.querySelector(s); if (el) { el.scrollIntoView({ block: 'center' }); el.click(); return true; } return false; }, sel);
        }
        if (clicked) {
          await this.browserPage.waitForTimeout(100);
          const snap = await this._browserSnapshot({});
          await this._emitBrowserFrame();
          return { success: true, message: \`Clicked via JS fallback\`, snapshot: snap.content };
        }
      } catch {}

      // Both attempts failed
      const url = this.browserPage?.url() || 'unknown';
      const captchaRecovery = await this._detectAndHandleCaptcha(url);
      if (captchaRecovery) return captchaRecovery;
      let snapHint = '';
      try { const s = await this._browserSnapshot({}); snapHint = \`\\nAvailable elements on page:\\n\${(s.content || '').substring(0, 2000)}\`; } catch {}
      return { success: false, error: \`Click failed on \${url}: \${firstErr.message.substring(0, 200)}.\${snapHint}\` };
    }
  }`;

const result = [...before, ...newBlock.split('\n'), ...after].join('\n');
fs.writeFileSync(filePath, result, 'utf8');

const newLines = result.split('\n');
console.log('Done. Old line count:', lines.length, '-> New line count:', newLines.length);
console.log('Line 1929:', newLines[1928]);
console.log('Line 1930:', newLines[1929]);
