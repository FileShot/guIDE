import * as monaco from 'monaco-editor';
import type { EditorTab, EditorConfig, SearchResult, SearchInEditorOptions } from '@/types/editor';
import { getLanguageFromExtension } from '@/config/editor';
import { fileSystemService } from './fileSystem';
import { fileManagementService } from './fileManagementService';
import { generateId } from '@/utils/helpers';

export class EditorService {
  private editors: Map<string, monaco.editor.IStandaloneCodeEditor> = new Map();
  private models: Map<string, monaco.editor.ITextModel> = new Map();
  private tabs: Map<string, EditorTab> = new Map();
  private activeTabId: string | null = null;
  private config: EditorConfig;

  constructor() {
    this.config = this.getDefaultConfig();
    this.setupMonaco();
  }

  private getDefaultConfig(): EditorConfig {
    return {
      theme: 'vs-dark',
      fontSize: 14,
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      fontWeight: 'normal',
      lineHeight: 24,
      wordWrap: 'on',
      wordWrapColumn: 120,
      minimap: {
        enabled: true,
        side: 'right',
        size: 'proportional'
      },
      lineNumbers: 'on',
      renderLineNumbers: (lineNumber: number) => lineNumber.toString(),
      renderWhitespace: 'boundary',
      renderControlCharacters: false,
      renderIndentGuides: true,
      bracketPairColorization: {
        enabled: true
      },
      guides: {
        indentation: true,
        bracketPairs: true,
        bracketPairsHorizontal: false
      },
      suggest: {
        showKeywords: true,
        showSnippets: true,
        showFunctions: true
      },
      quickSuggestions: true,
      parameterHints: {
        enabled: true
      },
      hover: {
        enabled: true,
        delay: 300
      },
      autoIndent: 'advanced',
      formatOnType: true,
      formatOnPaste: true,
      multiCursorModifier: 'ctrlCmd',
      stablePeek: true,
      peek: {
        default: true
      },
      accessibilitySupport: 'auto'
    };
  }

  private setupMonaco(): void {
    // Configure Monaco Editor
    monaco.editor.defineTheme('custom-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955' },
        { token: 'keyword', foreground: '569CD6' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'function', foreground: 'DCDCAA' },
        { token: 'variable', foreground: '9CDCFE' },
        { token: 'class', foreground: '4EC9B0' },
        { token: 'interface', foreground: 'B8D7A3' },
        { token: 'parameter', foreground: '9CDCFE' },
        { token: 'property', foreground: '9CDCFE' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'punctuation', foreground: 'D4D4D4' },
        { token: 'regexp', foreground: 'D16969' },
        { token: 'constructor', foreground: 'DCDCAA' },
        { token: 'namespace', foreground: '4EC9B0' },
        { token: 'module', foreground: '4EC9B0' },
        { token: 'enum', foreground: 'B8D7A3' },
        { token: 'enumMember', foreground: '9CDCFE' },
        { token: 'struct', foreground: '4EC9B0' },
        { token: 'event', foreground: 'DCDCAA' },
        { token: 'decorator', foreground: 'DCDCAA' },
        { token: 'macro', foreground: 'C586C0' }
      ],
      colors: {
        'editor.background': '#1E1E1E',
        'editor.foreground': '#D4D4D4',
        'editor.lineHighlightBackground': '#2D2D30',
        'editor.selectionBackground': '#264F78',
        'editor.inactiveSelectionBackground': '#3A3D41',
        'editorCursor.foreground': '#AEAFAD',
        'editorWhitespace.foreground': '#404040',
        'editorIndentGuide.background': '#404040',
        'editorIndentGuide.activeBackground': '#707070',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#C6C6C6',
        'editorGroupHeader.tabsBackground': '#252526',
        'editorGroupHeader.tabsBorder': '#252526',
        'tab.inactiveBackground': '#2D2D30',
        'tab.inactiveForeground': '#969696',
        'tab.activeBackground': '#1E1E1E',
        'tab.activeForeground': '#FFFFFF',
        'tab.border': '#252526',
        'statusBar.background': '#007ACC',
        'statusBar.foreground': '#FFFFFF',
        'statusBar.border': '#007ACC',
        'activityBar.background': '#333333',
        'activityBar.foreground': '#FFFFFF',
        'activityBar.border': '#333333',
        'sideBar.background': '#252526',
        'sideBar.foreground': '#CCCCCC',
        'sideBar.border': '#3E3E42',
        'titleBar.activeBackground': '#1E1E1E',
        'titleBar.activeForeground': '#CCCCCC',
        'titleBar.border': '#1E1E1E',
        'menu.background': '#2D2D30',
        'menu.foreground': '#CCCCCC',
        'menu.border': '#3E3E42',
        'menu.selectionBackground': '#094771',
        'menu.selectionForeground': '#FFFFFF',
        'button.background': '#0E639C',
        'button.foreground': '#FFFFFF',
        'button.hoverBackground': '#1177BB',
        'input.background': '#3C3C3C',
        'input.foreground': '#CCCCCC',
        'input.border': '#3E3E42',
        'input.activeBorder': '#007ACC',
        'dropdown.background': '#3C3C3C',
        'dropdown.foreground': '#CCCCCC',
        'dropdown.border': '#3E3E42',
        'list.activeSelectionBackground': '#094771',
        'list.activeSelectionForeground': '#FFFFFF',
        'list.hoverBackground': '#2A2D2E',
        'list.hoverForeground': '#CCCCCC',
        'tree.indentGuidesStroke': '#585858'
      }
    });

    // Set default theme
    monaco.editor.setTheme('custom-dark');

    // Default model options are configured per-model when created
  }

  async openFile(filePath: string): Promise<EditorTab> {
    try {
      const content = await fileSystemService.readFile(filePath);
      const fileName = filePath.split('/').pop() || filePath;
      const extension = '.' + fileName.split('.').pop()?.toLowerCase();
      const language = getLanguageFromExtension(extension);

      const tabId = generateId();
      const tab: EditorTab = {
        id: tabId,
        fileName,
        filePath,
        content,
        language,
        isActive: false,
        isDirty: false,
        isSaved: true,
        originalContent: content,
        lastModified: new Date(),
        encoding: 'utf8',
        lineEnding: '\n',
        readOnly: false
      };

      // Create Monaco model
      const model = monaco.editor.createModel(content, language, monaco.Uri.parse(filePath));
      this.models.set(tabId, model);

      // Store tab
      this.tabs.set(tabId, tab);

      return tab;
    } catch (error) {
      console.error('Failed to open file:', error);
      throw error;
    }
  }

  closeTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    // Check if tab has unsaved changes
    if (tab.isDirty) {
      const shouldClose = window.confirm(`"${tab.fileName}" has unsaved changes. Close without saving?`);
      if (!shouldClose) return false;
    }

    // Clean up model
    const model = this.models.get(tabId);
    if (model) {
      model.dispose();
      this.models.delete(tabId);
    }

    // Clean up editor
    const editor = this.editors.get(tabId);
    if (editor) {
      editor.dispose();
      this.editors.delete(tabId);
    }

    // Remove tab
    this.tabs.delete(tabId);

    // Set new active tab if this was active
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.activeTabId = remainingTabs[0];
        this.tabs.get(this.activeTabId)!.isActive = true;
      }
    }

    return true;
  }

  async saveFile(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`Tab ${tabId} not found`);
    }

    const model = this.models.get(tabId);
    if (!model) {
      throw new Error(`Model for tab ${tabId} not found`);
    }

    try {
      const content = model.getValue();
      
      // Use safe file management service
      const result = await fileManagementService.updateFile(tab.filePath, content);
      
      if (result.success) {
        // Update tab state
        tab.isDirty = false;
        tab.isSaved = true;
        tab.lastModified = new Date();
        tab.originalContent = content;
        
        // Update tab in map
        this.tabs.set(tabId, tab);
      } else {
        throw new Error(result.error || 'Failed to save file');
      }
    } catch (error) {
      console.error(`Failed to save file ${tab.filePath}:`, error);
      throw error;
    }
  }

  async saveAllFiles(): Promise<boolean> {
    try {
      const dirtyTabs = Array.from(this.tabs.entries())
        .filter(([_, tab]) => tab.isDirty)
        .map(([tabId]) => tabId);
      await Promise.all(dirtyTabs.map(tabId => this.saveFile(tabId)));
      return true;
    } catch {
      return false;
    }
  }

  updateTabContent(tabId: string, content: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    tab.content = content;
    tab.isDirty = content !== (tab.originalContent || '');
    tab.isSaved = !tab.isDirty;

    // Update model
    const model = this.models.get(tabId);
    if (model) {
      model.setValue(content);
    }
  }

  getTab(tabId: string): EditorTab | undefined {
    return this.tabs.get(tabId);
  }

  reorderTab(draggedTabId: string, targetTabId: string): void {
    const entries = Array.from(this.tabs.entries());
    const draggedIdx = entries.findIndex(([id]) => id === draggedTabId);
    const targetIdx = entries.findIndex(([id]) => id === targetTabId);
    if (draggedIdx === -1 || targetIdx === -1) return;
    const [draggedEntry] = entries.splice(draggedIdx, 1);
    entries.splice(targetIdx, 0, draggedEntry);
    this.tabs = new Map(entries);
  }

  getAllTabs(): EditorTab[] {
    return Array.from(this.tabs.values());
  }

  getActiveTab(): EditorTab | undefined {
    if (!this.activeTabId) return undefined;
    return this.tabs.get(this.activeTabId);
  }

  setActiveTab(tabId: string): void {
    // Deactivate current tab
    if (this.activeTabId) {
      const currentTab = this.tabs.get(this.activeTabId);
      if (currentTab) {
        currentTab.isActive = false;
      }
    }

    // Activate new tab
    const newTab = this.tabs.get(tabId);
    if (newTab) {
      newTab.isActive = true;
      this.activeTabId = tabId;
    }
  }

  createEditor(container: HTMLElement, tabId: string): monaco.editor.IStandaloneCodeEditor {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error('Tab not found');

    const model = this.models.get(tabId);
    if (!model) throw new Error('Model not found');

    const editor = monaco.editor.create(container, {
      model,
      theme: this.config.theme,
      fontSize: this.config.fontSize,
      fontFamily: this.config.fontFamily,
      fontWeight: this.config.fontWeight,
      lineHeight: this.config.lineHeight,
      wordWrap: this.config.wordWrap,
      wordWrapColumn: this.config.wordWrapColumn,
      minimap: this.config.minimap,
      lineNumbers: this.config.lineNumbers,
      renderWhitespace: this.config.renderWhitespace,
      renderControlCharacters: this.config.renderControlCharacters,
      bracketPairColorization: this.config.bracketPairColorization,
      guides: this.config.guides,
      suggest: this.config.suggest,
      quickSuggestions: this.config.quickSuggestions,
      parameterHints: this.config.parameterHints,
      hover: this.config.hover,
      autoIndent: this.config.autoIndent,
      formatOnType: this.config.formatOnType,
      formatOnPaste: this.config.formatOnPaste,
      multiCursorModifier: this.config.multiCursorModifier,
      stablePeek: this.config.stablePeek,
      accessibilitySupport: this.config.accessibilitySupport,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly: tab.readOnly || false
    });

    // Store editor
    this.editors.set(tabId, editor);

    // Set up content change handler
    editor.onDidChangeModelContent(() => {
      const content = editor.getValue();
      this.updateTabContent(tabId, content);
    });

    // Set up cursor position handler
    editor.onDidChangeCursorPosition((e) => {
      const position = e.position;
      tab.cursorPosition = {
        lineNumber: position.lineNumber,
        column: position.column
      };
    });

    // Set up selection handler
    editor.onDidChangeCursorSelection((e) => {
      const selection = e.selection;
      if (!selection.isEmpty()) {
        tab.selection = {
          start: {
            lineNumber: selection.startLineNumber,
            column: selection.startColumn
          },
          end: {
            lineNumber: selection.endLineNumber,
            column: selection.endColumn
          },
          text: editor.getModel()?.getValueInRange(selection) || ''
        };
      } else {
        tab.selection = undefined;
      }
    });

    return editor;
  }

  getEditor(tabId: string): monaco.editor.IStandaloneCodeEditor | undefined {
    return this.editors.get(tabId);
  }

  updateConfig(config: Partial<EditorConfig>): void {
    this.config = { ...this.config, ...config };

    // Update all editors
    this.editors.forEach(editor => {
      editor.updateOptions(this.config);
    });

    // Update theme if changed
    if (config.theme) {
      monaco.editor.setTheme(config.theme);
    }
  }

  getConfig(): EditorConfig {
    return { ...this.config };
  }

  searchInEditor(tabId: string, query: string, options: SearchInEditorOptions): SearchResult[] {
    const editor = this.editors.get(tabId);
    if (!editor) return [];

    const model = editor.getModel();
    if (!model) return [];

    const results: SearchResult[] = [];
    const wordSeparators = options.wholeWord ? '`~!@#$%^&*()-=+[{]}\\|;:\'",.< >/?' : null;

    const matches = model.findMatches(
      query,
      false,
      options.regex || false,
      options.caseSensitive || false,
      wordSeparators,
      true
    );

    matches.forEach(match => {
      results.push({
        range: {
          start: {
            lineNumber: match.range.startLineNumber,
            column: match.range.startColumn
          },
          end: {
            lineNumber: match.range.endLineNumber,
            column: match.range.endColumn
          }
        },
        text: match.matches?.[0] || '',
        lineNumber: match.range.startLineNumber,
        columnNumber: match.range.startColumn
      });
    });

    return results;
  }

  replaceInEditor(tabId: string, searchValue: string, replaceValue: string, options: SearchInEditorOptions): number {
    const editor = this.editors.get(tabId);
    if (!editor) return 0;

    const model = editor.getModel();
    if (!model) return 0;

    const wordSeparators = options.wholeWord ? '`~!@#$%^&*()-=+[{]}\\|;:\'",.< >/?' : null;

    const matches = model.findMatches(
      searchValue,
      false,
      options.regex || false,
      options.caseSensitive || false,
      wordSeparators,
      true
    );
    let replaceCount = 0;

    // Sort matches in reverse order to avoid position shifting
    matches.sort((a, b) => {
      if (a.range.startLineNumber !== b.range.startLineNumber) {
        return b.range.startLineNumber - a.range.startLineNumber;
      }
      return b.range.startColumn - a.range.startColumn;
    });

    matches.forEach(match => {
      model.pushEditOperations([], [{
        range: match.range,
        text: replaceValue
      }], () => null);
      replaceCount++;
    });

    return replaceCount;
  }

  formatDocument(tabId: string): void {
    const editor = this.editors.get(tabId);
    if (!editor) return;

    // Trigger the built-in format action
    editor.getAction('editor.action.formatDocument')?.run();
  }

  dispose(): void {
    // Dispose all editors
    this.editors.forEach(editor => editor.dispose());
    this.editors.clear();

    // Dispose all models
    this.models.forEach(model => model.dispose());
    this.models.clear();

    // Clear tabs
    this.tabs.clear();
    this.activeTabId = null;
  }
}

// Singleton instance
export const editorService = new EditorService();
