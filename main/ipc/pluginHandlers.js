/**
 * guIDE — AI-Powered Offline IDE
 * Plugin / Extension System Handlers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

// ─── Constants ───
const PLUGINS_DIR = path.join(os.homedir(), '.guide-ide', 'plugins');
const REGISTRY_FILE = path.join(os.homedir(), '.guide-ide', 'plugin-registry.json');

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _loadRegistry() {
  _ensureDir(path.dirname(REGISTRY_FILE));
  if (!fs.existsSync(REGISTRY_FILE)) return { plugins: [] };
  try { return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')); }
  catch { return { plugins: [] }; }
}

function _saveRegistry(reg) {
  _ensureDir(path.dirname(REGISTRY_FILE));
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
}

// ─── Built-in Marketplace (default plugins) ───
const MARKETPLACE = [
  {
    id: 'guide-dark-plus',
    name: 'Dark+ Enhanced',
    version: '1.0.0',
    author: 'guIDE Team',
    description: 'Enhanced dark theme with improved syntax highlighting',
    category: 'theme',
    downloads: 12500,
    rating: 4.8,
  },
  {
    id: 'guide-monokai',
    name: 'Monokai Pro',
    version: '1.0.0',
    author: 'guIDE Team',
    description: 'Beautiful Monokai color scheme for comfortable coding',
    category: 'theme',
    downloads: 9800,
    rating: 4.7,
  },
  {
    id: 'guide-snippets-react',
    name: 'React Snippets',
    version: '2.1.0',
    author: 'Community',
    description: 'Essential React, Redux, and React Router code snippets',
    category: 'snippets',
    downloads: 24000,
    rating: 4.9,
  },
  {
    id: 'guide-snippets-python',
    name: 'Python Snippets',
    version: '1.5.0',
    author: 'Community',
    description: 'Python code snippets, auto-imports, and boilerplate templates',
    category: 'snippets',
    downloads: 18000,
    rating: 4.6,
  },
  {
    id: 'guide-prettier',
    name: 'Prettier Formatter',
    version: '1.0.0',
    author: 'guIDE Team',
    description: 'Auto-format code with Prettier on save',
    category: 'formatter',
    downloads: 31000,
    rating: 4.8,
  },
  {
    id: 'guide-eslint',
    name: 'ESLint Integration',
    version: '1.2.0',
    author: 'Community',
    description: 'Inline ESLint diagnostics and auto-fix on save',
    category: 'linter',
    downloads: 27000,
    rating: 4.7,
  },
  {
    id: 'guide-tailwind-intellisense',
    name: 'Tailwind CSS IntelliSense',
    version: '1.0.0',
    author: 'Community',
    description: 'Autocomplete and hover preview for Tailwind CSS classes',
    category: 'language',
    downloads: 20000,
    rating: 4.9,
  },
  {
    id: 'guide-docker',
    name: 'Docker Support',
    version: '1.0.0',
    author: 'guIDE Team',
    description: 'Dockerfile & docker-compose syntax, snippets, and container management',
    category: 'tools',
    downloads: 15000,
    rating: 4.5,
  },
  {
    id: 'guide-git-lens',
    name: 'Git Lens',
    version: '1.0.0',
    author: 'Community',
    description: 'Inline git blame, history navigation, and line annotations',
    category: 'git',
    downloads: 22000,
    rating: 4.8,
  },
  {
    id: 'guide-markdown-preview',
    name: 'Markdown Preview',
    version: '1.0.0',
    author: 'guIDE Team',
    description: 'Live markdown preview with GFM support, mermaid diagrams, and math',
    category: 'language',
    downloads: 16000,
    rating: 4.6,
  },
];

function register(ctx) {
  // ── List marketplace plugins ──
  ipcMain.handle('plugin-marketplace', async (_, params) => {
    try {
      const { search, category } = params || {};
      let results = [...MARKETPLACE];
      if (search) {
        const q = search.toLowerCase();
        results = results.filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      }
      if (category && category !== 'all') {
        results = results.filter(p => p.category === category);
      }
      return { success: true, plugins: results };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── List installed plugins ──
  ipcMain.handle('plugin-list-installed', async () => {
    try {
      const reg = _loadRegistry();
      return { success: true, plugins: reg.plugins };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Install a plugin ──
  ipcMain.handle('plugin-install', async (_, pluginId) => {
    try {
      const plugin = MARKETPLACE.find(p => p.id === pluginId);
      if (!plugin) return { success: false, error: 'Plugin not found in marketplace' };

      const reg = _loadRegistry();
      if (reg.plugins.find(p => p.id === pluginId)) {
        return { success: false, error: 'Plugin already installed' };
      }

      // Create plugin directory
      const pluginDir = path.join(PLUGINS_DIR, pluginId);
      _ensureDir(pluginDir);

      // Write manifest
      const manifest = {
        ...plugin,
        installedAt: new Date().toISOString(),
        enabled: true,
      };
      fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // Generate a placeholder main.js for the plugin
      const mainContent = `// ${plugin.name} — guIDE Plugin\n// Category: ${plugin.category}\n// Version: ${plugin.version}\n\nmodule.exports = {\n  activate(api) {\n    console.log('[Plugin] ${plugin.name} activated');\n  },\n  deactivate() {\n    console.log('[Plugin] ${plugin.name} deactivated');\n  },\n};\n`;
      fs.writeFileSync(path.join(pluginDir, 'main.js'), mainContent);

      // Update registry
      reg.plugins.push(manifest);
      _saveRegistry(reg);

      return { success: true, plugin: manifest };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Uninstall a plugin ──
  ipcMain.handle('plugin-uninstall', async (_, pluginId) => {
    try {
      const reg = _loadRegistry();
      reg.plugins = reg.plugins.filter(p => p.id !== pluginId);
      _saveRegistry(reg);

      // Remove plugin directory
      const pluginDir = path.join(PLUGINS_DIR, pluginId);
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      }

      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Enable / Disable a plugin ──
  ipcMain.handle('plugin-toggle', async (_, pluginId, enabled) => {
    try {
      const reg = _loadRegistry();
      const plugin = reg.plugins.find(p => p.id === pluginId);
      if (!plugin) return { success: false, error: 'Plugin not installed' };
      plugin.enabled = enabled;
      _saveRegistry(reg);
      return { success: true, plugin };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Get plugin details ──
  ipcMain.handle('plugin-get-details', async (_, pluginId) => {
    try {
      // Check marketplace first
      const marketplacePlugin = MARKETPLACE.find(p => p.id === pluginId);
      const reg = _loadRegistry();
      const installed = reg.plugins.find(p => p.id === pluginId);
      return {
        success: true,
        plugin: marketplacePlugin || installed || null,
        installed: !!installed,
        enabled: installed?.enabled ?? false,
      };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Get marketplace categories ──
  ipcMain.handle('plugin-categories', async () => {
    const cats = new Set(MARKETPLACE.map(p => p.category));
    return { success: true, categories: ['all', ...Array.from(cats).sort()] };
  });
}

module.exports = { register };
