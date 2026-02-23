/**
 * Production Test Harness v2 — runs the agentic chat through the ACTUAL IDE infrastructure.
 * Launched via: npx electron test-harness.js [mode] [count] [--category=...] [--deterministic]
 * 
 * Modes:
 *   local          — Qwen3 0.6B local model
 *   local-4b       — Qwen3 4B Thinking 2507 (Q8)
 *   local-30b      — Qwen3 Coder 30B A3B
 *   cerebras-70b   — Cerebras Llama 3.3 70B  
 *   cerebras-120b  — Cerebras GPT-OSS 120B
 *
 * Options:
 *   --deterministic     Force seed=42, temperature=0 (default for local modes)
 *   --category=cat1,cat2  Run only specific categories:
 *       explicit, vague, multi-step, coding, chat, duplicate
 *   [number]            Run first N tests (default: all matching)
 *
 * Model stays loaded for all tests. Runs tests sequentially.
 * This script creates a hidden Electron window (required for safeStorage/DPAPI),
 * instantiates ALL real services identical to electron-main.js, and invokes the
 * ai-chat handler with the test prompt. Zero mocks on the hot path.
 */
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsSync = require('fs');

// ── Parse CLI ──
const VALID_MODES = ['local', 'local-4b', 'local-30b', 'cerebras-70b', 'cerebras-120b'];
const mode = process.argv.find(a => VALID_MODES.includes(a)) || 'cerebras-70b';
const isLocal = mode.startsWith('local');
const forceDeterministic = process.argv.includes('--deterministic') || isLocal;
const categoryArg = (process.argv.find(a => a.startsWith('--category=')) || '').replace('--category=', '');
const selectedCategories = categoryArg ? categoryArg.split(',').map(c => c.trim()) : null;
const countArg = process.argv.find(a => /^\d+$/.test(a));

// ── Prevent GPU sandbox crashes in headless test ──
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-gpu');

// ── Services (same as electron-main.js) ──
const { LLMEngine } = require('./main/llmEngine');
const { MCPToolServer } = require('./main/mcpToolServer');
const { PlaywrightBrowser } = require('./main/playwrightBrowser');
const { BrowserManager } = require('./main/browserManager');
const { CloudLLMService } = require('./main/cloudLLMService');
const { WebSearch } = require('./main/webSearch');
const { RAGEngine } = require('./main/ragEngine');
const { MemoryStore } = require('./main/memoryStore');
const { TerminalManager } = require('./main/terminalManager');
const { ConversationSummarizer } = require('./main/conversationSummarizer');
const { ImageGenerationService } = require('./main/imageGenerationService');
const { DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE } = require('./main/constants');
const { _truncateResult } = require('./main/mainUtils');
const { encryptApiKey, decryptApiKey, loadSavedApiKeys } = require('./main/apiKeyStore');
const { register: registerAgenticChat } = require('./main/agenticChat');

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE — 32 categorized prompts across 6 categories
// ─────────────────────────────────────────────────────────────────────────────
const TEST_SUITE = [
  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 1: EXPLICIT — Clear tool-calling tasks (search + save)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'E1', category: 'explicit',
    prompt: 'Search for the top 3 pizza places in Dallas Texas and save their names, ratings, and websites to a file on my desktop.',
    verify: 'file',
    keywords: ['pizza', 'restaurant', 'dallas', 'rating'],
    contentKeywords: /pizza|restaurant|food|yelp|dallas/i,
  },
  {
    id: 'E2', category: 'explicit',
    prompt: 'Look up the current weather in New York City and save a summary to a file on my desktop.',
    verify: 'file',
    keywords: ['weather', 'new york', 'temperature'],
    contentKeywords: /weather|temperature|forecast|degree|humid|wind|°|cloudy|sunny|rain/i,
  },
  {
    id: 'E3', category: 'explicit',
    prompt: 'Find 3 popular Python libraries for web scraping and save their names, descriptions, and URLs to a file on my desktop.',
    verify: 'file',
    keywords: ['python', 'scraping', 'library'],
    contentKeywords: /python|scraping|beautifulsoup|scrapy|selenium|requests|library|pip/i,
  },
  {
    id: 'E4', category: 'explicit',
    prompt: 'Search for the 5 tallest buildings in the world and save their names, heights, and locations to a file on my desktop.',
    verify: 'file',
    keywords: ['building', 'tall', 'height'],
    contentKeywords: /burj|tower|building|meters|feet|tall|shanghai|skyscraper/i,
  },
  {
    id: 'E5', category: 'explicit',
    prompt: 'Find the top 3 best-selling books right now and save a summary of each to my desktop.',
    verify: 'file',
    keywords: ['book', 'best-selling'],
    contentKeywords: /book|author|bestsell|novel|fiction|nonfiction|publish/i,
  },
  {
    id: 'E6', category: 'explicit',
    prompt: 'Search for 3 free online courses about machine learning and save the course names, platforms, and links to my desktop.',
    verify: 'file',
    keywords: ['course', 'machine learning'],
    contentKeywords: /machine.?learning|course|coursera|edx|udemy|khan|stanford|free/i,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 2: VAGUE — Requires tool inference (no mention of search/save)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'V1', category: 'vague',
    prompt: 'I need to know what programming language to learn in 2025 — give me the top 3 choices with pros and cons, and keep a copy for me.',
    verify: 'file',
    keywords: ['programming', 'language', '2025'],
    contentKeywords: /python|javascript|rust|typescript|go|java|programming|language/i,
  },
  {
    id: 'V2', category: 'vague',
    prompt: 'What are some good hiking trails near Denver? I want the details saved somewhere I can find them.',
    verify: 'file',
    keywords: ['hiking', 'trail', 'denver'],
    contentKeywords: /trail|hik|denver|colorado|mountain|mile|elevation/i,
  },
  {
    id: 'V3', category: 'vague',
    prompt: "I'm planning a trip to Tokyo. What should I know? Put together a guide for me.",
    verify: 'file',
    keywords: ['tokyo', 'travel', 'guide'],
    contentKeywords: /tokyo|japan|travel|temple|food|yen|shinkansen|shibuya|transport/i,
  },
  {
    id: 'V4', category: 'vague',
    prompt: 'Help me understand the differences between React, Vue, and Angular. I want to compare them side by side.',
    verify: 'file',
    keywords: ['react', 'vue', 'angular'],
    contentKeywords: /react|vue|angular|framework|component|virtual.?dom|typescript/i,
  },
  {
    id: 'V5', category: 'vague',
    prompt: "What's happening in AI research this week? Compile a brief for me.",
    verify: 'file',
    keywords: ['AI', 'research'],
    contentKeywords: /ai|artificial|intelligence|model|research|paper|llm|neural|gpt|transformer/i,
  },
  {
    id: 'V6', category: 'vague',
    prompt: 'Which US National Parks have the best stargazing? Get me the info.',
    verify: 'file',
    keywords: ['national park', 'stargazing'],
    contentKeywords: /national.?park|stargaz|dark.?sky|yellowstone|zion|yosemite|grand.?canyon|sky|night/i,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 3: MULTI-STEP — Complex tasks needing 3+ sequential tool calls
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'M1', category: 'multi-step',
    prompt: 'Compare the weather in New York, London, and Tokyo right now. Then find a popular restaurant in whichever city has the best weather. Save everything to a report on my desktop.',
    verify: 'file',
    keywords: ['weather', 'restaurant', 'report'],
    contentKeywords: /weather|temperature|restaurant|new.?york|london|tokyo/i,
    minTools: 3,
  },
  {
    id: 'M2', category: 'multi-step',
    prompt: 'Research the top 3 electric cars of 2025, find their prices and range. Then search for charging stations in Los Angeles. Compile everything into a comprehensive report on my desktop.',
    verify: 'file',
    keywords: ['electric car', 'charging', 'los angeles'],
    contentKeywords: /electric|ev|tesla|charging|range|miles|los.?angeles|price/i,
    minTools: 3,
  },
  {
    id: 'M3', category: 'multi-step',
    prompt: 'Build me a study guide: find the 5 most important topics in computer science for job interviews, research each one, and save a detailed guide with examples to my desktop.',
    verify: 'file',
    keywords: ['computer science', 'interview', 'study'],
    contentKeywords: /algorithm|data.?structure|interview|computer.?science|binary|sort|hash|tree|system.?design/i,
    minTools: 2,
  },
  {
    id: 'M4', category: 'multi-step',
    prompt: 'I want to plan a weekend in San Francisco — find the top 5 attractions, current weather, best restaurants nearby, and create a complete itinerary saved to my desktop.',
    verify: 'file',
    keywords: ['san francisco', 'itinerary'],
    contentKeywords: /san.?francisco|golden.?gate|alcatraz|fisherman|pier|weather|restaurant|itinerary/i,
    minTools: 3,
  },
  {
    id: 'M5', category: 'multi-step',
    prompt: 'Research 3 different web frameworks, find a tutorial for each, compare their GitHub stars and community size, and write a recommendation report on my desktop.',
    verify: 'file',
    keywords: ['framework', 'tutorial', 'github'],
    contentKeywords: /framework|react|next|svelte|django|express|tutorial|github|star|community/i,
    minTools: 3,
  },
  {
    id: 'M6', category: 'multi-step',
    prompt: "Find today's top 3 tech news stories, summarize each one, look up the companies mentioned, and create a briefing document on my desktop.",
    verify: 'file',
    keywords: ['tech', 'news', 'briefing'],
    contentKeywords: /tech|news|company|announce|launch|release|apple|google|microsoft|nvidia|ai|update/i,
    minTools: 2,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 4: CODING — HTML/game/website generation tasks
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'C1', category: 'coding',
    prompt: 'Create an HTML page with a Tic-Tac-Toe game I can play in my browser. Save it to my desktop.',
    verify: 'html',
    keywords: ['tic-tac-toe', 'game'],
    htmlRequirements: { minLength: 500, mustContain: [/<html/i, /<script/i], contentPatterns: [/tic|tac|toe|cell|grid|board|click|win|draw|player/i] },
  },
  {
    id: 'C2', category: 'coding',
    prompt: 'Build me a personal portfolio website with sections for About, Projects, and Contact. Save the HTML file to my desktop.',
    verify: 'html',
    keywords: ['portfolio', 'website'],
    htmlRequirements: { minLength: 500, mustContain: [/<html/i, /<style/i], contentPatterns: [/about|project|contact|portfolio/i] },
  },
  {
    id: 'C3', category: 'coding',
    prompt: 'Create a snake game in HTML and JavaScript that I can play with arrow keys. Save it to my desktop.',
    verify: 'html',
    keywords: ['snake', 'game'],
    htmlRequirements: { minLength: 500, mustContain: [/<html/i, /<script/i, /<canvas/i], contentPatterns: [/snake|canvas|key|arrow|score|game/i] },
  },
  {
    id: 'C4', category: 'coding',
    prompt: 'Write a calculator app in HTML with CSS styling that works for basic math operations. Save it to my desktop.',
    verify: 'html',
    keywords: ['calculator', 'math'],
    htmlRequirements: { minLength: 400, mustContain: [/<html/i], contentPatterns: [/calculator|button|display|equal|add|subtract|multiply|divide|\+|\-|\*/i] },
  },
  {
    id: 'C5', category: 'coding',
    prompt: "Create a landing page for a coffee shop called 'Bean There' with a menu section and contact form. Save it to my desktop.",
    verify: 'html',
    keywords: ['coffee', 'landing page', 'bean there'],
    htmlRequirements: { minLength: 500, mustContain: [/<html/i, /<form/i], contentPatterns: [/bean.?there|coffee|menu|contact|form|espresso|latte/i] },
  },
  {
    id: 'C6', category: 'coding',
    prompt: 'Build an interactive to-do list app in HTML/CSS/JS that lets me add, complete, and delete tasks. Save it to my desktop.',
    verify: 'html',
    keywords: ['to-do', 'app'],
    htmlRequirements: { minLength: 400, mustContain: [/<html/i, /<script/i], contentPatterns: [/todo|task|add|delete|complete|check|list/i] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 5: CHAT — Should NOT trigger tool calls (validates hard gate)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'T1', category: 'chat',
    prompt: 'Hi, how are you?',
    verify: 'no-tools',
    responseKeywords: /hi|hello|hey|doing|great|good|help|assist/i,
    maxToolCalls: 0,
  },
  {
    id: 'T2', category: 'chat',
    prompt: 'What is the capital of France?',
    verify: 'no-tools',
    responseKeywords: /paris/i,
    maxToolCalls: 0,
  },
  {
    id: 'T3', category: 'chat',
    prompt: 'Explain what recursion is in simple terms.',
    verify: 'no-tools',
    responseKeywords: /recurs|function|call|itself|base.?case/i,
    maxToolCalls: 0,
  },
  {
    id: 'T4', category: 'chat',
    prompt: 'Thanks for the help!',
    verify: 'no-tools',
    responseKeywords: /welcome|glad|help|anytime|happy/i,
    maxToolCalls: 0,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 6: DUPLICATE TOOL — Same tool called multiple times w/ diff params
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'D1', category: 'duplicate',
    prompt: 'Search for the best restaurants in both New York and Los Angeles and save the combined results to my desktop.',
    verify: 'file',
    keywords: ['restaurant', 'new york', 'los angeles'],
    contentKeywords: /restaurant|new.?york|los.?angeles|food|dining/i,
    minSearchCalls: 2,
  },
  {
    id: 'D2', category: 'duplicate',
    prompt: 'Look up the weather in Miami, Chicago, and Seattle. Save all three forecasts to one file on my desktop.',
    verify: 'file',
    keywords: ['weather', 'miami', 'chicago', 'seattle'],
    contentKeywords: /weather|miami|chicago|seattle|temperature|forecast|degree/i,
    minSearchCalls: 2,
  },
  {
    id: 'D3', category: 'duplicate',
    prompt: 'Find the top-rated coffee shops in Portland, Austin, and Nashville. Compare them in a file on my desktop.',
    verify: 'file',
    keywords: ['coffee', 'portland', 'austin', 'nashville'],
    contentKeywords: /coffee|portland|austin|nashville|shop|cafe|rating/i,
    minSearchCalls: 2,
  },
  {
    id: 'D4', category: 'duplicate',
    prompt: 'Research Python, JavaScript, and Rust — find the latest version and community size for each. Save to my desktop.',
    verify: 'file',
    keywords: ['python', 'javascript', 'rust'],
    contentKeywords: /python|javascript|rust|version|community|developer|release/i,
    minSearchCalls: 2,
  },
];

// ── Filter tests by selected categories ──
let activeTests = selectedCategories
  ? TEST_SUITE.filter(t => selectedCategories.includes(t.category))
  : [...TEST_SUITE];
const TEST_COUNT = countArg ? Math.min(parseInt(countArg), activeTests.length) : activeTests.length;
activeTests = activeTests.slice(0, TEST_COUNT);

// ── Telemetry (reset per test) ──
let toolLog = [];
let tokenChunks = [];
let totalTokens = 0;
let startWall = Date.now();
let thinkTokenChars = 0; // Track thinking token verbosity
const allResults = []; // Accumulates pass/fail across all tests

// ── Intercept ipcMain.handle to capture the ai-chat handler ──
const _capturedHandlers = {};
const _originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  _capturedHandlers[channel] = handler;
  // Still register it normally so other code can find it
  try { _originalHandle(channel, handler); } catch (_) {}
};

app.whenReady().then(async () => {
  // Hidden window — required for safeStorage (DPAPI needs a window context on Windows)
  const hiddenWin = new BrowserWindow({ show: false, width: 1, height: 1 });

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  PRODUCTION TEST HARNESS v2 — Mode: ${mode}, Tests: ${TEST_COUNT}`);
  console.log(`  Deterministic: ${forceDeterministic}, Categories: ${selectedCategories ? selectedCategories.join(', ') : 'ALL'}`);
  console.log(`  Total prompts: ${activeTests.length} (${[...new Set(activeTests.map(t => t.category))].join(', ')})`);
  console.log(`${'═'.repeat(80)}\n`);

  // ── Instantiate all real services (identical to electron-main.js) ──
  const llmEngine = new LLMEngine();
  const cloudLLM = new CloudLLMService();
  const webSearch = new WebSearch();
  const ragEngine = new RAGEngine();
  const terminalManager = new TerminalManager();
  const browserManager = new BrowserManager();
  const playwrightBrowser = new PlaywrightBrowser();
  const memoryStore = new MemoryStore(__dirname);
  const imageGen = new ImageGenerationService();
  const mcpToolServer = new MCPToolServer({ webSearch, ragEngine, terminalManager });
  mcpToolServer.setPlaywrightBrowser(playwrightBrowser);
  mcpToolServer.setBrowserManager(browserManager);
  mcpToolServer.setImageGen(imageGen);
  mcpToolServer.projectPath = 'C:\\Users\\brend\\Desktop';

  // Wire TODO updates
  mcpToolServer.onTodoUpdate = (todos) => {
    const summary = todos.map(t => `  [${t.status}] ${t.text}`).join('\n');
    console.log(`\n[TODO UPDATE]\n${summary}\n`);
  };
  mcpToolServer.onPermissionRequest = null; // Auto-approve

  // ── Load API keys from encrypted config (uses real safeStorage/DPAPI) ──
  loadSavedApiKeys(__dirname, cloudLLM);

  // ── Mock mainWindow that captures all IPC output ──
  const mockMainWindow = {
    webContents: {
      send: (channel, data) => {
        if (channel === 'llm-token') {
          process.stdout.write(String(data || ''));
          tokenChunks.push(data);
          totalTokens += (String(data || '')).length;
        } else if (channel === 'tool-executing') {
          const toolName = data?.tool || 'unknown';
          const params = JSON.stringify(data?.params || {}).substring(0, 300);
          console.log(`\n  ► [TOOL] ${toolName} ${params}`);
          toolLog.push({ tool: toolName, params: data?.params, time: Date.now() - startWall });
        } else if (channel === 'mcp-tool-results') {
          console.log(`  ◄ [TOOL RESULT]`);
        } else if (channel === 'agentic-progress') {
          console.log(`  ⟳ [ITERATION ${data?.iteration}/${data?.maxIterations}]`);
        } else if (channel === 'todo-update') {
          // Already handled via mcpToolServer.onTodoUpdate
        } else if (channel === 'llm-thinking-token') {
          thinkTokenChars += (String(data || '')).length;
        } else {
          // Log other events for debugging
          console.log(`  [IPC:${channel}]`);
        }
      },
    },
    isDestroyed: () => false,
  };

  // ── Build ctx identical to electron-main.js ──
  let agenticCancelled = false;
  const ctx = {
    getMainWindow: () => mockMainWindow,
    get currentProjectPath() { return 'C:\\Users\\brend\\Desktop'; },
    set currentProjectPath(_) {},
    get agenticCancelled() { return agenticCancelled; },
    set agenticCancelled(v) { agenticCancelled = v; },

    appBasePath: __dirname,
    modelsBasePath: __dirname,
    isDev: true,
    isPathAllowed: () => true,
    _readConfig: (key) => {
      try {
        const config = JSON.parse(fsSync.readFileSync(path.join(__dirname, '.guide-config.json'), 'utf8'));
        return config[key];
      } catch { return null; }
    },
    _writeConfig: () => {},

    llmEngine, cloudLLM, mcpToolServer, playwrightBrowser, browserManager,
    ragEngine, memoryStore, webSearch, ConversationSummarizer, imageGen,
    DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, _truncateResult,
    _detectGPU: async () => ({ hasGPU: false, gpuName: 'test' }),
    getCpuUsage: () => 0,
    licenseManager: { isLicensed: () => true, checkFeature: () => true },
    encryptApiKey, decryptApiKey, loadSavedApiKeys,
    _B: { n: 'guIDE', a: 'Brendan Gray', g: 'FileShot', y: '2025-2026' },
  };

  // ── Register agentic chat handler (captures it via ipcMain.handle) ──
  registerAgenticChat(ctx);

  // ── Prepare model/provider based on mode ──
  let baseContext = {};

  if (mode === 'local' || mode === 'local-4b' || mode === 'local-30b') {
    const modelPaths = {
      'local': 'd:/models/models/Qwen3-0.6B-Q8_0.gguf',
      'local-4b': 'd:/models/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
      'local-30b': 'd:/models/models/Qwen3-Coder-30B-A3B-Instruct-Q4_K_S.gguf',
    };
    const modelPath = modelPaths[mode];
    console.log(`Loading local model: ${modelPath}`);
    try {
      await llmEngine.initialize(modelPath);
      console.log('Model loaded successfully.\n');
    } catch (e) {
      console.error(`Failed to load model: ${e.message}`);
      app.quit();
      return;
    }
    baseContext = {
      maxIterations: 30,
      ...(forceDeterministic ? { params: { seed: 42, temperature: 0 } } : {}),
    };
  } else if (mode === 'cerebras-70b') {
    const status = cloudLLM.getPoolStatus('cerebras');
    console.log(`Cerebras pool: ${status?.totalKeys || 0} keys, ${status?.availableKeys || 0} available`);
    baseContext = {
      cloudProvider: 'cerebras',
      cloudModel: 'zai-glm-4.7',
      maxIterations: 30,
      params: { maxTokens: 4096, temperature: forceDeterministic ? 0 : 0.7 },
    };
  } else if (mode === 'cerebras-120b') {
    const status = cloudLLM.getPoolStatus('cerebras');
    console.log(`Cerebras pool: ${status?.totalKeys || 0} keys, ${status?.availableKeys || 0} available`);
    baseContext = {
      cloudProvider: 'cerebras',
      cloudModel: 'gpt-oss-120b',
      maxIterations: 30,
      params: { maxTokens: 4096, temperature: forceDeterministic ? 0 : 0.7 },
    };
  }

  // ── Verification helpers ──
  const DESKTOP = 'C:\\Users\\brend\\Desktop';

  function findDesktopFile(ext) {
    try {
      const pattern = ext ? new RegExp(`\\.${ext}$`, 'i') : /\.(txt|md|json|csv|html|htm)$/i;
      const files = fs.readdirSync(DESKTOP).filter(f => pattern.test(f));
      // Return the most recently modified matching file
      let best = null, bestTime = 0;
      for (const f of files) {
        const st = fs.statSync(path.join(DESKTOP, f));
        if (st.mtimeMs > bestTime) { bestTime = st.mtimeMs; best = f; }
      }
      return best;
    } catch { return null; }
  }

  function clearDesktopFiles() {
    try {
      const files = fs.readdirSync(DESKTOP).filter(f => /\.(txt|md|json|csv|html|htm)$/i.test(f));
      for (const f of files) fs.unlinkSync(path.join(DESKTOP, f));
    } catch {}
  }

  // ── Verify a text/markdown file has relevant content ──
  function verifyFileContent(filePath, testDef) {
    const issues = [];
    if (!fs.existsSync(filePath)) return { pass: false, issues: ['File does not exist'] };
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content || content.length < 50) issues.push(`Content too short (${content.length} chars)`);
    // Check for completion guarantee dump (fallback header — model failed to write the file itself)
    if (content.startsWith('# Research Results\n*Compiled ')) issues.push('File was written by completion guarantee fallback, not the model');
    // Check for placeholder/fabricated content
    if (/\[.*name.*\]|\[.*insert.*\]|example\.com|placeholder/i.test(content)) issues.push('Contains placeholder/fabricated content');
    // Content-specific keyword check
    if (testDef.contentKeywords && !testDef.contentKeywords.test(content)) {
      issues.push(`Content missing expected keywords (${testDef.contentKeywords})`);
    }
    const urlCount = (content.match(/https?:\/\/[^\s"'<>]+/g) || []).length;
    const hasStructure = /\d[.)\-]\s|\*\*|^#+\s/m.test(content);
    // Weather data doesn't need URLs
    const isWeatherPrompt = /weather|forecast/i.test(testDef.prompt);
    if (content.length >= 50 && issues.length === 0 && !hasStructure && urlCount === 0 && !isWeatherPrompt) {
      issues.push('Content lacks structure and URLs — may be incoherent');
    }
    return { pass: issues.length === 0, issues, content: content.substring(0, 500), length: content.length, urlCount };
  }

  // ── Verify an HTML file has proper structure and content ──
  function verifyHtmlFile(filePath, testDef) {
    const issues = [];
    if (!fs.existsSync(filePath)) return { pass: false, issues: ['HTML file does not exist'] };
    const content = fs.readFileSync(filePath, 'utf8').trim();
    const reqs = testDef.htmlRequirements || {};
    if (content.length < (reqs.minLength || 400)) issues.push(`HTML too short (${content.length} chars, need ${reqs.minLength || 400})`);
    // Check required HTML tags
    for (const tagPattern of (reqs.mustContain || [])) {
      if (!tagPattern.test(content)) issues.push(`Missing required HTML element: ${tagPattern}`);
    }
    // Check content patterns (game logic, specific elements, etc.)
    for (const cp of (reqs.contentPatterns || [])) {
      if (!cp.test(content)) issues.push(`Missing content pattern: ${cp}`);
    }
    // Basic HTML validity check
    if (!/<html/i.test(content) && !/<body/i.test(content) && !/<div/i.test(content)) {
      issues.push('File does not appear to be valid HTML');
    }
    return { pass: issues.length === 0, issues, content: content.substring(0, 500), length: content.length };
  }

  // ── Verify no/minimal tool calls (chat category) ──
  function verifyNoTools(testDef, toolLog, responseText) {
    const issues = [];
    const maxAllowed = testDef.maxToolCalls ?? 0;
    if (toolLog.length > maxAllowed) {
      issues.push(`Expected ≤${maxAllowed} tool calls, got ${toolLog.length}: ${toolLog.map(t => t.tool).join(', ')}`);
    }
    if (testDef.responseKeywords && !testDef.responseKeywords.test(responseText)) {
      issues.push(`Response missing expected keywords (${testDef.responseKeywords})`);
    }
    if (!responseText || responseText.trim().length < 5) {
      issues.push('No meaningful response generated');
    }
    return { pass: issues.length === 0, issues, content: responseText.substring(0, 300), length: responseText.length };
  }

  // ── Run verification based on test type ──
  function runVerification(testDef, toolLog, responseText) {
    const issues = [];
    let verification;

    switch (testDef.verify) {
      case 'file': {
        const desktopFile = findDesktopFile();
        if (!desktopFile) return { pass: false, issues: ['No file found on Desktop'], file: null };
        verification = verifyFileContent(path.join(DESKTOP, desktopFile), testDef);
        verification.file = desktopFile;
        // Check minimum tool calls for multi-step and duplicate
        if (testDef.minTools && toolLog.length < testDef.minTools) {
          verification.issues.push(`Expected ≥${testDef.minTools} tool calls, got ${toolLog.length}`);
          verification.pass = false;
        }
        // Check minimum search calls for duplicate category
        if (testDef.minSearchCalls) {
          const searchCalls = toolLog.filter(t => /web_search|search/i.test(t.tool)).length;
          if (searchCalls < testDef.minSearchCalls) {
            verification.issues.push(`Expected ≥${testDef.minSearchCalls} search calls, got ${searchCalls}`);
            verification.pass = false;
          }
        }
        return verification;
      }
      case 'html': {
        const htmlFile = findDesktopFile('html') || findDesktopFile('htm');
        if (!htmlFile) {
          // Also check for .html extension in any desktop file
          const anyFile = findDesktopFile();
          if (anyFile && /\.(html|htm)$/i.test(anyFile)) {
            verification = verifyHtmlFile(path.join(DESKTOP, anyFile), testDef);
            verification.file = anyFile;
            return verification;
          }
          return { pass: false, issues: ['No HTML file found on Desktop'], file: null };
        }
        verification = verifyHtmlFile(path.join(DESKTOP, htmlFile), testDef);
        verification.file = htmlFile;
        return verification;
      }
      case 'no-tools': {
        verification = verifyNoTools(testDef, toolLog, responseText);
        verification.file = null;
        return verification;
      }
      default:
        return { pass: false, issues: [`Unknown verify type: ${testDef.verify}`], file: null };
    }
  }

  // ── Sequential test loop (model stays loaded) ──
  const handler = _capturedHandlers['ai-chat'];
  if (!handler) {
    console.error('ai-chat handler was not captured. Registration may have failed.');
    app.quit();
    return;
  }

  for (let testIdx = 0; testIdx < activeTests.length; testIdx++) {
    const testDef = activeTests[testIdx];
    const prompt = testDef.prompt;
    // Reset per-test telemetry
    toolLog = []; tokenChunks = []; totalTokens = 0; thinkTokenChars = 0; startWall = Date.now();
    clearDesktopFiles();
    // Reset model chat history (keep model loaded) and tool server state
    try { await llmEngine.resetSession(); } catch (e) { console.warn(`[HARNESS] resetSession failed: ${e.message}`); }
    mcpToolServer._todos = [];
    mcpToolServer._todoNextId = 1;

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`  TEST ${testIdx + 1}/${activeTests.length} — [${testDef.id}] ${testDef.category.toUpperCase()}`);
    console.log(`  Prompt: "${prompt}"`);
    console.log(`${'═'.repeat(80)}\n`);

    let testResult = { pass: false, reason: 'unknown', category: testDef.category, id: testDef.id };
    try {
      const fakeEvent = { sender: mockMainWindow.webContents };
      // Reset cancellation flag between tests
      agenticCancelled = false;
      // Deep-clone context per test so retry temperature drops don't persist
      const testContext = JSON.parse(JSON.stringify(baseContext));
      const result = await handler(fakeEvent, prompt, testContext);
      const elapsed = ((Date.now() - startWall) / 1000).toFixed(1);
      const uniqueTools = [...new Set(toolLog.map(t => t.tool))];
      const responseText = tokenChunks.join('');

      // ── Verify based on test type ──
      const verification = runVerification(testDef, toolLog, responseText);

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`  Duration:      ${elapsed}s`);
      console.log(`  Tool calls:    ${toolLog.length} total, ${uniqueTools.length} unique (${uniqueTools.join(', ')})`);
      const thinkEst = Math.round(thinkTokenChars / 4);
      if (thinkEst > 0) console.log(`  Think tokens:  ~${thinkEst} tokens (${thinkTokenChars} chars)`);
      if (verification.file) console.log(`  File found:    ${verification.file}`);
      console.log(`  Content len:   ${verification.length || 0} chars${verification.urlCount != null ? `, ${verification.urlCount} URLs` : ''}`);
      if (verification.content) {
        console.log(`  Preview:       ${verification.content.substring(0, 200).replace(/\n/g, '\\n')}`);
      }
      if (verification.issues?.length > 0) {
        console.log(`  Issues:        ${verification.issues.join('; ')}`);
      }
      console.log(`  VERDICT:       ${verification.pass ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`${'─'.repeat(80)}`);
      // Tool call timeline
      for (const t of toolLog) {
        console.log(`    ${(t.time / 1000).toFixed(1)}s  ${t.tool}`);
      }

      testResult = {
        pass: verification.pass,
        reason: verification.pass ? 'OK' : verification.issues.join('; '),
        elapsed, tools: uniqueTools, file: verification.file,
        category: testDef.category, id: testDef.id,
      };

    } catch (err) {
      const elapsed = ((Date.now() - startWall) / 1000).toFixed(1);
      console.error(`  TEST CRASHED — ${err.message}`);
      testResult = { pass: false, reason: `Crash: ${err.message}`, elapsed, category: testDef.category, id: testDef.id };
    }

    allResults.push({ test: testIdx + 1, prompt: prompt.substring(0, 60), ...testResult });
  }

  // ── Per-Category Summary ──
  const categories = [...new Set(allResults.map(r => r.category))];
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log(`  RESULTS BY CATEGORY`);
  console.log(`${'═'.repeat(80)}`);
  for (const cat of categories) {
    const catResults = allResults.filter(r => r.category === cat);
    const catPasses = catResults.filter(r => r.pass).length;
    console.log(`\n  ── ${cat.toUpperCase()} (${catPasses}/${catResults.length}) ${'─'.repeat(50)}`);
    for (const r of catResults) {
      console.log(`    ${r.pass ? '✅' : '❌'} [${r.id}] ${r.prompt}... (${r.elapsed || '?'}s)${r.pass ? '' : ' — ' + r.reason}`);
    }
  }

  // ── Final Summary ──
  const passes = allResults.filter(r => r.pass).length;
  const pct = ((passes / allResults.length) * 100).toFixed(0);
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  FINAL SCORE: ${passes}/${allResults.length} (${pct}%)`);
  console.log(`  Mode: ${mode} | Deterministic: ${forceDeterministic}`);
  const catSummary = categories.map(c => {
    const cr = allResults.filter(r => r.category === c);
    return `${c}: ${cr.filter(r => r.pass).length}/${cr.length}`;
  }).join(' | ');
  console.log(`  ${catSummary}`);
  console.log(`${'═'.repeat(80)}\n`);

  // Cleanup
  try { await playwrightBrowser.close?.(); } catch (_) {}
  hiddenWin.close();
  setTimeout(() => app.quit(), 2000);
});

app.on('window-all-closed', () => {
  // Don't quit on window close — we handle it explicitly
});
