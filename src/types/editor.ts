export interface EditorTab {
  id: string;
  fileName: string;
  filePath: string;
  content: string;
  language: string;
  isActive: boolean;
  isDirty: boolean;
  isSaved: boolean;
  cursorPosition?: CursorPosition;
  selection?: Selection;
  scrollPosition?: ScrollPosition;
  originalContent?: string;
  lastModified?: Date;
  encoding?: string;
  lineEnding?: string;
  readOnly?: boolean;
}

export interface CursorPosition {
  lineNumber: number;
  column: number;
}

export interface Selection {
  start: CursorPosition;
  end: CursorPosition;
  text?: string;
}

export interface ScrollPosition {
  scrollTop: number;
  scrollLeft: number;
}

export interface EditorConfig {
  theme: 'vs-dark' | 'vs-light' | 'hc-black';
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  lineHeight: number;
  wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  wordWrapColumn: number;
  minimap: {
    enabled: boolean;
    side: 'right' | 'left';
    size: 'proportional' | 'fill' | 'fit';
  };
  lineNumbers: 'on' | 'off' | 'relative' | 'interval';
  renderLineNumbers: (lineNumber: number) => string;
  renderWhitespace: 'none' | 'boundary' | 'all' | 'selection';
  renderControlCharacters: boolean;
  renderIndentGuides: boolean;
  bracketPairColorization: {
    enabled: boolean;
  };
  guides: {
    indentation: boolean;
    bracketPairs: boolean;
    bracketPairsHorizontal: boolean;
  };
  suggest: {
    showKeywords: boolean;
    showSnippets: boolean;
    showFunctions: boolean;
  };
  quickSuggestions: boolean;
  parameterHints: {
    enabled: boolean;
  };
  hover: {
    enabled: boolean;
    delay: number;
  };
  autoIndent: 'none' | 'keep' | 'brackets' | 'advanced' | 'full';
  formatOnType: boolean;
  formatOnPaste: boolean;
  multiCursorModifier: 'ctrlCmd' | 'alt';
  stablePeek: boolean;
  peek: {
    default: boolean;
  };
  accessibilitySupport: 'auto' | 'on' | 'off';
}

export interface EditorAction {
  type: 'insert' | 'delete' | 'replace' | 'move' | 'format';
  range?: Selection;
  text?: string;
  position?: CursorPosition;
}

export interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  config: EditorConfig;
  isLoading: boolean;
  error: string | null;
}

export interface LanguageInfo {
  id: string;
  name: string;
  extensions: string[];
  mimetypes?: string[];
  aliases?: string[];
}

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  detail?: string;
  documentation?: string;
  insertText: string;
  filterText?: string;
  sortText?: string;
  additionalTextEdits?: EditorAction[];
}

export enum CompletionKind {
  Method = 0,
  Function = 1,
  Constructor = 2,
  Field = 3,
  Variable = 4,
  Class = 5,
  Struct = 6,
  Interface = 7,
  Module = 8,
  Property = 9,
  Event = 10,
  Operator = 11,
  Unit = 12,
  Value = 13,
  Constant = 14,
  Enum = 15,
  EnumMember = 16,
  Keyword = 17,
  Text = 18,
  Color = 19,
  File = 20,
  Reference = 21,
  Folder = 22,
  TypeParameter = 23,
  Snippet = 24
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  code?: string | number;
  source?: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  related?: DiagnosticRelatedInformation[];
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Info = 2,
  Hint = 3
}

export interface DiagnosticRelatedInformation {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  resource: string;
}

export interface EditorEvent {
  type: 'content-change' | 'cursor-change' | 'selection-change' | 'scroll-change' | 'focus' | 'blur';
  tabId: string;
  data?: any;
  timestamp: Date;
}

export interface SearchInEditorOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  preserveCase: boolean;
}

export interface SearchResult {
  range: Selection;
  text: string;
  lineNumber: number;
  columnNumber: number;
}

export interface EditorTheme {
  name: string;
  base: 'vs' | 'vs-dark' | 'hc-black';
  inherit: boolean;
  rules: ThemeRule[];
  colors: ThemeColors;
}

export interface ThemeRule {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

export interface ThemeColors {
  [key: string]: string;
}

export interface EditorCommand {
  id: string;
  title: string;
  category?: string;
  keybinding?: string;
  execute: (...args: any[]) => void;
}

export interface EditorShortcut {
  keybinding: string;
  command: string;
  when?: string;
}

export interface FileEncoding {
  name: string;
  charset: string;
  bom?: boolean;
}

export interface LineEnding {
  type: 'CRLF' | 'LF' | 'CR';
  label: string;
  value: string;
}
