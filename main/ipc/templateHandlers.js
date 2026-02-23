/**
 * IPC Handlers: Project Templates & Scaffolding
 * Provides template listing, project creation, and AI-customized scaffolding.
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

// ─── Template Definitions ────────────────────────────────────────────
const TEMPLATES = [
  {
    id: 'blank-project',
    name: 'Blank Project',
    description: 'An empty project folder with just a README — start from scratch',
    icon: 'folder',
    category: 'general',
    tags: ['empty', 'blank', 'scratch'],
    files: {
      'README.md': `# {{PROJECT_NAME}}\n\nA fresh project. Start building!\n`,
    },
    postCreate: [],
  },
  {
    id: 'react-ts-vite',
    name: 'React + TypeScript',
    description: 'Modern React app with TypeScript, Vite, and Tailwind CSS',
    icon: 'react',
    category: 'frontend',
    tags: ['react', 'typescript', 'vite', 'tailwind'],
    files: {
      'package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}',
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          '@vitejs/plugin-react': '^4.3.0',
          autoprefixer: '^10.4.20',
          postcss: '^8.4.49',
          tailwindcss: '^3.4.17',
          typescript: '^5.6.0',
          vite: '^6.0.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          isolatedModules: true,
          moduleDetection: 'force',
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
          noUncheckedSideEffectImports: true,
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
        include: ['src'],
      }, null, 2),
      'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
`,
      'tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
`,
      'postcss.config.js': `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
      'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{PROJECT_NAME}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
      'src/App.tsx': `import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          {{PROJECT_NAME}}
        </h1>
        <p className="text-gray-400">Built with React + TypeScript + Vite + Tailwind</p>
        <button
          onClick={() => setCount(c => c + 1)}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
        >
          Count: {count}
        </button>
      </div>
    </div>
  );
}

export default App;
`,
      'src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      '.gitignore': `node_modules
dist
.env
.env.local
`,
      'README.md': `# {{PROJECT_NAME}}

A React + TypeScript project scaffolded by guIDE.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:5173](http://localhost:5173) in your browser.
`,
    },
  },
  {
    id: 'nextjs-app',
    name: 'Next.js App Router',
    description: 'Next.js 15 with App Router, TypeScript, and Tailwind CSS',
    icon: 'nextjs',
    category: 'frontend',
    tags: ['nextjs', 'react', 'typescript', 'tailwind', 'ssr'],
    files: {
      'package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}',
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
          lint: 'next lint',
        },
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
        devDependencies: {
          '@types/node': '^22.0.0',
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          autoprefixer: '^10.4.20',
          postcss: '^8.4.49',
          tailwindcss: '^3.4.17',
          typescript: '^5.6.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./src/*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      }, null, 2),
      'next.config.ts': `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};
export default nextConfig;
`,
      'tailwind.config.ts': `import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
};

export default config;
`,
      'postcss.config.mjs': `const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
export default config;
`,
      'src/app/layout.tsx': `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '{{PROJECT_NAME}}',
  description: 'Created with guIDE',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
`,
      'src/app/page.tsx': `export default function Home() {
  return (
    <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          {{PROJECT_NAME}}
        </h1>
        <p className="text-gray-400 text-lg">Next.js App Router + TypeScript + Tailwind</p>
        <div className="flex gap-4 justify-center">
          <a
            href="https://nextjs.org/docs"
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-colors"
          >
            Docs
          </a>
          <a
            href="https://nextjs.org/learn"
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
          >
            Learn
          </a>
        </div>
      </div>
    </main>
  );
}
`,
      'src/app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      '.gitignore': `node_modules
.next
out
.env
.env.local
`,
      'README.md': `# {{PROJECT_NAME}}

A Next.js project scaffolded by guIDE.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) in your browser.
`,
    },
  },
  {
    id: 'express-api',
    name: 'Express REST API',
    description: 'Node.js REST API with Express, CORS, and environment variables',
    icon: 'nodejs',
    category: 'backend',
    tags: ['node', 'express', 'api', 'rest', 'javascript'],
    files: {
      'package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}',
        version: '1.0.0',
        type: 'module',
        scripts: {
          start: 'node src/index.js',
          dev: 'node --watch src/index.js',
        },
        dependencies: {
          cors: '^2.8.5',
          dotenv: '^16.4.0',
          express: '^4.21.0',
        },
      }, null, 2),
      'src/index.js': `import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Routes ──
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to {{PROJECT_NAME}} API', version: '1.0.0' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Example resource routes
const items = [];

app.get('/api/items', (req, res) => {
  res.json(items);
});

app.post('/api/items', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const item = { id: Date.now().toString(), name, description: description || '', createdAt: new Date().toISOString() };
  items.push(item);
  res.status(201).json(item);
});

app.delete('/api/items/:id', (req, res) => {
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  items.splice(idx, 1);
  res.json({ success: true });
});

// ── Error handling ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(\`Server running at http://localhost:\${PORT}\`);
});
`,
      '.env': `PORT=3000
NODE_ENV=development
`,
      '.gitignore': `node_modules
.env
`,
      'README.md': `# {{PROJECT_NAME}}

A REST API built with Express.js, scaffolded by guIDE.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

API runs at [http://localhost:3000](http://localhost:3000).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | / | API info |
| GET | /api/health | Health check |
| GET | /api/items | List items |
| POST | /api/items | Create item |
| DELETE | /api/items/:id | Delete item |
`,
    },
  },
  {
    id: 'python-fastapi',
    name: 'Python FastAPI',
    description: 'Modern Python API with FastAPI, Pydantic, and uvicorn',
    icon: 'python',
    category: 'backend',
    tags: ['python', 'fastapi', 'api', 'async'],
    files: {
      'requirements.txt': `fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.10.0
python-dotenv>=1.0.0
`,
      'main.py': `"""{{PROJECT_NAME}} — FastAPI Application"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime

app = FastAPI(title="{{PROJECT_NAME}}", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Item(BaseModel):
    name: str
    description: str = ""


class ItemResponse(Item):
    id: str
    created_at: str


items_db: list[ItemResponse] = []


@app.get("/")
async def root():
    return {"message": f"Welcome to {{PROJECT_NAME}}", "version": "1.0.0"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/items", response_model=list[ItemResponse])
async def list_items():
    return items_db


@app.post("/api/items", response_model=ItemResponse, status_code=201)
async def create_item(item: Item):
    new_item = ItemResponse(
        id=str(len(items_db) + 1),
        name=item.name,
        description=item.description,
        created_at=datetime.now().isoformat(),
    )
    items_db.append(new_item)
    return new_item


@app.delete("/api/items/{item_id}")
async def delete_item(item_id: str):
    for i, item in enumerate(items_db):
        if item.id == item_id:
            items_db.pop(i)
            return {"success": True}
    raise HTTPException(status_code=404, detail="Item not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
`,
      '.gitignore': `__pycache__
*.pyc
.env
.venv
venv
`,
      'README.md': `# {{PROJECT_NAME}}

A Python API built with FastAPI, scaffolded by guIDE.

## Getting Started

\`\`\`bash
pip install -r requirements.txt
python main.py
\`\`\`

API at [http://localhost:8000](http://localhost:8000) — Swagger docs at [/docs](http://localhost:8000/docs).
`,
    },
  },
  {
    id: 'electron-app',
    name: 'Electron Desktop App',
    description: 'Cross-platform desktop app with Electron and HTML/CSS/JS',
    icon: 'electron',
    category: 'desktop',
    tags: ['electron', 'desktop', 'javascript'],
    files: {
      'package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}',
        version: '1.0.0',
        main: 'main.js',
        scripts: {
          start: 'electron .',
          dev: 'electron . --dev',
        },
        devDependencies: {
          electron: '^33.0.0',
        },
      }, null, 2),
      'main.js': `const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
`,
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{PROJECT_NAME}}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1e1e1e; color: #d4d4d4; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .container { text-align: center; }
    h1 { font-size: 2.5rem; background: linear-gradient(135deg, #4fc1ff, #9b59b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem; }
    p { color: #858585; margin-bottom: 2rem; }
    button { padding: 12px 24px; background: #007acc; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #005fa3; }
    #counter { font-size: 3rem; font-weight: bold; margin: 1rem 0; color: #4fc1ff; }
  </style>
</head>
<body>
  <div class="container">
    <h1>{{PROJECT_NAME}}</h1>
    <p>Electron Desktop App</p>
    <div id="counter">0</div>
    <button onclick="document.getElementById('counter').textContent = ++count">Click Me</button>
  </div>
  <script>let count = 0;</script>
</body>
</html>
`,
      '.gitignore': `node_modules
dist
out
`,
      'README.md': `# {{PROJECT_NAME}}

An Electron desktop app scaffolded by guIDE.

## Getting Started

\`\`\`bash
npm install
npm start
\`\`\`
`,
    },
  },
  {
    id: 'static-html',
    name: 'Static HTML/CSS/JS',
    description: 'Simple static website with HTML, CSS, and vanilla JavaScript',
    icon: 'html',
    category: 'frontend',
    tags: ['html', 'css', 'javascript', 'static'],
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{PROJECT_NAME}}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <nav>
      <h1>{{PROJECT_NAME}}</h1>
      <ul>
        <li><a href="#home">Home</a></li>
        <li><a href="#about">About</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
    </nav>
  </header>

  <main>
    <section id="home" class="hero">
      <h2>Welcome to {{PROJECT_NAME}}</h2>
      <p>A clean, modern website built with vanilla HTML, CSS, and JavaScript.</p>
      <button id="ctaBtn">Get Started</button>
    </section>
  </main>

  <footer>
    <p>Built with guIDE</p>
  </footer>

  <script src="script.js"></script>
</body>
</html>
`,
      'style.css': `* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0f172a;
  --surface: #1e293b;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
}

body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }

header { background: var(--surface); border-bottom: 1px solid #334155; padding: 1rem 2rem; }
nav { display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: auto; }
nav h1 { font-size: 1.25rem; color: var(--accent); }
nav ul { display: flex; list-style: none; gap: 1.5rem; }
nav a { color: var(--muted); text-decoration: none; transition: color 0.2s; }
nav a:hover { color: var(--text); }

.hero { min-height: 80vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2rem; }
.hero h2 { font-size: 3rem; margin-bottom: 1rem; }
.hero p { color: var(--muted); font-size: 1.2rem; margin-bottom: 2rem; max-width: 600px; }
button { padding: 12px 32px; background: var(--accent); color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
button:hover { background: var(--accent-hover); }

footer { text-align: center; padding: 2rem; color: var(--muted); font-size: 0.875rem; border-top: 1px solid #334155; }
`,
      'script.js': `document.addEventListener('DOMContentLoaded', () => {
  const ctaBtn = document.getElementById('ctaBtn');
  if (ctaBtn) {
    ctaBtn.addEventListener('click', () => {
      alert('Welcome to {{PROJECT_NAME}}!');
    });
  }
});
`,
      'README.md': `# {{PROJECT_NAME}}

A static website scaffolded by guIDE.

## Getting Started

Open \`index.html\` in your browser, or use a local server:

\`\`\`bash
npx serve .
\`\`\`
`,
    },
  },
  {
    id: 'chrome-extension',
    name: 'Chrome Extension',
    description: 'Manifest V3 Chrome extension with popup, content script, and background worker',
    icon: 'chrome',
    category: 'tools',
    tags: ['chrome', 'extension', 'browser', 'javascript'],
    files: {
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: '{{PROJECT_NAME}}',
        version: '1.0.0',
        description: 'A Chrome extension scaffolded by guIDE',
        permissions: ['activeTab', 'storage'],
        action: { default_popup: 'popup.html', default_icon: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' } },
        background: { service_worker: 'background.js' },
        content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], css: ['content.css'] }],
      }, null, 2),
      'popup.html': `<!DOCTYPE html>
<html>
<head>
  <style>
    body { width: 320px; padding: 16px; font-family: -apple-system, sans-serif; background: #1e1e1e; color: #d4d4d4; }
    h2 { font-size: 16px; margin-bottom: 12px; color: #4fc1ff; }
    button { width: 100%; padding: 10px; background: #007acc; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin-top: 8px; }
    button:hover { background: #005fa3; }
    #status { margin-top: 12px; font-size: 13px; color: #858585; }
  </style>
</head>
<body>
  <h2>{{PROJECT_NAME}}</h2>
  <button id="actionBtn">Run Action</button>
  <div id="status"></div>
  <script src="popup.js"></script>
</body>
</html>
`,
      'popup.js': `document.getElementById('actionBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => { document.title = '{{PROJECT_NAME}} was here!'; },
  });
  document.getElementById('status').textContent = 'Action executed on: ' + tab.url;
});
`,
      'background.js': `// Service worker (background script)
chrome.runtime.onInstalled.addListener(() => {
  console.log('{{PROJECT_NAME}} extension installed');
});
`,
      'content.js': `// Content script — runs on all pages
console.log('{{PROJECT_NAME}} content script loaded');
`,
      'content.css': `/* Content script styles */
`,
      'README.md': `# {{PROJECT_NAME}}

A Chrome Extension (Manifest V3) scaffolded by guIDE.

## Installation

1. Open \`chrome://extensions\`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder
`,
    },
  },
  {
    id: 'discord-bot',
    name: 'Discord Bot',
    description: 'Discord bot with slash commands using discord.js v14',
    icon: 'bot',
    category: 'tools',
    tags: ['discord', 'bot', 'node', 'javascript'],
    files: {
      'package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}',
        version: '1.0.0',
        type: 'module',
        scripts: {
          start: 'node src/index.js',
          dev: 'node --watch src/index.js',
          deploy: 'node src/deploy-commands.js',
        },
        dependencies: {
          'discord.js': '^14.16.0',
          dotenv: '^16.4.0',
        },
      }, null, 2),
      '.env': `DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_guild_id_here
`,
      'src/index.js': `import { Client, GatewayIntentBits, Collection } from 'discord.js';
import 'dotenv/config';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.commands = new Collection();

// ── Slash Commands ──
client.commands.set('ping', {
  name: 'ping',
  execute: async (interaction) => {
    const latency = Date.now() - interaction.createdTimestamp;
    await interaction.reply(\`Pong! Latency: \${latency}ms\`);
  },
});

client.commands.set('hello', {
  name: 'hello',
  execute: async (interaction) => {
    await interaction.reply(\`Hello, \${interaction.user.displayName}!\`);
  },
});

// ── Event Handlers ──
client.once('ready', (c) => {
  console.log(\`Logged in as \${c.user.tag} — serving \${c.guilds.cache.size} guilds\`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(\`Error executing \${interaction.commandName}:\`, error);
    const reply = { content: 'Something went wrong!', ephemeral: true };
    interaction.replied ? interaction.followUp(reply) : interaction.reply(reply);
  }
});

client.login(process.env.DISCORD_TOKEN);
`,
      'src/deploy-commands.js': `import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import 'dotenv/config';

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
  new SlashCommandBuilder().setName('hello').setDescription('Say hello'),
].map(cmd => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  console.log('Deploying slash commands...');
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands },
  );
  console.log('Commands deployed!');
})();
`,
      '.gitignore': `node_modules
.env
`,
      'README.md': `# {{PROJECT_NAME}}

A Discord bot built with discord.js v14, scaffolded by guIDE.

## Setup

1. Create a bot at [discord.com/developers](https://discord.com/developers)
2. Copy token → \`.env\`
3. Run:

\`\`\`bash
npm install
npm run deploy   # Register slash commands
npm run dev      # Start the bot
\`\`\`
`,
    },
  },
  {
    id: 'cli-tool',
    name: 'CLI Tool (Node.js)',
    description: 'Command-line tool with argument parsing, colors, and interactive prompts',
    icon: 'terminal',
    category: 'tools',
    tags: ['cli', 'node', 'terminal', 'javascript'],
    files: {
      'package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}',
        version: '1.0.0',
        type: 'module',
        bin: { '{{PROJECT_NAME}}': './src/index.js' },
        scripts: {
          start: 'node src/index.js',
          dev: 'node src/index.js --help',
          link: 'npm link',
        },
        dependencies: {},
      }, null, 2),
      'src/index.js': `#!/usr/bin/env node

/**
 * {{PROJECT_NAME}} — CLI Tool
 */

const args = process.argv.slice(2);
const flags = {};
const positional = [];

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const val = args[i + 1] && !args[i + 1].startsWith('-') ? args[++i] : true;
    flags[key] = val;
  } else if (args[i].startsWith('-')) {
    args[i].slice(1).split('').forEach(c => { flags[c] = true; });
  } else {
    positional.push(args[i]);
  }
}

// Colors (ANSI)
const c = {
  reset: '\\x1b[0m', bold: '\\x1b[1m',
  red: '\\x1b[31m', green: '\\x1b[32m', yellow: '\\x1b[33m',
  blue: '\\x1b[34m', cyan: '\\x1b[36m', gray: '\\x1b[90m',
};

function log(msg) { console.log(msg); }
function success(msg) { log(\`\${c.green}✓\${c.reset} \${msg}\`); }
function error(msg) { log(\`\${c.red}✗\${c.reset} \${msg}\`); }
function info(msg) { log(\`\${c.blue}ℹ\${c.reset} \${msg}\`); }

// ── Commands ──
const commands = {
  help() {
    log(\`
\${c.bold}\${c.cyan}{{PROJECT_NAME}}\${c.reset} — CLI Tool

\${c.bold}Usage:\${c.reset}
  {{PROJECT_NAME}} <command> [options]

\${c.bold}Commands:\${c.reset}
  help        Show this help message
  greet       Greet a user
  version     Show version

\${c.bold}Options:\${c.reset}
  --name      Name to greet (default: World)
  -v          Verbose output
  --help      Show help
\`);
  },

  greet() {
    const name = flags.name || positional[0] || 'World';
    success(\`Hello, \${name}!\`);
  },

  version() {
    info('{{PROJECT_NAME}} v1.0.0');
  },
};

// ── Main ──
const command = positional[0] || (flags.help ? 'help' : 'help');
const handler = commands[command];

if (handler) {
  handler();
} else {
  error(\`Unknown command: \${command}\`);
  commands.help();
  process.exit(1);
}
`,
      '.gitignore': `node_modules
`,
      'README.md': `# {{PROJECT_NAME}}

A CLI tool scaffolded by guIDE.

## Usage

\`\`\`bash
node src/index.js greet --name "John"
node src/index.js help
\`\`\`

## Install globally

\`\`\`bash
npm link
{{PROJECT_NAME}} greet --name "John"
\`\`\`
`,
    },
  },
  // ── Vue 3 + TypeScript ──
  {
    id: 'vue-vite',
    name: 'Vue 3 + TypeScript',
    description: 'Vue 3 app with TypeScript, Vite, and Vue Router',
    icon: 'vue',
    category: 'frontend',
    tags: ['vue', 'typescript', 'vite'],
    files: {
      'package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}',
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vue-tsc && vite build', preview: 'vite preview' },
        dependencies: { vue: '^3.5.0', 'vue-router': '^4.4.0' },
        devDependencies: {
          '@vitejs/plugin-vue': '^5.2.0',
          'vue-tsc': '^2.1.0',
          typescript: '^5.6.0',
          vite: '^6.0.0',
        },
      }, null, 2),
      'vite.config.ts': `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});
`,
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', lib: ['ES2020', 'DOM'], skipLibCheck: true, moduleResolution: 'bundler', allowImportingTsExtensions: true, noEmit: true, jsx: 'preserve', strict: true }, include: ['src'] }, null, 2),
      'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{PROJECT_NAME}}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
      'src/main.ts': `import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Home from './views/Home.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: Home }],
});

createApp(App).use(router).mount('#app');
`,
      'src/App.vue': `<template>
  <div id="app">
    <nav><router-link to="/">Home</router-link></nav>
    <router-view />
  </div>
</template>

<script setup lang="ts"></script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #0d0d0d; color: #e0e0e0; }
nav { padding: 1rem; border-bottom: 1px solid #333; }
nav a { color: #42b883; text-decoration: none; }
</style>
`,
      'src/views/Home.vue': `<template>
  <div style="padding:2rem">
    <h1 style="color:#42b883">{{ title }}</h1>
    <p>Edit <code>src/views/Home.vue</code> to get started.</p>
    <button @click="count++">Clicked {{ count }} times</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
const title = '{{PROJECT_NAME}}';
const count = ref(0);
</script>
`,
      '.gitignore': `node_modules\ndist\n`,
      'README.md': '# {{PROJECT_NAME}}\n\nVue 3 + TypeScript + Vite.\n\n## Setup\n\n```bash\nnpm install\nnpm run dev\n```\n',
    },
  },
  // ── SvelteKit ──
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    description: 'Full-stack Svelte app with file-based routing and TypeScript',
    icon: 'svelte',
    category: 'frontend',
    tags: ['svelte', 'sveltekit', 'vite', 'typescript'],
    files: {
      'package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}',
        version: '0.0.1',
        private: true,
        scripts: { dev: 'vite dev', build: 'vite build', preview: 'vite preview' },
        devDependencies: {
          '@sveltejs/adapter-auto': '^3.0.0',
          '@sveltejs/kit': '^2.5.0',
          '@sveltejs/vite-plugin-svelte': '^3.0.0',
          svelte: '^4.2.0',
          vite: '^5.0.0',
        },
      }, null, 2),
      'svelte.config.js': `import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() },
};

export default config;
`,
      'vite.config.ts': `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [sveltekit()] });
`,
      'src/app.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body>
    <div style="display:contents">%sveltekit.body%</div>
  </body>
</html>
`,
      'src/routes/+layout.svelte': `<slot />
`,
      'src/routes/+page.svelte': `<script lang="ts">
  let count = 0;
</script>

<svelte:head><title>{{PROJECT_NAME}}</title></svelte:head>

<main>
  <h1>{{PROJECT_NAME}}</h1>
  <p>Edit <code>src/routes/+page.svelte</code> to get started.</p>
  <button on:click={() => count++}>Clicked {count} times</button>
</main>

<style>
  main { padding: 2rem; font-family: system-ui, sans-serif; }
  h1 { color: #ff3e00; font-size: 2rem; margin-bottom: 1rem; }
  button { padding: 8px 16px; background: #ff3e00; color: white; border: none; border-radius: 4px; cursor: pointer; }
</style>
`,
      '.gitignore': `node_modules\n.svelte-kit\nbuild\n`,
      'README.md': '# {{PROJECT_NAME}}\n\nSvelteKit project.\n\n## Setup\n\n```bash\nnpm install\nnpm run dev\n```\n',
    },
  },
  // ── Flask REST API ──
  {
    id: 'python-flask',
    name: 'Flask REST API',
    description: 'Lightweight Python REST API with Flask, CORS, and env config',
    icon: 'flask',
    category: 'backend',
    tags: ['python', 'flask', 'rest', 'api'],
    files: {
      'app.py': `"""{{PROJECT_NAME}} — Flask REST API"""
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
import os

load_dotenv()
app = Flask(__name__)
CORS(app)

# In-memory store (replace with a real DB)
items = [
    {"id": 1, "name": "Item One"},
    {"id": 2, "name": "Item Two"},
]
next_id = 3


@app.route("/")
def index():
    return jsonify({"status": "ok", "app": "{{PROJECT_NAME}}"})


@app.route("/api/items", methods=["GET"])
def get_items():
    return jsonify(items)


@app.route("/api/items", methods=["POST"])
def create_item():
    global next_id
    data = request.get_json()
    if not data or not data.get("name"):
        return jsonify({"error": "name required"}), 400
    item = {"id": next_id, "name": data["name"]}
    items.append(item)
    next_id += 1
    return jsonify(item), 201


@app.route("/api/items/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    global items
    before = len(items)
    items = [i for i in items if i["id"] != item_id]
    if len(items) == before:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"deleted": item_id})


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
`,
      'requirements.txt': `flask>=3.0.0
flask-cors>=4.0.0
python-dotenv>=1.0.0
`,
      '.env': `PORT=5000
FLASK_DEBUG=1
`,
      '.gitignore': `__pycache__\n*.pyc\n.env\n.venv/\nvenv/\n`,
      'README.md': '# {{PROJECT_NAME}}\n\nFlask REST API.\n\n## Setup\n\n```bash\npython -m venv .venv\n.venv\\Scripts\\activate\npip install -r requirements.txt\npython app.py\n```\n\nAPI at `http://localhost:5000`\n',
    },
  },
  // ── Docker Compose App ──
  {
    id: 'docker-compose',
    name: 'Docker Compose App',
    description: 'Node API + Nginx reverse proxy + Postgres, wired with Docker Compose',
    icon: 'docker',
    category: 'backend',
    tags: ['docker', 'compose', 'nginx', 'postgres', 'node'],
    files: {
      'docker-compose.yml': `version: '3.9'
services:
  api:
    build: ./api
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgres://user:pass@db:5432/{{PROJECT_NAME}}
    depends_on: [db]
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports: ["80:80"]
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on: [api]
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: {{PROJECT_NAME}}
    volumes: [pgdata:/var/lib/postgresql/data]
    restart: unless-stopped

volumes:
  pgdata:
`,
      'api/Dockerfile': `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
`,
      'api/package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}-api',
        version: '1.0.0',
        scripts: { start: 'node index.js', dev: 'node --watch index.js' },
        dependencies: { express: '^4.21.0' },
      }, null, 2),
      'api/index.js': `const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.get('/api', (_, res) => res.json({ message: 'Hello from {{PROJECT_NAME}}' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API running on port ' + PORT));
`,
      'nginx/nginx.conf': `events { worker_connections 1024; }
http {
  server {
    listen 80;
    location /api { proxy_pass http://api:3000; }
    location /health { proxy_pass http://api:3000; }
  }
}
`,
      '.gitignore': `node_modules\n.env\n`,
      'README.md': '# {{PROJECT_NAME}}\n\nDocker Compose: Node API + Nginx + Postgres.\n\n## Start\n\n```bash\ndocker compose up --build\n```\n\n- API: `http://localhost/api`\n- Health: `http://localhost/health`\n',
    },
  },
  // ── Python AI Agent ──
  {
    id: 'python-ai-agent',
    name: 'Python AI Agent',
    description: 'Local AI agent using Ollama — offline, no API keys, runs on your GPU',
    icon: 'ai',
    category: 'ai',
    tags: ['python', 'ai', 'ollama', 'local', 'agent'],
    files: {
      'agent.py': `"""{{PROJECT_NAME}} — Local AI Agent via Ollama"""
import json
import os
import requests
from tools import TOOLS, call_tool

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")


def chat(messages):
    resp = requests.post(
        OLLAMA_URL + "/api/chat",
        json={"model": MODEL, "messages": messages, "tools": TOOLS, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["message"]


def run_agent(user_message, max_steps=10):
    messages = [
        {"role": "system", "content": "You are a helpful assistant with tools."},
        {"role": "user", "content": user_message},
    ]
    for _ in range(max_steps):
        response = chat(messages)
        messages.append(response)
        if not response.get("tool_calls"):
            return response.get("content", "")
        for tc in response["tool_calls"]:
            name = tc["function"]["name"]
            args = tc["function"]["arguments"]
            if isinstance(args, str):
                args = json.loads(args)
            print("  [tool] " + name + str(args))
            result = call_tool(name, args)
            messages.append({"role": "tool", "content": json.dumps(result)})
    return "Max steps reached."


if __name__ == "__main__":
    print("Agent ready. Model: " + MODEL)
    print("Type 'quit' to exit.")
    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not user_input or user_input.lower() in ("quit", "exit"):
            break
        print("Agent: " + run_agent(user_input))
`,
      'tools.py': `"""Tool definitions — add your own here."""
import datetime
import math

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Return the current date and time",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate a math expression",
            "parameters": {
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
            },
        },
    },
]


def get_current_time():
    now = datetime.datetime.now()
    return {"datetime": now.isoformat()}


def calculate(expression):
    safe = {k: getattr(math, k) for k in dir(math) if not k.startswith("_")}
    try:
        return {"result": eval(expression, {"__builtins__": {}}, safe)}  # noqa: S307
    except Exception as e:
        return {"error": str(e)}


def call_tool(name, args):
    if name == "get_current_time":
        return get_current_time()
    if name == "calculate":
        return calculate(**args)
    return {"error": "Unknown tool: " + name}
`,
      'requirements.txt': `requests>=2.31.0
`,
      '.env': `OLLAMA_MODEL=qwen2.5-coder:7b\nOLLAMA_URL=http://localhost:11434\n`,
      '.gitignore': `__pycache__\n*.pyc\n.env\n.venv/\n`,
      'README.md': '# {{PROJECT_NAME}}\n\nLocal AI agent using Ollama. No API keys needed.\n\n## Prerequisites\n\n1. Install [Ollama](https://ollama.com)\n2. `ollama pull qwen2.5-coder:7b`\n\n## Setup\n\n```bash\npip install -r requirements.txt\npython agent.py\n```\n\nAdd tools in `tools.py`.\n',
    },
  },
  // ── MCP Server ──
  {
    id: 'node-mcp-server',
    name: 'MCP Server (Node)',
    description: 'Custom Model Context Protocol server — expose tools to any LLM',
    icon: 'mcp',
    category: 'ai',
    tags: ['mcp', 'node', 'ai', 'tools'],
    files: {
      'package.json': JSON.stringify({
        name: '{{PROJECT_NAME}}',
        version: '1.0.0',
        type: 'module',
        scripts: { start: 'node src/index.js', dev: 'node --watch src/index.js' },
        dependencies: { '@modelcontextprotocol/sdk': '^1.5.0', zod: '^3.24.0' },
      }, null, 2),
      'src/index.js': `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools } from './tools.js';

const server = new McpServer({ name: '{{PROJECT_NAME}}', version: '1.0.0' });

for (const tool of tools) {
  server.tool(tool.name, tool.description, tool.schema, tool.handler);
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('{{PROJECT_NAME}} MCP server ready');
`,
      'src/tools.js': `import { z } from 'zod';

export const tools = [
  {
    name: 'echo',
    description: 'Echo a message back',
    schema: { message: z.string().describe('Message to echo') },
    async handler({ message }) {
      return { content: [{ type: 'text', text: 'Echo: ' + message }] };
    },
  },
  {
    name: 'timestamp',
    description: 'Return the current UTC timestamp',
    schema: {},
    async handler() {
      return { content: [{ type: 'text', text: new Date().toISOString() }] };
    },
  },
  {
    name: 'random_number',
    description: 'Generate a random integer between min and max',
    schema: {
      min: z.number().default(0),
      max: z.number().default(100),
    },
    async handler({ min = 0, max = 100 }) {
      const n = Math.floor(Math.random() * (max - min + 1)) + min;
      return { content: [{ type: 'text', text: String(n) }] };
    },
  },
];
`,
      '.gitignore': `node_modules\n`,
      'README.md': '# {{PROJECT_NAME}}\n\nMCP Server — expose tools to any compatible LLM client.\n\n## Setup\n\n```bash\nnpm install\nnpm start\n```\n\n## Add to guIDE\n\nIn MCP Servers panel, add command: `node /path/to/{{PROJECT_NAME}}/src/index.js`\n\nAdd tools in `src/tools.js`.\n',
    },
  },
];

function register(ctx) {
  // ─── List Templates ────────────────────────────────────────────────
  ipcMain.handle('template-list', () => {
    return TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      category: t.category,
      tags: t.tags,
    }));
  });

  // ─── Create Project from Template ──────────────────────────────────
  ipcMain.handle('template-create', async (_, { templateId, projectName, parentDir }) => {
    try {
      const template = TEMPLATES.find(t => t.id === templateId);
      if (!template) return { success: false, error: `Template "${templateId}" not found` };

      // Sanitize project name for filesystem
      const safeName = projectName.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-').toLowerCase();
      const projectDir = path.join(parentDir, safeName);

      // Check if directory already exists
      try {
        await fs.access(projectDir);
        return { success: false, error: `Directory "${safeName}" already exists in ${parentDir}` };
      } catch { /* good — doesn't exist */ }

      // Create project directory
      await fs.mkdir(projectDir, { recursive: true });

      // Write all template files
      const createdFiles = [];
      for (const [relativePath, content] of Object.entries(template.files)) {
        const filePath = path.join(projectDir, relativePath);
        const fileDir = path.dirname(filePath);

        // Create subdirectories as needed
        await fs.mkdir(fileDir, { recursive: true });

        // Replace template placeholders
        const processedContent = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);

        await fs.writeFile(filePath, processedContent, 'utf8');
        createdFiles.push(relativePath);
      }

      return {
        success: true,
        projectDir,
        projectName: safeName,
        filesCreated: createdFiles,
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ─── Get Template Details ──────────────────────────────────────────
  ipcMain.handle('template-details', (_, templateId) => {
    const template = TEMPLATES.find(t => t.id === templateId);
    if (!template) return null;
    return {
      ...template,
      fileList: Object.keys(template.files),
    };
  });
}

module.exports = { register };
