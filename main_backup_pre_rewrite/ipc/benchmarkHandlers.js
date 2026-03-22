/**
 * IPC Handlers: Model Benchmark — provides test case definitions and
 * result persistence. The benchmark execution itself is orchestrated from
 * the renderer using the same aiChat/llmLoadModel/llmResetSession IPC
 * calls that the real IDE uses — ensuring identical code paths.
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// ── Pre-built test suite ──
// DESIGN PRINCIPLE: Test prompts must be REALISTIC — the way a real user would
// talk. No hand-holding, no "use tool X". The model must infer what to do.
// Only a small baseline section explicitly tests tool recognition.
const DEFAULT_TEST_CASES = [
  // ── Tool Recognition: Baseline (explicit, but still natural) ──
  {
    id: 'web-search-explicit',
    category: 'Tool Recognition',
    prompt: 'Search the web for the latest news headlines today.',
    expectedTools: ['web_search'],
    description: 'Explicit: web_search',
    maxIterations: 3,
  },
  {
    id: 'browser-navigate-explicit',
    category: 'Tool Recognition',
    prompt: 'Go to https://example.com and tell me what you see on the page.',
    expectedTools: ['browser_navigate'],
    description: 'Explicit: browser_navigate',
    maxIterations: 3,
  },
  {
    id: 'file-write-explicit',
    category: 'Tool Recognition',
    prompt: 'Create a file called test-output.txt with the content "Hello from benchmark".',
    expectedTools: ['write_file'],
    description: 'Explicit: write_file',
    maxIterations: 3,
  },
  {
    id: 'file-read-explicit',
    category: 'Tool Recognition',
    prompt: 'Read the file package.json and tell me what version the project is.',
    expectedTools: ['read_file'],
    description: 'Explicit: read_file',
    maxIterations: 3,
  },
  // ── Real-World Tasks (vague — how a real user talks) ──
  {
    id: 'web-search-vague',
    category: 'Real-World Task',
    prompt: 'I need to know the news today.',
    expectedTools: ['web_search'],
    description: 'Vague: infer web_search',
    maxIterations: 3,
  },
  {
    id: 'browser-shopping',
    category: 'Real-World Task',
    prompt: 'Can you find me a cheap laptop on eBay? I have a $100 budget.',
    expectedTools: ['web_search', 'browser_navigate'],
    description: 'Vague: infer browser for shopping',
    maxIterations: 5,
  },
  {
    id: 'run-command-implicit',
    category: 'Real-World Task',
    prompt: 'What version of Node.js do I have installed?',
    expectedTools: ['run_command'],
    description: 'Vague: infer run_command',
    maxIterations: 3,
  },
  {
    id: 'weather-check',
    category: 'Real-World Task',
    prompt: 'What\'s the weather like in New York right now?',
    expectedTools: ['web_search'],
    description: 'Vague: weather requires search',
    maxIterations: 3,
  },
  {
    id: 'restaurant-find',
    category: 'Real-World Task',
    prompt: 'Find me a good Italian restaurant in downtown LA.',
    expectedTools: ['web_search'],
    description: 'Vague: local business search',
    maxIterations: 3,
  },
  {
    id: 'save-notes',
    category: 'Real-World Task',
    prompt: 'Write me a quick to-do list for the weekend and save it as weekend-todos.md.',
    expectedTools: ['write_file'],
    description: 'Vague: infer write_file for notes',
    maxIterations: 3,
  },
  // ── Multi-step ──
  {
    id: 'search-and-save',
    category: 'Multi-step',
    prompt: 'I need a summary of the best programming languages in 2026. Look it up and save it to research.md.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Chain: web_search → write_file',
    maxIterations: 6,
  },
  {
    id: 'browse-and-extract',
    category: 'Multi-step',
    prompt: 'Go check out example.com and tell me what the main heading says.',
    expectedTools: ['browser_navigate', 'browser_snapshot'],
    description: 'Chain: navigate → snapshot',
    maxIterations: 5,
  },
  // ── Refusal Detection ──
  {
    id: 'no-refuse-browse',
    category: 'Refusal Detection',
    prompt: 'Look up laptop prices on Amazon for me.',
    expectedTools: ['web_search', 'browser_navigate'],
    refusalPatterns: ["can't browse", "don't have access", "can't access", "unable to browse", "don't have the ability", "no internet", "cannot access websites", "I'm unable", "I'm not able"],
    description: 'Should NOT refuse to browse',
    maxIterations: 3,
  },
  {
    id: 'no-refuse-search',
    category: 'Refusal Detection',
    prompt: 'What are the top trending topics on Twitter today?',
    expectedTools: ['web_search'],
    refusalPatterns: ["can't access", "don't have access", "real-time", "training data", "unable to", "I cannot browse", "I'm unable", "I don't have the ability"],
    description: 'Should NOT claim it cannot search',
    maxIterations: 3,
  },
  {
    id: 'no-refuse-file',
    category: 'Refusal Detection',
    prompt: 'Make me an HTML page with a hello world message.',
    expectedTools: ['write_file'],
    refusalPatterns: ["can't create", "unable to create", "don't have access to your filesystem", "I cannot write"],
    description: 'Should NOT refuse to write files',
    maxIterations: 3,
  },
  // ── Chat Baseline (should NOT use tools) ──
  {
    id: 'chat-greeting',
    category: 'Chat Baseline',
    prompt: 'Hello! How are you?',
    expectedTools: [],
    description: 'Natural response, no tools',
    maxIterations: 1,
  },
  {
    id: 'chat-knowledge',
    category: 'Chat Baseline',
    prompt: 'What is the capital of France?',
    expectedTools: [],
    description: 'Knowledge answer, no tools',
    maxIterations: 1,
  },
];

function register(ctx) {
  // Return the default test suite
  ipcMain.handle('benchmark-get-tests', () => DEFAULT_TEST_CASES);

  // Save benchmark results to disk for later comparison
  ipcMain.handle('benchmark-save-results', async (_, results) => {
    try {
      const resultsDir = path.join(ctx.appPath || require('electron').app.getPath('userData'), 'benchmark-results');
      await fs.mkdir(resultsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(resultsDir, `benchmark-${timestamp}.json`);
      await fs.writeFile(filePath, JSON.stringify(results, null, 2));
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Load past benchmark results
  ipcMain.handle('benchmark-load-results', async () => {
    try {
      const resultsDir = path.join(ctx.appPath || require('electron').app.getPath('userData'), 'benchmark-results');
      await fs.mkdir(resultsDir, { recursive: true });
      const files = await fs.readdir(resultsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse();
      const results = [];
      for (const file of jsonFiles.slice(0, 20)) { // Last 20 runs
        try {
          const content = await fs.readFile(path.join(resultsDir, file), 'utf-8');
          results.push({ file, data: JSON.parse(content) });
        } catch (_) {}
      }
      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message, results: [] };
    }
  });
}

module.exports = { register };
