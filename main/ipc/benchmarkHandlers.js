/**
 * IPC Handlers: Model Benchmark — provides test case definitions and
 * result persistence. The benchmark execution itself is orchestrated from
 * the renderer using the same aiChat/llmLoadModel/llmResetSession IPC
 * calls that the real IDE uses — ensuring identical code paths.
 *
 * Results are saved locally only; use scripts/export-benchmarks.js manually
 * if you want to push results to the website data layer.
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// ── Pre-built test suite — 32 prompts across 6 categories ──
// DESIGN PRINCIPLE: Test prompts must be REALISTIC — the way a real user would
// talk. No hand-holding, no "use tool X". The model must infer what to do.
// Only a small baseline section explicitly tests tool recognition.
const DEFAULT_TEST_CASES = [
  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 1: EXPLICIT — Clear tool-calling tasks (search + save)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'E1-search-save-pizza',
    category: 'Explicit Task',
    prompt: 'Search for the top 3 pizza places in Dallas Texas and save their names, ratings, and websites to a file on my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Search + save: pizza places',
    maxIterations: 6,
  },
  {
    id: 'E2-weather-save',
    category: 'Explicit Task',
    prompt: 'Look up the current weather in New York City and save a summary to a file on my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Search + save: weather',
    maxIterations: 6,
  },
  {
    id: 'E3-python-libs',
    category: 'Explicit Task',
    prompt: 'Find 3 popular Python libraries for web scraping and save their names, descriptions, and URLs to a file on my desktop.',
    expectedTools: ['web_search', 'write_file'],
    expectedContent: [['python']],
    description: 'Search + save: Python libs',
    maxIterations: 6,
  },
  {
    id: 'E4-tallest-buildings',
    category: 'Explicit Task',
    prompt: 'Search for the 5 tallest buildings in the world and save their names, heights, and locations to a file on my desktop.',
    expectedTools: ['web_search', 'write_file'],
    expectedContent: [['burj khalifa']],
    description: 'Search + save: buildings',
    maxIterations: 6,
  },
  {
    id: 'E5-bestselling-books',
    category: 'Explicit Task',
    prompt: 'Find the top 3 best-selling books right now and save a summary of each to my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Search + save: books',
    maxIterations: 6,
  },
  {
    id: 'E6-ml-courses',
    category: 'Explicit Task',
    prompt: 'Search for 3 free online courses about machine learning and save the course names, platforms, and links to my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Search + save: ML courses',
    maxIterations: 6,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 2: VAGUE — Requires tool inference (no mention of search/save)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'V1-prog-lang-2025',
    category: 'Vague Inference',
    prompt: 'I need to know what programming language to learn in 2025 — give me the top 3 choices with pros and cons, and keep a copy for me.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Vague: infer search + save',
    maxIterations: 6,
  },
  {
    id: 'V2-hiking-denver',
    category: 'Vague Inference',
    prompt: 'What are some good hiking trails near Denver? I want the details saved somewhere I can find them.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Vague: trails + save',
    maxIterations: 6,
  },
  {
    id: 'V3-tokyo-trip',
    category: 'Vague Inference',
    prompt: "I'm planning a trip to Tokyo. What should I know? Put together a guide for me.",
    expectedTools: ['web_search', 'write_file'],
    description: 'Vague: travel guide',
    maxIterations: 6,
  },
  {
    id: 'V4-framework-compare',
    category: 'Vague Inference',
    prompt: 'Help me understand the differences between React, Vue, and Angular. I want to compare them side by side.',
    expectedTools: ['web_search', 'write_file'],
    expectedContent: [['react'], ['vue'], ['angular']],
    description: 'Vague: framework comparison',
    maxIterations: 6,
  },
  {
    id: 'V5-ai-research',
    category: 'Vague Inference',
    prompt: "What's happening in AI research this week? Compile a brief for me.",
    expectedTools: ['web_search', 'write_file'],
    description: 'Vague: AI news brief',
    maxIterations: 6,
  },
  {
    id: 'V6-stargazing-parks',
    category: 'Vague Inference',
    prompt: 'Which US National Parks have the best stargazing? Get me the info.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Vague: stargazing parks',
    maxIterations: 6,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 3: MULTI-STEP — Complex tasks needing 3+ sequential tool calls
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'M1-weather-restaurant',
    category: 'Multi-step',
    prompt: 'Compare the weather in New York, London, and Tokyo right now. Then find a popular restaurant in whichever city has the best weather. Save everything to a report on my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Multi: weather compare + restaurant',
    maxIterations: 8,
  },
  {
    id: 'M2-ev-cars-charging',
    category: 'Multi-step',
    prompt: 'Research the top 3 electric cars of 2025, find their prices and range. Then search for charging stations in Los Angeles. Compile everything into a comprehensive report on my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Multi: EV research + charging',
    maxIterations: 8,
  },
  {
    id: 'M3-cs-study-guide',
    category: 'Multi-step',
    prompt: 'Build me a study guide: find the 5 most important topics in computer science for job interviews, research each one, and save a detailed guide with examples to my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Multi: CS interview study guide',
    maxIterations: 8,
  },
  {
    id: 'M4-sf-weekend',
    category: 'Multi-step',
    prompt: 'I want to plan a weekend in San Francisco — find the top 5 attractions, current weather, best restaurants nearby, and create a complete itinerary saved to my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Multi: SF weekend itinerary',
    maxIterations: 8,
  },
  {
    id: 'M5-web-frameworks',
    category: 'Multi-step',
    prompt: 'Research 3 different web frameworks, find a tutorial for each, compare their GitHub stars and community size, and write a recommendation report on my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Multi: framework comparison report',
    maxIterations: 8,
  },
  {
    id: 'M6-tech-news-briefing',
    category: 'Multi-step',
    prompt: "Find today's top 3 tech news stories, summarize each one, look up the companies mentioned, and create a briefing document on my desktop.",
    expectedTools: ['web_search', 'write_file'],
    description: 'Multi: tech news briefing',
    maxIterations: 8,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 4: CODING — HTML/game/website generation tasks
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'C1-tic-tac-toe',
    category: 'Coding',
    prompt: 'Create an HTML page with a Tic-Tac-Toe game I can play in my browser. Save it to my desktop.',
    expectedTools: ['write_file'],
    expectedContent: [['tic-tac-toe', 'tic tac toe', 'tictactoe']],
    description: 'Code: Tic-Tac-Toe game',
    maxIterations: 4,
  },
  {
    id: 'C2-portfolio',
    category: 'Coding',
    prompt: 'Build me a personal portfolio website with sections for About, Projects, and Contact. Save the HTML file to my desktop.',
    expectedTools: ['write_file'],
    description: 'Code: portfolio site',
    maxIterations: 4,
  },
  {
    id: 'C3-snake-game',
    category: 'Coding',
    prompt: 'Create a snake game in HTML and JavaScript that I can play with arrow keys. Save it to my desktop.',
    expectedTools: ['write_file'],
    expectedContent: [['snake']],
    description: 'Code: Snake game',
    maxIterations: 4,
  },
  {
    id: 'C4-calculator',
    category: 'Coding',
    prompt: 'Write a calculator app in HTML with CSS styling that works for basic math operations. Save it to my desktop.',
    expectedTools: ['write_file'],
    expectedContent: [['calculator']],
    description: 'Code: calculator app',
    maxIterations: 4,
  },
  {
    id: 'C5-coffee-landing',
    category: 'Coding',
    prompt: "Create a landing page for a coffee shop called 'Bean There' with a menu section and contact form. Save it to my desktop.",
    expectedTools: ['write_file'],
    expectedContent: [['bean there', 'coffee']],
    description: 'Code: coffee shop landing page',
    maxIterations: 4,
  },
  {
    id: 'C6-todo-app',
    category: 'Coding',
    prompt: 'Build an interactive to-do list app in HTML/CSS/JS that lets me add, complete, and delete tasks. Save it to my desktop.',
    expectedTools: ['write_file'],
    expectedContent: [['to-do', 'todo', 'task']],
    description: 'Code: to-do list app',
    maxIterations: 4,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 5: CHAT — Should NOT trigger tool calls (validates hard gate)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'T1-greeting',
    category: 'Chat Baseline',
    prompt: 'Hi, how are you?',
    expectedTools: [],
    description: 'Chat: greeting, no tools',
    maxIterations: 1,
  },
  {
    id: 'T2-capital-france',
    category: 'Chat Baseline',
    prompt: 'What is the capital of France?',
    expectedTools: [],
    expectedContent: [['paris']],
    description: 'Chat: knowledge, no tools',
    maxIterations: 1,
  },
  {
    id: 'T3-recursion',
    category: 'Chat Baseline',
    prompt: 'Explain what recursion is in simple terms.',
    expectedTools: [],
    expectedContent: [['recursion', 'recursive', 'calls itself']],
    description: 'Chat: explain concept, no tools',
    maxIterations: 1,
  },
  {
    id: 'T4-thanks',
    category: 'Chat Baseline',
    prompt: 'Thanks for the help!',
    expectedTools: [],
    description: 'Chat: gratitude, no tools',
    maxIterations: 1,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 6: DUPLICATE TOOL — Same tool called multiple times w/ diff params
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'D1-restaurants-2cities',
    category: 'Duplicate Tool',
    prompt: 'Search for the best restaurants in both New York and Los Angeles and save the combined results to my desktop.',
    expectedTools: ['web_search', 'write_file'],
    description: 'Dedup: 2-city restaurant search',
    maxIterations: 8,
  },
  {
    id: 'D2-weather-3cities',
    category: 'Duplicate Tool',
    prompt: 'Look up the weather in Miami, Chicago, and Seattle. Save all three forecasts to one file on my desktop.',
    expectedTools: ['web_search', 'write_file'],
    expectedContent: [['miami'], ['chicago'], ['seattle']],
    description: 'Dedup: 3-city weather',
    maxIterations: 8,
  },
  {
    id: 'D3-coffee-3cities',
    category: 'Duplicate Tool',
    prompt: 'Find the top-rated coffee shops in Portland, Austin, and Nashville. Compare them in a file on my desktop.',
    expectedTools: ['web_search', 'write_file'],
    expectedContent: [['portland'], ['austin'], ['nashville']],
    description: 'Dedup: 3-city coffee shops',
    maxIterations: 8,
  },
  {
    id: 'D4-lang-versions',
    category: 'Duplicate Tool',
    prompt: 'Research Python, JavaScript, and Rust — find the latest version and community size for each. Save to my desktop.',
    expectedTools: ['web_search', 'write_file'],
    expectedContent: [['python'], ['javascript', 'js'], ['rust']],
    description: 'Dedup: 3-language research',
    maxIterations: 8,
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

module.exports = { register, DEFAULT_TEST_CASES };
