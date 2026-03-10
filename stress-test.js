/**
 * Stress Test — Exact 1:1 mirror of electron-main.js pipeline.
 * Every service, every wiring, every ctx property matches the real app.
 * The ONLY differences: headless window, mock webContents.send for capture, CLI model path.
 *
 * Usage: npx electron stress-test.js <model-path>
 */
const { app, BrowserWindow, ipcMain, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsSync = require('fs');

const modelPath = process.argv.find(a => a.endsWith('.gguf'));
if (!modelPath) {
  console.error('Usage: npx electron stress-test.js <path-to-model.gguf>');
  process.exit(1);
}

// ── Same GPU flags as electron-main.js ──
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');

// ── Persistent Logging (same as electron-main.js — FIRST before any module) ──
const log = require('./main/logger');
log.installConsoleIntercepts();

// ── Main Process Modules — IDENTICAL to electron-main.js lines 56-100 ──
const { LLMEngine } = require('./main/llmEngine');
const { ModelManager } = require('./main/modelManager');
const { RAGEngine } = require('./main/ragEngine');
const { TerminalManager } = require('./main/terminalManager');
const { WebSearch } = require('./main/webSearch');
const { MCPToolServer } = require('./main/mcpToolServer');
const { BrowserManager } = require('./main/browserManager');
const { PlaywrightBrowser } = require('./main/playwrightBrowser');
const { MemoryStore } = require('./main/memoryStore');
const { CloudLLMService } = require('./main/cloudLLMService');
const { ImageGenerationService } = require('./main/imageGenerationService');
const { LocalImageEngine } = require('./main/localImageEngine');
const { GitManager } = require('./main/gitManager');
const LicenseManager = require('./main/licenseManager');
const { DebugService } = require('./main/debugService');
const { ConversationSummarizer } = require('./main/conversationSummarizer');

// ── Extracted Modules — IDENTICAL to electron-main.js ──
const { DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, DEFAULT_CHAT_PREAMBLE } = require('./main/constants');
const { createPathValidator } = require('./main/pathValidator');
const { createSettingsManager, registerSettingsHandlers } = require('./main/settingsManager');
const { encryptApiKey, decryptApiKey, loadSavedApiKeys } = require('./main/apiKeyStore');
const { _truncateResult, _detectGPU, getCpuUsage } = require('./main/mainUtils');
const { register: registerAgenticChat } = require('./main/agenticChat');

// ── IPC handler modules — same as electron-main.js ──
const { register: registerFileSystem } = require('./main/ipc/fileSystemHandlers');
const { register: registerDialogs } = require('./main/ipc/dialogHandlers');
const { register: registerTerminal } = require('./main/ipc/terminalHandlers');
const { register: registerLicense } = require('./main/ipc/licenseHandlers');
const { register: registerGit } = require('./main/ipc/gitHandlers');
const { register: registerMemory } = require('./main/ipc/memoryHandlers');
const { register: registerBrowser } = require('./main/ipc/browserHandlers');
const { register: registerLlm } = require('./main/ipc/llmHandlers');
const { register: registerModels } = require('./main/ipc/modelHandlers');
const { register: registerRag } = require('./main/ipc/ragHandlers');
const { register: registerMcp } = require('./main/ipc/mcpHandlers');
const { register: registerDebug } = require('./main/ipc/debugHandlers');
const { register: registerAgents } = require('./main/ipc/agentHandlers');
const { register: registerCloudLlm } = require('./main/ipc/cloudLlmHandlers');
const { register: registerEditor } = require('./main/ipc/editorHandlers');
const { register: registerUtility } = require('./main/ipc/utilityHandlers');
const { register: registerImageGen } = require('./main/ipc/imageGenHandlers');
const { register: registerBenchmark } = require('./main/ipc/benchmarkHandlers');
const { register: registerTemplates } = require('./main/ipc/templateHandlers');
const { register: registerTodoTree } = require('./main/ipc/todoTreeHandlers');
const { register: registerLiveServer } = require('./main/ipc/liveServerHandlers');
const { register: registerRestClient } = require('./main/ipc/restClientHandlers');

// ── Intercept ipcMain.handle BEFORE any registrations — same pattern as test-harness.js ──
const _capturedHandlers = {};
const _originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  _capturedHandlers[channel] = handler;
  try { _originalHandle(channel, handler); } catch (_) {}
};

const TEST_PROMPT = `You are tasked with designing and building a fully functional, visually stunning, and highly interactive file-sharing website entirely from scratch as a single HTML file with all CSS embedded inline or inside a <style> tag, all JavaScript fully embedded in <script> tags, and no external dependencies. The website must be designed for modern users to upload, download, manage, and share files securely and efficiently, supporting multiple file types, with a user interface that is elegant, dark-themed with vibrant accent colors, glassmorphic panels, subtle shadows, smooth transitions, and fully responsive across mobile, tablet, and desktop screens. Include a full-width sticky header with a logo placeholder, multi-level navigation menus for Home, Upload, Browse, My Files, Analytics, and Support, a dynamic search bar filtering file types and categories, and a user profile dropdown with account settings, storage statistics, and notifications. The hero section should feature a full-screen animated background gradient or abstract shapes, bold headline text promoting fast and secure file sharing, a prominent upload button that triggers a modal with drag-and-drop file upload, multi-file selection, progress bars, file type validation, and real-time success/failure feedback, and subtle animated cues prompting scrolling. Include an Upload Center with detailed inline JavaScript validation, file size limits, asynchronous uploads with live progress, interactive previews, and optional password protection for files. The Browse section should display a dynamically filterable gallery of files with cards showing previews, names, sizes, upload dates, download counts, interactive hover animations, and modals for full file previews, downloads, inline comments, sharing links, and version history. Include a My Files section where logged-in users can manage their uploads with options to rename, move, delete, or download files, track activity, and view storage usage charts implemented with inline JS and HTML canvas. Add an Analytics dashboard showing storage consumption, file types, download activity, popular files, and user engagement trends using interactive charts and tables. The Services or Features section should highlight advanced tools such as AI-powered file categorization, automated tagging, real-time duplicate detection, collaborative folders, encrypted sharing, automated backups, and file recovery options, each with interactive tabs, modal pop-ups, and embedded mini-demos demonstrating functionality with inline scripts. Include a Portfolio-like showcase for public or featured files with dynamic filtering, lightbox previews for images, video playback, audio streaming, and interactive file metadata displays. Add a Testimonials carousel with user avatars, quotes, and sliding animations, and a Pricing or Subscription section showing storage plans, tiered features, recommended plans, tooltips explaining advanced capabilities, and smooth hover animations. The Blog/News section should display multiple articles with images, excerpts, authors, categories, scroll-triggered animations, live search, and inline filtering. Include a Contact section with a fully validated form supporting text input, email, file attachments, dropdown selections, and dynamic success/failure messages with animated feedback. Implement global features including smooth anchor scrolling, sticky elements, floating action buttons for quick uploads or support, live search across the site, dynamic navigation highlights, scroll-triggered animations, interactive tooltips, inline charts, AI-driven file recommendations, predictive upload suggestions, version tracking, automated folder organization, and optional simulated chat assistant features. All HTML, CSS, and JavaScript should be deeply nested, verbose, and include realistic placeholders for content, images, icons, modals, dynamic elements, and animations. Include detailed comments explaining major blocks of code and logic, vary element structure to maximize token usage, and simulate complex multi-step pipelines for file uploads, downloads, and management. The output should be continuous, fully fleshed-out, and professional-grade, producing thousands of tokens with complex nested structures, interactive features, and multiple simultaneous workflows, ensuring the system's context management, summarization, and seamless continuation features are fully stressed and utilized.`;

app.whenReady().then(async () => {
  // ── Hidden window (required for safeStorage/DPAPI) ──
  const hiddenWin = new BrowserWindow({ show: false, width: 1, height: 1 });
  const modelName = path.basename(modelPath);

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  STRESS TEST (exact IDE pipeline) — Model: ${modelName}`);
  console.log(`${'═'.repeat(80)}\n`);

  // ══════════════════════════════════════════════════════════════════════
  // IDENTICAL to electron-main.js lines 123-265 — Brand, Globals, Services, Wiring
  // ══════════════════════════════════════════════════════════════════════

  // Brand identity (same as electron-main.js)
  const _B = { n: '\x67\x75\x49\x44\x45', a: '\x42\x72\x65\x6e\x64\x61\x6e\x20\x47\x72\x61\x79', g: '\x46\x69\x6c\x65\x53\x68\x6f\x74', y: '2025-2026' };

  // Globals (same paths as real app)
  const isDev = true;
  const appBasePath = __dirname;
  const userDataPath = app.getPath('userData');
  const modelsBasePath = __dirname;

  // Service instances — IDENTICAL to electron-main.js lines 141-170
  const llmEngine = new LLMEngine();
  let agenticCancelled = false;
  const modelManager = new ModelManager(modelsBasePath);
  const ragEngine = new RAGEngine();
  const terminalManager = new TerminalManager();
  const webSearch = new WebSearch();
  const browserManager = new BrowserManager();
  const playwrightBrowser = new PlaywrightBrowser();
  const memoryStore = new MemoryStore(userDataPath);  // real app uses userDataPath
  const cloudLLM = new CloudLLMService();
  const imageGen = new ImageGenerationService();
  const localImageEngine = new LocalImageEngine();
  const gitManager = new GitManager();
  const licenseManager = new LicenseManager();
  licenseManager.loadLicense();  // same as electron-main.js
  cloudLLM.setLicenseManager(licenseManager);  // same as electron-main.js
  const debugService = new DebugService();

  // MCPToolServer wiring — IDENTICAL to electron-main.js lines 167-177
  const mcpToolServer = new MCPToolServer({ webSearch, ragEngine, terminalManager });
  mcpToolServer.setPlaywrightBrowser(playwrightBrowser);
  mcpToolServer.setBrowserManager(browserManager);
  mcpToolServer.setGitManager(gitManager);
  mcpToolServer.setImageGen(imageGen);

  // Wire TODO updates — mock version that logs
  mcpToolServer.onTodoUpdate = (todos) => {
    const summary = todos.map(t => `  [${t.status}] ${t.text}`).join('\n');
    console.log(`\n[TODO]\n${summary}`);
  };

  // Wire subagent spawning — same as electron-main.js
  mcpToolServer._spawnSubagent = async (goal, context) => {
    const subPrompt = `You are a subagent. Complete this task:\n\nGOAL: ${goal}\n\nCONTEXT: ${context || 'None provided'}\n\nRespond with the result of your work.`;
    const result = await cloudLLM.chat([{ role: 'user', content: subPrompt }], { maxTokens: 2000 });
    return result?.text || result?.content || 'Subagent completed without response';
  };

  // Auto-approve permissions — same as electron-main.js
  mcpToolServer.onPermissionRequest = null;

  // Path validator — same as electron-main.js
  let currentProjectPath = 'C:\\Users\\brend\\Desktop';
  const isPathAllowed = createPathValidator(appBasePath, modelsBasePath, () => currentProjectPath);

  // Settings manager — IDENTICAL to electron-main.js (uses real userDataPath)
  const { _readConfig, _writeConfig } = createSettingsManager(userDataPath);

  // ── Telemetry capture (replaces real mainWindow.webContents.send) ──
  let toolLog = [];
  let tokenChunks = [];
  let totalTokenChars = 0;
  let writeFileCalls = 0;
  let allToolCalls = 0;
  let thinkingChars = 0;
  let iterationCount = 0;
  let contextEvents = [];
  const startTime = Date.now();

  const mockMainWindow = {
    webContents: {
      isDestroyed: () => false,
      send: (channel, data) => {
        if (channel === 'llm-token') {
          process.stdout.write(String(data || ''));
          tokenChunks.push(data);
          totalTokenChars += (String(data || '')).length;
        } else if (channel === 'tool-executing') {
          const toolName = data?.tool || 'unknown';
          const params = JSON.stringify(data?.params || {}).substring(0, 200);
          console.log(`\n  ► [TOOL] ${toolName} ${params}`);
          toolLog.push({ tool: toolName, params: data?.params, time: Date.now() - startTime });
          allToolCalls++;
          if (toolName === 'write_file') writeFileCalls++;
        } else if (channel === 'agentic-progress') {
          iterationCount = data?.iteration || iterationCount;
          console.log(`  ⟳ [ITERATION ${data?.iteration}/${data?.maxIterations}]`);
        } else if (channel === 'llm-thinking-token') {
          thinkingChars += (String(data || '')).length;
        } else if (channel === 'context-usage') {
          contextEvents.push({ ...data, time: Date.now() - startTime });
          const pct = data?.total ? Math.round((data.used / data.total) * 100) : '?';
          console.log(`  [CTX] ${data?.used}/${data?.total} (${pct}%)`);
        }
      },
    },
    isDestroyed: () => false,
  };

  // ── Shared Context Object — IDENTICAL to electron-main.js lines 205-240 ──
  const ctx = {
    getMainWindow: () => mockMainWindow,
    get currentProjectPath() { return currentProjectPath; },
    set currentProjectPath(v) { currentProjectPath = v; },
    get agenticCancelled() { return agenticCancelled; },
    set agenticCancelled(v) { agenticCancelled = v; },

    appBasePath, userDataPath, modelsBasePath, isDev,
    isPathAllowed, _readConfig, _writeConfig,
    encryptApiKey, decryptApiKey, loadSavedApiKeys,

    llmEngine, modelManager, ragEngine, terminalManager,
    webSearch, browserManager, playwrightBrowser,
    memoryStore, cloudLLM, imageGen, localImageEngine, gitManager, licenseManager,
    debugService, mcpToolServer, ConversationSummarizer,

    _truncateResult, _detectGPU, getCpuUsage,
    DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, DEFAULT_CHAT_PREAMBLE, _B,

    createWindow: () => {},
    autoIndexProject: async () => {},
    scheduleIncrementalReindex: () => {},
  };

  // ── Register ALL IPC Handlers — IDENTICAL order to electron-main.js lines 244-272 ──
  registerSettingsHandlers(ctx);
  registerFileSystem(ctx);
  registerDialogs(ctx);
  registerTerminal(ctx);
  registerLicense(ctx);
  registerGit(ctx);
  registerMemory(ctx);
  registerBrowser(ctx);
  registerLlm(ctx);
  registerModels(ctx);
  registerRag(ctx);
  registerMcp(ctx);
  registerDebug(ctx);
  registerAgents(ctx);
  registerCloudLlm(ctx);
  registerEditor(ctx);
  registerUtility(ctx);
  registerImageGen(ctx);
  registerBenchmark(ctx);
  registerTemplates(ctx);
  registerTodoTree(ctx);
  registerLiveServer(ctx);
  registerRestClient(ctx);
  registerAgenticChat(ctx);

  // ── Service Initialization — same as electron-main.js initializeServices() ──
  await Promise.all([
    memoryStore.initialize(),
    Promise.resolve(loadSavedApiKeys(userDataPath, cloudLLM)),
  ]);

  // Load GPU preference from saved settings (same as electron-main.js)
  try {
    const config = _readConfig();
    if (config?.userSettings?.gpuPreference) {
      llmEngine.setGPUPreference(config.userSettings.gpuPreference);
    }
    if (typeof config?.userSettings?.requireMinContextForGpu === 'boolean') {
      llmEngine.setRequireMinContextForGpu(config.userSettings.requireMinContextForGpu);
    }
  } catch (_) {}

  // Set project path on mcpToolServer (same as real app when user opens a folder)
  mcpToolServer.projectPath = currentProjectPath;

  // ══════════════════════════════════════════════════════════════════════
  // TEST EXECUTION
  // ══════════════════════════════════════════════════════════════════════

  // ── Load model ──
  console.log(`Loading model: ${modelPath}`);
  try {
    await llmEngine.initialize(modelPath);
    console.log('Model loaded.\n');
  } catch (e) {
    console.error(`FAILED to load model: ${e.message}`);
    app.quit();
    return;
  }

  // ── Use the captured ai-chat handler ──
  const aiChatHandler = _capturedHandlers['ai-chat'];
  if (!aiChatHandler) {
    console.error('FATAL: ai-chat handler was not captured. Handler registration failed.');
    console.error('Captured handlers:', Object.keys(_capturedHandlers).join(', '));
    app.quit();
    return;
  }

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`  PROMPT: File-sharing website stress test (~${TEST_PROMPT.length} chars)`);
  console.log(`${'─'.repeat(80)}\n`);

  // Reset session before test
  try { await llmEngine.resetSession(); } catch {}
  mcpToolServer._todos = [];
  mcpToolServer._todoNextId = 1;

  // Clean up any previous test files on desktop
  const DESKTOP = 'C:\\Users\\brend\\Desktop';
  try {
    const oldTestFiles = fs.readdirSync(DESKTOP).filter(f => /\.(html?|txt|md)$/i.test(f));
    for (const f of oldTestFiles) {
      try { fs.unlinkSync(path.join(DESKTOP, f)); } catch {}
    }
  } catch {}

  try {
    // Invoke the ai-chat handler the same way Electron IPC does
    const fakeEvent = { sender: mockMainWindow.webContents };
    const testContext = {
      maxIterations: 8,
      conversationHistory: [],
      params: { seed: 42, temperature: 0 },
    };

    const result = await aiChatHandler(fakeEvent, TEST_PROMPT, testContext);

    console.log(`\n[HANDLER RESULT] success=${result?.success}, error=${result?.error || 'none'}`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const fullResponse = tokenChunks.join('');

    console.log(`\n\n${'═'.repeat(80)}`);
    console.log(`  RESULTS — ${modelName}`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`  Duration:       ${elapsed}s`);
    console.log(`  Response chars: ${totalTokenChars}`);
    console.log(`  Thinking chars: ${thinkingChars}`);
    console.log(`  Iterations:     ${iterationCount}`);
    console.log(`  Tool calls:     ${allToolCalls}`);
    console.log(`  write_file:     ${writeFileCalls}`);
    console.log(`  Tools used:     ${[...new Set(toolLog.map(t => t.tool))].join(', ') || 'none'}`);
    console.log(`  Context events: ${contextEvents.length}`);
    if (contextEvents.length > 0) {
      const last = contextEvents[contextEvents.length - 1];
      console.log(`  Last ctx usage: ${last.used}/${last.total} (${Math.round((last.used/last.total)*100)}%)`);
    }

    // Check for file creation
    const allDesktopFiles = fs.readdirSync(DESKTOP);
    const htmlFiles = allDesktopFiles.filter(f => /\.html?$/i.test(f));
    const recentFiles = allDesktopFiles.filter(f => {
      try {
        const st = fs.statSync(path.join(DESKTOP, f));
        return (Date.now() - st.mtimeMs) < 300000; // created in last 5 min
      } catch { return false; }
    });

    console.log(`\n  Files on desktop: ${recentFiles.length > 0 ? recentFiles.join(', ') : 'NONE'}`);

    if (recentFiles.length > 0) {
      for (const fname of recentFiles) {
        const filePath = path.join(DESKTOP, fname);
        const content = fs.readFileSync(filePath, 'utf8');
        console.log(`\n  FILE: ${fname} (${content.length} chars)`);
        const hasHtml = /<html/i.test(content);
        const hasStyle = /<style/i.test(content);
        const hasScript = /<script/i.test(content);
        const hasForm = /<form/i.test(content);
        console.log(`    <html>: ${hasHtml}  <style>: ${hasStyle}  <script>: ${hasScript}  <form>: ${hasForm}`);
      }
    }

    // Quality checks on the streamed response
    const hasRawHtmlDump = /<html[\s>]/i.test(fullResponse) && !fullResponse.includes('```json') && fullResponse.length > 2000;
    const hasSasContamination = /sas marketplace/i.test(fullResponse);
    const hasWriteFileCall = writeFileCalls > 0;
    const continuationFired = iterationCount > 1;

    console.log(`\n  QUALITY CHECKS:`);
    console.log(`  [1] write_file called:       ${hasWriteFileCall ? 'YES' : 'NO — model did not use file tool'}`);
    console.log(`  [2] Continuation fired:      ${continuationFired ? `YES (${iterationCount} iterations)` : 'NO — single iteration only'}`);
    console.log(`  [3] Context mgmt engaged:    ${contextEvents.length > 0 ? `YES (${contextEvents.length} events)` : 'NO events captured'}`);
    console.log(`  [4] No SAS contamination:    ${hasSasContamination ? 'FAIL — SAS content found' : 'PASS'}`);
    console.log(`  [5] No raw HTML in chat:     ${hasRawHtmlDump ? 'FAIL — raw HTML dumped' : 'PASS'}`);
    console.log(`  [6] File written to disk:    ${recentFiles.length > 0 ? 'YES' : 'NO'}`);

    // Full response text for manual coherence review
    console.log(`\n  RESPONSE TEXT (first 1000 chars):`);
    console.log(`  ${fullResponse.substring(0, 1000).replace(/\n/g, '\n  ')}`);
    if (fullResponse.length > 1000) {
      console.log(`\n  ... (${fullResponse.length - 1000} more chars)`);
    }

    console.log(`\n${'═'.repeat(80)}\n`);

  } catch (e) {
    console.error(`\nTEST FAILED WITH ERROR: ${e.message}\n${e.stack}`);
  }

  // Clean up
  try { await llmEngine.dispose(); } catch {}
  app.quit();
});
