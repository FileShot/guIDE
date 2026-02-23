import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

// Tell Monaco where worker scripts are located
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_: any, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

interface MonacoEditorProps {
  content: string;
  language: string;
  filePath: string;
  onChange?: (content: string) => void;
  onCursorChange?: (line: number, column: number) => void;
  onSelectionChange?: (text: string) => void;
  onEditorMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  nextEditEnabled?: boolean;
}

// ── VS Code Dark Theme ──
let themeRegistered = false;
function ensureTheme() {
  if (themeRegistered) return;
  themeRegistered = true;
  monaco.editor.defineTheme('ide-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment',     foreground: '6A9955', fontStyle: 'italic' },
      { token: 'keyword',     foreground: '569CD6' },
      { token: 'string',      foreground: 'CE9178' },
      { token: 'number',      foreground: 'B5CEA8' },
      { token: 'type',        foreground: '4EC9B0' },
      { token: 'function',    foreground: 'DCDCAA' },
      { token: 'variable',    foreground: '9CDCFE' },
      { token: 'class',       foreground: '4EC9B0' },
      { token: 'interface',   foreground: 'B8D7A3' },
      { token: 'parameter',   foreground: '9CDCFE' },
      { token: 'property',    foreground: '9CDCFE' },
      { token: 'regexp',      foreground: 'D16969' },
      { token: 'decorator',   foreground: 'DCDCAA' },
      { token: 'namespace',   foreground: '4EC9B0' },
    ],
    colors: {
      'editor.background':                '#1E1E1E',
      'editor.foreground':                '#D4D4D4',
      'editor.lineHighlightBackground':   '#2D2D30',
      'editor.selectionBackground':       '#264F78',
      'editor.inactiveSelectionBackground':'#3A3D41',
      'editorCursor.foreground':          '#AEAFAD',
      'editorWhitespace.foreground':      '#404040',
      'editorIndentGuide.background':     '#404040',
      'editorIndentGuide.activeBackground':'#707070',
      'editorLineNumber.foreground':      '#858585',
      'editorLineNumber.activeForeground':'#C6C6C6',
      'editor.findMatchBackground':       '#515C6A',
      'editor.findMatchHighlightBackground': '#EA5C0050',
    },
  });
}

export const MonacoEditor: React.FC<MonacoEditorProps> = ({
  content,
  language,
  filePath: _filePath,
  onChange,
  onCursorChange,
  onSelectionChange,
  onEditorMount,
  nextEditEnabled = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const suppressChangeRef = useRef(false);
  const currentContentRef = useRef(content);
  const lastEditRef = useRef<{ text: string; line: number; timestamp: number } | null>(null);
  const nextEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextEditReadyRef = useRef(false);
  const nextEditAbortRef = useRef<AbortController | null>(null);
  const inlineProviderRef = useRef<monaco.IDisposable | null>(null);
  const blameDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const blameDataRef = useRef<{ line: number; hash: string; author: string; date: string; summary: string }[]>([]);

  // Keep current content ref up to date
  currentContentRef.current = content;

  // Create / dispose editor
  useEffect(() => {
    if (!containerRef.current) return;
    ensureTheme();

    const editor = monaco.editor.create(containerRef.current, {
      value: content,
      language: language || 'plaintext',
      theme: 'ide-dark',
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      fontLigatures: true,
      lineHeight: 22,
      letterSpacing: 0.3,
      minimap: { enabled: true, renderCharacters: false, maxColumn: 80 },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      wordWrap: 'on',
      lineNumbers: 'on',
      renderWhitespace: 'boundary',
      bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
      guides: { indentation: true, bracketPairs: true, bracketPairsHorizontal: false },
      suggest: { showKeywords: true, showSnippets: true, showFunctions: true, preview: true },
      quickSuggestions: { other: true, comments: false, strings: false },
      parameterHints: { enabled: true },
      hover: { enabled: true, delay: 300 },
      autoIndent: 'advanced',
      formatOnType: true,
      formatOnPaste: true,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: true,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 8, bottom: 8 },
      automaticLayout: true,
      folding: true,
      foldingHighlight: true,
      showFoldingControls: 'mouseover',
      contextmenu: true,
      mouseWheelZoom: true,
      links: true,
      colorDecorators: true,
      stickyScroll: { enabled: true },
      inlayHints: { enabled: 'on' },
    });

    editorRef.current = editor;

    // Content change listener
    const changeDisposable = editor.onDidChangeModelContent((e) => {
      if (suppressChangeRef.current) return;
      const value = editor.getModel()?.getValue() || '';
      onChange?.(value);

      // Track recent edit for next-edit-suggestion
      if (nextEditEnabled && e.changes.length > 0) {
        const change = e.changes[0];
        const editText = change.text || '';
        lastEditRef.current = {
          text: editText,
          line: change.range.startLineNumber,
          timestamp: Date.now(),
        };

        // Debounce: mark ready for suggestion after 1.5s of no edits
        nextEditReadyRef.current = false;
        if (nextEditTimerRef.current) clearTimeout(nextEditTimerRef.current);
        nextEditTimerRef.current = setTimeout(() => {
          nextEditReadyRef.current = true;
          // Trigger Monaco to request inline completions now  
          const ed = editorRef.current;
          if (ed) {
            try {
              (ed as any).getContribution?.('editor.contrib.inlineCompletions')
                ?.trigger?.('automatic');
            } catch { /* fallback: Monaco will request on its own */ }
          }
        }, 1500);
      }

      // Paste with Auto-Imports: detect large pastes in TS/JS/TSX/JSX files
      if (e.changes.length === 1) {
        const change = e.changes[0];
        const pastedText = change.text || '';
        const isLargePaste = pastedText.length > 30 && pastedText.includes('\n');
        const currentLang = (language || '').toLowerCase();
        const isSupportedLang = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(currentLang);

        if (isLargePaste && isSupportedLang) {
          // Analyze pasted code for missing imports
          const model = editor.getModel();
          if (model) {
            const fullContent = model.getValue();
            const existingImports = fullContent.match(/^import\s+.+$/gm) || [];
            
            // Common known symbols → import paths
            const knownImports: Record<string, string> = {
              'useState': "import { useState } from 'react';",
              'useEffect': "import { useEffect } from 'react';",
              'useRef': "import { useRef } from 'react';",
              'useCallback': "import { useCallback } from 'react';",
              'useMemo': "import { useMemo } from 'react';",
              'useContext': "import { useContext } from 'react';",
              'useReducer': "import { useReducer } from 'react';",
              'React': "import React from 'react';",
              'useNavigate': "import { useNavigate } from 'react-router-dom';",
              'useParams': "import { useParams } from 'react-router-dom';",
              'useLocation': "import { useLocation } from 'react-router-dom';",
              'Link': "import { Link } from 'react-router-dom';",
              'clsx': "import clsx from 'clsx';",
              'cn': "import { cn } from '@/utils/helpers';",
              'axios': "import axios from 'axios';",
            };
            
            // Find symbols used in pasted code that aren't already imported
            const missingImports: string[] = [];
            for (const [symbol, importStatement] of Object.entries(knownImports)) {
              const symbolRegex = new RegExp(`\\b${symbol}\\b`);
              if (symbolRegex.test(pastedText)) {
                const alreadyImported = existingImports.some(imp => imp.includes(symbol));
                if (!alreadyImported && !missingImports.includes(importStatement)) {
                  // Group React hooks into a single import
                  missingImports.push(importStatement);
                }
              }
            }
            
            if (missingImports.length > 0) {
              // Merge React imports into one line
              const reactHooks = missingImports
                .filter(i => i.includes("from 'react'") && !i.includes('React from'))
                .map(i => {
                  const match = i.match(/\{ (.+) \}/);
                  return match ? match[1] : '';
                })
                .filter(Boolean);
              
              const otherImports = missingImports.filter(i => !i.includes("from 'react'") || i.includes('React from'));
              
              const finalImports: string[] = [];
              if (reactHooks.length > 0) {
                finalImports.push(`import { ${reactHooks.join(', ')} } from 'react';`);
              }
              finalImports.push(...otherImports);
              
              // Insert imports at top of file (after existing imports or at line 1)
              const lastImportLine = existingImports.length > 0
                ? fullContent.split('\n').findLastIndex(l => /^import\s+/.test(l)) + 1
                : 0;
              
              const insertLine = lastImportLine > 0 ? lastImportLine + 1 : 1;
              const importText = finalImports.join('\n') + '\n';
              
              editor.executeEdits('auto-import', [{
                range: new monaco.Range(insertLine, 1, insertLine, 1),
                text: importText,
                forceMoveMarkers: true,
              }]);
            }
          }
        }
      }
    });

    // Cursor change listener
    const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
      onCursorChange?.(e.position.lineNumber, e.position.column);

      // Git blame decoration — show blame for current line
      const line = e.position.lineNumber;
      const blameEntry = blameDataRef.current.find(b => b.line === line);
      if (blameEntry && blameDecorationsRef.current) {
        blameDecorationsRef.current.set([{
          range: new monaco.Range(line, 1, line, 1),
          options: {
            after: {
              content: `  ${blameEntry.author}, ${blameEntry.date} • ${blameEntry.summary}`,
              inlineClassName: 'git-blame-decoration',
            },
            isWholeLine: true,
          },
        }]);
      } else if (blameDecorationsRef.current) {
        blameDecorationsRef.current.clear();
      }
    });

    // Selection change listener
    const selectionDisposable = editor.onDidChangeCursorSelection((e) => {
      const selection = editor.getModel()?.getValueInRange(e.selection) || '';
      onSelectionChange?.(selection);
    });

    // Notify parent
    onEditorMount?.(editor);

    // ── Git Blame Decorations ──
    blameDecorationsRef.current = editor.createDecorationsCollection([]);
    
    // Fetch blame data for the file
    (async () => {
      try {
        const api = (window as any).electronAPI;
        if (api?.gitBlame && _filePath) {
          const result = await api.gitBlame(_filePath);
          if (result?.success && result.blame?.length > 0) {
            blameDataRef.current = result.blame;
          }
        }
      } catch { /* git not available or not a repo */ }
    })();

    // Inject CSS for blame decorations and ghost text coloring if not already done
    if (!document.getElementById('git-blame-style')) {
      const style = document.createElement('style');
      style.id = 'git-blame-style';
      style.textContent = `
        .git-blame-decoration { color: #6a6a6a !important; font-style: italic; font-size: 11px; margin-left: 20px; }
        /* Colored ghost text suggestions — subtle blue-purple tint */
        .ghost-text-decoration,
        .ghost-text-decoration-preview,
        .suggest-preview-text .ghost-text,
        .monaco-editor .ghost-text-decoration { color: #7c8fa8 !important; font-style: italic; }
        .monaco-editor .ghost-text-decoration-preview { color: #7c8fa8 !important; font-style: italic; }
        .monaco-editor .suggest-preview-additional-text { color: #6b7d96 !important; }
        .monaco-editor .inline-completion-text-to-replace { color: #9b8fd4 !important; background: rgba(124, 58, 237, 0.08); border-radius: 2px; }
      `;
      document.head.appendChild(style);
    }

    // ── Bracket Content Selection (Ctrl+Shift+[) ──
    editor.addAction({
      id: 'select-bracket-content',
      label: 'Select Bracket Content',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.BracketLeft,
      ],
      run: (ed) => {
        const position = ed.getPosition();
        if (!position) return;
        const model = ed.getModel();
        if (!model) return;

        // Use Monaco's built-in bracket matching
        const bracketPairs = (model as any).bracketPairs;
        const bracketPair = bracketPairs?.matchBracket?.(position);
        if (bracketPair) {
          const [open, close] = bracketPair;
          // Select content between the brackets (inside)
          ed.setSelection(new monaco.Selection(
            open.endLineNumber, open.endColumn,
            close.startLineNumber, close.startColumn,
          ));
          return;
        }

        // Fallback: search outward from cursor for bracket pairs
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const openBrackets = '({[';
        const closeBrackets = ')}]';
        let depth = 0;
        let openOffset = -1;

        // Search backward for opening bracket
        for (let i = offset - 1; i >= 0; i--) {
          const ch = text[i];
          if (closeBrackets.includes(ch)) depth++;
          else if (openBrackets.includes(ch)) {
            if (depth === 0) { openOffset = i; break; }
            depth--;
          }
        }

        if (openOffset >= 0) {
          const openChar = text[openOffset];
          const closeChar = closeBrackets[openBrackets.indexOf(openChar)];
          depth = 0;

          // Search forward for matching close
          for (let i = openOffset + 1; i < text.length; i++) {
            if (text[i] === openChar) depth++;
            else if (text[i] === closeChar) {
              if (depth === 0) {
                const startPos = model.getPositionAt(openOffset + 1);
                const endPos = model.getPositionAt(i);
                ed.setSelection(new monaco.Selection(
                  startPos.lineNumber, startPos.column,
                  endPos.lineNumber, endPos.column,
                ));
                return;
              }
              depth--;
            }
          }
        }
      },
    });

    // ── AI Code Actions (Context Menu) ──
    // Helper to dispatch code action via IPC
    const dispatchCodeAction = async (actionId: string, ed: monaco.editor.ICodeEditor) => {
      const selection = ed.getSelection();
      const model = ed.getModel();
      if (!model) return;
      const selectedText = selection ? model.getValueInRange(selection) : '';
      const cursorLine = ed.getPosition()?.lineNumber || 1;
      const fileContent = model.getValue();
      const currentLang = model.getLanguageId();
      const api = (window as any).electronAPI;
      if (!api?.codeAction) return;

      // Flash a status message
      const statusDiv = document.getElementById('code-action-status');
      if (statusDiv) {
        statusDiv.textContent = `AI ${actionId}...`;
        statusDiv.style.display = 'block';
      }

      try {
        const cloudProvider = localStorage.getItem('guIDE-cloudProvider') || '';
        const cloudModel = localStorage.getItem('guIDE-cloudModel') || '';
        const result = await api.codeAction({
          action: actionId,
          filePath: _filePath,
          selectedText,
          fileContent,
          cursorLine,
          language: currentLang,
          ...(cloudProvider && cloudModel ? { cloudProvider, cloudModel } : {}),
        });

        if (result?.success && result.result) {
          if (actionId === 'explain') {
            // For explanations, dispatch an event so ChatPanel can display it
            window.dispatchEvent(new CustomEvent('code-action-result', {
              detail: { action: actionId, result: result.result, selectedText },
            }));
          } else {
            // For code modifications, apply as a pending diff
            if (selection && !selection.isEmpty()) {
              // Apply the result as a replacement to the selection
              window.dispatchEvent(new CustomEvent('code-action-result', {
                detail: {
                  action: actionId,
                  result: result.result,
                  selectedText,
                  filePath: _filePath,
                  isCodeChange: true,
                },
              }));
            } else {
              window.dispatchEvent(new CustomEvent('code-action-result', {
                detail: { action: actionId, result: result.result, selectedText },
              }));
            }
          }
        }
      } catch (err) {
        console.error(`Code action ${actionId} failed:`, err);
      } finally {
        if (statusDiv) statusDiv.style.display = 'none';
      }
    };

    // Register context menu actions
    const codeActions = [
      { id: 'ai-explain', label: 'AI: Explain Code', action: 'explain', keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE },
      { id: 'ai-refactor', label: 'AI: Refactor', action: 'refactor', keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR },
      { id: 'ai-fix', label: 'AI: Fix Bugs', action: 'fix', keybinding: undefined },
      { id: 'ai-add-tests', label: 'AI: Generate Tests', action: 'add-tests', keybinding: undefined },
      { id: 'ai-optimize', label: 'AI: Optimize', action: 'optimize', keybinding: undefined },
      { id: 'ai-add-comments', label: 'AI: Add Comments', action: 'add-comments', keybinding: undefined },
      { id: 'ai-add-types', label: 'AI: Add Types', action: 'add-types', keybinding: undefined },
    ];

    const codeActionDisposables: monaco.IDisposable[] = [];
    for (const ca of codeActions) {
      codeActionDisposables.push(editor.addAction({
        id: ca.id,
        label: ca.label,
        contextMenuGroupId: '9_ai',
        contextMenuOrder: codeActions.indexOf(ca) + 1,
        keybindings: ca.keybinding ? [ca.keybinding] : undefined,
        precondition: undefined,
        run: (ed) => dispatchCodeAction(ca.action, ed),
      }));
    }

    // Inject CSS for code action status indicator
    if (!document.getElementById('code-action-status-style')) {
      const statusStyle = document.createElement('style');
      statusStyle.id = 'code-action-status-style';
      statusStyle.textContent = `
        #code-action-status {
          position: fixed; bottom: 28px; right: 24px; z-index: 100;
          background: #007acc; color: white; padding: 6px 14px; border-radius: 6px;
          font-size: 12px; font-family: sans-serif; display: none;
          animation: fadeIn 0.2s ease-in;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `;
      document.head.appendChild(statusStyle);
    }
    if (!document.getElementById('code-action-status')) {
      const statusEl = document.createElement('div');
      statusEl.id = 'code-action-status';
      document.body.appendChild(statusEl);
    }

    // ── Next Edit Suggestions (Ghost Text) ──
    // Enhanced InlineCompletionsProvider with proper debounce, cloud support,
    // multi-line suggestions, cursor-centered context, and request deduplication.
    const nextEditProvider = monaco.languages.registerInlineCompletionsProvider(
      { pattern: '**' },
      {
        provideInlineCompletions: async (model, position, _ctx, token) => {
          if (!nextEditEnabled) return { items: [] };

          // Only fire after debounce timer marks us ready (1.5s after last edit)
          if (!nextEditReadyRef.current) return { items: [] };

          const edit = lastEditRef.current;
          if (!edit || Date.now() - edit.timestamp > 15000) return { items: [] };

          // Abort any in-flight previous request
          if (nextEditAbortRef.current) {
            nextEditAbortRef.current.abort();
          }
          const abortController = new AbortController();
          nextEditAbortRef.current = abortController;

          try {
            const api = (window as any).electronAPI;
            if (!api?.nextEditSuggestion) return { items: [] };

            const fileContent = model.getValue();
            const cursorLine = position.lineNumber;

            // Get cloud provider/model from localStorage (same pattern as code actions)
            const cloudProvider = localStorage.getItem('guIDE-cloudProvider') || '';
            const cloudModel = localStorage.getItem('guIDE-cloudModel') || '';

            const result = await api.nextEditSuggestion({
              filePath: _filePath,
              fileContent,
              recentEdit: JSON.stringify(edit),
              cursorLine,
              ...(cloudProvider && cloudModel ? { cloudProvider, cloudModel } : {}),
            });

            // Check both Monaco cancellation and our abort
            if (token.isCancellationRequested || abortController.signal.aborted) return { items: [] };
            if (!result?.suggestion) return { items: [] };

            // Mark not ready after a successful request to prevent rapid re-fires
            nextEditReadyRef.current = false;

            try {
              const suggestion = typeof result.suggestion === 'string'
                ? JSON.parse(result.suggestion)
                : result.suggestion;

              if (suggestion && suggestion.newText && suggestion.line) {
                const targetLine = Math.min(Math.max(1, suggestion.line), model.getLineCount());
                const lineContent = model.getLineContent(targetLine);

                // Multi-line support: detect newlines in newText
                const isMultiLine = suggestion.newText.includes('\n');

                // If the suggestion replaces existing text
                if (suggestion.oldText && lineContent.includes(suggestion.oldText)) {
                  const col = lineContent.indexOf(suggestion.oldText) + 1;
                  const oldLines = suggestion.oldText.split('\n');
                  const endLine = targetLine + oldLines.length - 1;
                  const endCol = oldLines.length > 1
                    ? oldLines[oldLines.length - 1].length + 1
                    : col + suggestion.oldText.length;

                  return {
                    items: [{
                      insertText: suggestion.newText,
                      range: new monaco.Range(targetLine, col, endLine, endCol),
                    }],
                  };
                }

                // Pure insertion at end of line (or multi-line insertion)
                if (isMultiLine) {
                  // Insert after the current line
                  return {
                    items: [{
                      insertText: '\n' + suggestion.newText,
                      range: new monaco.Range(
                        targetLine, lineContent.length + 1,
                        targetLine, lineContent.length + 1
                      ),
                    }],
                  };
                }

                return {
                  items: [{
                    insertText: suggestion.newText,
                    range: new monaco.Range(
                      targetLine, lineContent.length + 1,
                      targetLine, lineContent.length + 1
                    ),
                  }],
                };
              }
            } catch {
              // LLM returned unparseable suggestion, ignore
            }
          } catch {
            // API not available or error
          }
          return { items: [] };
        },
        freeInlineCompletions: () => {},
      }
    );
    inlineProviderRef.current = nextEditProvider;

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      editor.layout();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      changeDisposable.dispose();
      cursorDisposable.dispose();
      selectionDisposable.dispose();
      nextEditProvider.dispose();
      codeActionDisposables.forEach(d => d.dispose());
      if (nextEditTimerRef.current) clearTimeout(nextEditTimerRef.current);
      if (nextEditAbortRef.current) nextEditAbortRef.current.abort();
      resizeObserver.disconnect();
      editor.dispose();
      editorRef.current = null;
    };
    // Only run on mount/unmount (content changes handled below)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync content from parent (e.g., file loaded, AI diff applied)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const currentValue = model.getValue();
    if (currentValue !== content) {
      suppressChangeRef.current = true;
      model.setValue(content);
      suppressChangeRef.current = false;
    }
  }, [content]);

  // Sync language
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && language) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [language]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: '100px' }}
    />
  );
};
