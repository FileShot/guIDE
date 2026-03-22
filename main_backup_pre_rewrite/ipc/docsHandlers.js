/**
 * guIDE — AI-Powered Offline IDE
 * Integrated Documentation Generator Handlers
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 */
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Directories to skip for project scanning
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '__pycache__',
  '.venv', 'venv', 'env', '.tox', '.mypy_cache', 'coverage',
  '.cache', '.parcel-cache', '.turbo', 'target', 'bin', 'obj',
]);

function collectProjectFiles(rootPath, maxFiles = 500) {
  const files = [];
  function walk(dir, depth) {
    if (depth > 10 || files.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        files.push({
          path: path.join(dir, entry.name),
          relative: path.relative(rootPath, path.join(dir, entry.name)),
          ext: path.extname(entry.name).toLowerCase(),
          name: entry.name,
        });
      }
    }
  }
  walk(rootPath, 0);
  return files;
}

function detectProjectType(files, rootPath) {
  const hasFile = (name) => files.some(f => f.name === name);
  const hasExt = (ext) => files.some(f => f.ext === ext);
  const types = [];

  if (hasFile('package.json')) types.push('node');
  if (hasFile('tsconfig.json')) types.push('typescript');
  if (hasFile('next.config.js') || hasFile('next.config.mjs') || hasFile('next.config.ts')) types.push('nextjs');
  if (hasFile('vite.config.ts') || hasFile('vite.config.js')) types.push('vite');
  if (hasFile('requirements.txt') || hasFile('setup.py') || hasFile('pyproject.toml')) types.push('python');
  if (hasFile('Cargo.toml')) types.push('rust');
  if (hasFile('go.mod')) types.push('go');
  if (hasFile('pom.xml') || hasFile('build.gradle')) types.push('java');
  if (hasFile('Dockerfile') || hasFile('docker-compose.yml')) types.push('docker');

  if (hasExt('.tsx') || hasExt('.jsx')) types.push('react');
  if (hasExt('.vue')) types.push('vue');
  if (hasExt('.svelte')) types.push('svelte');

  return types;
}

function register(ctx) {

  // ── Generate JSDoc/TSDoc/docstrings for all functions in a file ──
  ipcMain.handle('docs-generate-file', async (_, params) => {
    try {
      const { filePath, cloudProvider, cloudModel, style } = params;
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) return { success: false, error: 'File not found' };

      const content = fs.readFileSync(absPath, 'utf-8');
      const ext = path.extname(absPath).toLowerCase();
      const fileName = path.basename(absPath);

      const maxLen = 12000;
      const truncated = content.length > maxLen;
      const code = truncated ? content.slice(0, maxLen) + '\n...(truncated)' : content;

      let docStyle = style || 'auto';
      if (docStyle === 'auto') {
        if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) docStyle = 'jsdoc';
        else if (['.py', '.pyw'].includes(ext)) docStyle = 'docstring';
        else if (['.rs'].includes(ext)) docStyle = 'rustdoc';
        else if (['.go'].includes(ext)) docStyle = 'godoc';
        else if (['.java', '.cs'].includes(ext)) docStyle = 'javadoc';
        else docStyle = 'jsdoc';
      }

      const prompt = `You are a documentation generator. Add ${docStyle} documentation to ALL undocumented functions, classes, methods, and important constants in this file.

Rules:
- Preserve ALL existing code exactly
- Add documentation comments ABOVE each function/class/method that doesn't already have one
- Include @param, @returns (or equivalent) for each parameter and return value
- Add a brief description for each
- Do NOT modify any code logic
- Return the COMPLETE file with documentation added

File: ${fileName}
\`\`\`${ext.replace('.', '')}
${code}
\`\`\`

Return ONLY the documented code, no markdown fences or explanation.`;

      let result = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 8000 });
          result = r.text || '';
        } catch { /* fall through */ }
      }
      if (!result && ctx.llmEngine) {
        try {
          const r = await ctx.llmEngine.generate(prompt, { maxTokens: 8000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }
      if (!result && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { maxTokens: 8000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }

      if (!result) return { success: false, error: 'No LLM available to generate documentation' };

      // Strip markdown fences if present
      result = result.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

      return { success: true, documentedCode: result, filePath: absPath, docStyle, truncated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Generate README.md from project structure ──
  ipcMain.handle('docs-generate-readme', async (_, params) => {
    try {
      const { rootPath: root, cloudProvider, cloudModel } = params;
      const projectRoot = root || ctx.currentProjectPath;
      if (!projectRoot) return { success: false, error: 'No project open' };

      const files = collectProjectFiles(projectRoot, 300);
      const projectTypes = detectProjectType(files, projectRoot);
      const projectName = path.basename(projectRoot);

      // Read key files for context
      let packageJson = '';
      let existingReadme = '';
      try { packageJson = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'); } catch { }
      try { existingReadme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf-8'); } catch { }

      // Build file tree
      const tree = files.map(f => f.relative).sort().join('\n');

      const prompt = `You are a technical writer. Generate a professional README.md for this project.

Project name: ${projectName}
Project type: ${projectTypes.join(', ') || 'unknown'}
${packageJson ? `\npackage.json:\n${packageJson.slice(0, 2000)}` : ''}
${existingReadme ? `\nExisting README (update/improve this):\n${existingReadme.slice(0, 3000)}` : ''}

File structure:
${tree.slice(0, 4000)}

Generate a complete README.md with these sections:
1. **Title & Description** — Project name, badges, one-paragraph description
2. **Features** — Bullet list of key features (infer from code structure)
3. **Prerequisites** — Required tools/versions
4. **Installation** — Step-by-step setup instructions
5. **Usage** — How to run/use the project
6. **Project Structure** — Key directories and their purpose
7. **Configuration** — Environment variables, config files
8. **Contributing** — Contribution guidelines
9. **License** — License info

Return ONLY the markdown content.`;

      let result = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 4000 });
          result = r.text || '';
        } catch { /* fall through */ }
      }
      if (!result && ctx.llmEngine) {
        try {
          const r = await ctx.llmEngine.generate(prompt, { maxTokens: 4000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }
      if (!result && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { maxTokens: 4000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }

      if (!result) return { success: false, error: 'No LLM available' };

      return { success: true, readme: result, projectName, projectTypes };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Generate API documentation from Express/FastAPI routes ──
  ipcMain.handle('docs-generate-api', async (_, params) => {
    try {
      const { rootPath: root, cloudProvider, cloudModel } = params;
      const projectRoot = root || ctx.currentProjectPath;
      if (!projectRoot) return { success: false, error: 'No project open' };

      const files = collectProjectFiles(projectRoot, 500);

      // Find route files
      const routePatterns = [
        /app\.(get|post|put|patch|delete|use)\s*\(/,
        /router\.(get|post|put|patch|delete|use)\s*\(/,
        /@app\.(route|get|post|put|delete)\s*\(/,
        /router\.add_api_route/,
        /FastAPI|APIRouter/,
        /express\.Router/,
      ];

      const routeFiles = [];
      for (const file of files) {
        if (!['.js', '.ts', '.py', '.mjs'].includes(file.ext)) continue;
        try {
          const content = fs.readFileSync(file.path, 'utf-8');
          for (const pat of routePatterns) {
            if (pat.test(content)) {
              routeFiles.push({ path: file.path, relative: file.relative, content: content.slice(0, 8000) });
              break;
            }
          }
        } catch { /* skip */ }
        if (routeFiles.length >= 20) break;
      }

      if (routeFiles.length === 0) {
        return { success: true, apiDocs: '# API Documentation\n\nNo API routes detected in this project.', routeFilesFound: 0 };
      }

      const routeContext = routeFiles.map(f => `\n--- ${f.relative} ---\n${f.content}`).join('\n');

      const prompt = `You are an API documentation generator. Analyze these route/endpoint files and generate comprehensive API documentation.

Route files:
${routeContext.slice(0, 10000)}

Generate API documentation in Markdown with:
1. **Overview** — API description, base URL, authentication
2. **Endpoints** — For each endpoint:
   - HTTP method and path
   - Description
   - Request parameters (path, query, body)
   - Response format (status codes, body schema)
   - Example request/response
3. **Error Handling** — Common error responses
4. **Authentication** — Auth methods if detected

Return ONLY the markdown content.`;

      let result = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 5000 });
          result = r.text || '';
        } catch { /* fall through */ }
      }
      if (!result && ctx.llmEngine) {
        try {
          const r = await ctx.llmEngine.generate(prompt, { maxTokens: 5000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }
      if (!result && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { maxTokens: 5000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }

      if (!result) return { success: false, error: 'No LLM available' };

      return { success: true, apiDocs: result, routeFilesFound: routeFiles.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Generate architecture diagram (Mermaid) ──
  ipcMain.handle('docs-generate-architecture', async (_, params) => {
    try {
      const { rootPath: root, cloudProvider, cloudModel } = params;
      const projectRoot = root || ctx.currentProjectPath;
      if (!projectRoot) return { success: false, error: 'No project open' };

      const files = collectProjectFiles(projectRoot, 200);
      const projectTypes = detectProjectType(files, projectRoot);
      const projectName = path.basename(projectRoot);

      // Group files by directory
      const dirs = {};
      for (const f of files) {
        const dir = path.dirname(f.relative) || '.';
        if (!dirs[dir]) dirs[dir] = [];
        dirs[dir].push(f.name);
      }

      // Read key entry points for import graph
      const entryFiles = files.filter(f =>
        ['index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.ts',
          'server.js', 'server.ts', 'electron-main.js', 'main.py', 'app.py',
          'index.tsx', 'App.tsx'].includes(f.name)
      );

      let entryContents = '';
      for (const ef of entryFiles.slice(0, 5)) {
        try {
          const c = fs.readFileSync(ef.path, 'utf-8');
          entryContents += `\n--- ${ef.relative} ---\n${c.slice(0, 3000)}\n`;
        } catch { /* skip */ }
      }

      const dirSummary = Object.entries(dirs)
        .map(([dir, fileNames]) => `${dir}/: ${fileNames.slice(0, 10).join(', ')}${fileNames.length > 10 ? ` (+ ${fileNames.length - 10} more)` : ''}`)
        .join('\n');

      const prompt = `You are a software architect. Generate a Mermaid diagram showing the architecture of this project.

Project: ${projectName}
Type: ${projectTypes.join(', ')}

Directory structure:
${dirSummary.slice(0, 3000)}

${entryContents ? `Key entry points:\n${entryContents.slice(0, 5000)}` : ''}

Generate TWO Mermaid diagrams:

1. **Component Diagram** — Show the main modules/components and their relationships
   Use \`graph TD\` format with labeled edges showing data flow

2. **Layer Diagram** — Show the architectural layers (e.g., UI → Business Logic → Data)
   Use \`graph TD\` format

Return the diagrams in this exact format:
## Component Diagram
\`\`\`mermaid
graph TD
...
\`\`\`

## Layer Diagram
\`\`\`mermaid
graph TD
...
\`\`\`

Return ONLY the markdown with mermaid blocks.`;

      let result = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 3000 });
          result = r.text || '';
        } catch { /* fall through */ }
      }
      if (!result && ctx.llmEngine) {
        try {
          const r = await ctx.llmEngine.generate(prompt, { maxTokens: 3000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }
      if (!result && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { maxTokens: 3000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }

      if (!result) return { success: false, error: 'No LLM available' };

      // Extract mermaid blocks
      const mermaidBlocks = [];
      const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
      let match;
      while ((match = mermaidRegex.exec(result)) !== null) {
        mermaidBlocks.push(match[1].trim());
      }

      return { success: true, markdown: result, mermaidDiagrams: mermaidBlocks, projectName, projectTypes };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // ── Generate codebase summary/overview ──
  ipcMain.handle('docs-explain-codebase', async (_, params) => {
    try {
      const { rootPath: root, cloudProvider, cloudModel } = params;
      const projectRoot = root || ctx.currentProjectPath;
      if (!projectRoot) return { success: false, error: 'No project open' };

      const files = collectProjectFiles(projectRoot, 300);
      const projectTypes = detectProjectType(files, projectRoot);
      const projectName = path.basename(projectRoot);

      // Get key file contents
      let keyContent = '';
      const keyFiles = ['package.json', 'README.md', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pyproject.toml'];
      for (const kf of keyFiles) {
        try {
          const content = fs.readFileSync(path.join(projectRoot, kf), 'utf-8');
          keyContent += `\n--- ${kf} ---\n${content.slice(0, 2000)}\n`;
        } catch { /* skip */ }
      }

      const tree = files.map(f => f.relative).sort().join('\n');

      const prompt = `You are a senior developer onboarding someone to a new codebase. Explain this project comprehensively.

Project: ${projectName}
Type: ${projectTypes.join(', ')}

${keyContent ? `Key files:\n${keyContent.slice(0, 4000)}` : ''}

File structure:
${tree.slice(0, 4000)}

Provide a comprehensive overview with:
1. **What is this?** — One-paragraph project description
2. **Tech Stack** — Languages, frameworks, libraries
3. **Architecture** — How the code is organized, main patterns used
4. **Key Components** — Most important files/modules and what they do
5. **Data Flow** — How data moves through the application
6. **Getting Started** — What a new developer needs to know first
7. **Common Patterns** — Coding patterns and conventions used in this codebase

Return the overview in Markdown format.`;

      let result = '';
      if (cloudProvider && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { provider: cloudProvider, model: cloudModel, maxTokens: 4000 });
          result = r.text || '';
        } catch { /* fall through */ }
      }
      if (!result && ctx.llmEngine) {
        try {
          const r = await ctx.llmEngine.generate(prompt, { maxTokens: 4000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }
      if (!result && ctx.cloudLLM) {
        try {
          const r = await ctx.cloudLLM.generate(prompt, { maxTokens: 4000 });
          result = r.text || '';
        } catch { /* ignore */ }
      }

      if (!result) return { success: false, error: 'No LLM available' };

      return { success: true, overview: result, projectName, projectTypes, fileCount: files.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
