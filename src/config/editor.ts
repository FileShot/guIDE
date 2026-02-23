import type { EditorConfig, LanguageInfo, FileEncoding, LineEnding } from '@/types/editor';

export const defaultEditorConfig: EditorConfig = {
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

export const supportedLanguages: LanguageInfo[] = [
  {
    id: 'javascript',
    name: 'JavaScript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    aliases: ['javascript', 'js']
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    extensions: ['.ts', '.tsx'],
    aliases: ['typescript', 'ts']
  },
  {
    id: 'html',
    name: 'HTML',
    extensions: ['.html', '.htm', '.xhtml'],
    mimetypes: ['text/html'],
    aliases: ['html', 'htm', 'xhtml']
  },
  {
    id: 'css',
    name: 'CSS',
    extensions: ['.css'],
    mimetypes: ['text/css'],
    aliases: ['css']
  },
  {
    id: 'scss',
    name: 'SCSS',
    extensions: ['.scss'],
    mimetypes: ['text/x-scss'],
    aliases: ['scss', 'sass']
  },
  {
    id: 'less',
    name: 'Less',
    extensions: ['.less'],
    mimetypes: ['text/x-less'],
    aliases: ['less']
  },
  {
    id: 'json',
    name: 'JSON',
    extensions: ['.json', '.jsonc'],
    mimetypes: ['application/json'],
    aliases: ['json', 'jsonc']
  },
  {
    id: 'markdown',
    name: 'Markdown',
    extensions: ['.md', '.markdown'],
    mimetypes: ['text/x-markdown'],
    aliases: ['markdown', 'md']
  },
  {
    id: 'python',
    name: 'Python',
    extensions: ['.py', '.pyi', '.pyw', '.pyc', '.pyo'],
    mimetypes: ['text/x-python'],
    aliases: ['python', 'py']
  },
  {
    id: 'java',
    name: 'Java',
    extensions: ['.java', '.class', '.jar'],
    mimetypes: ['text/x-java-source'],
    aliases: ['java']
  },
  {
    id: 'cpp',
    name: 'C++',
    extensions: ['.cpp', '.cxx', '.cc', '.c++', '.hpp', '.hh', '.hxx', '.h++'],
    mimetypes: ['text/x-c++src', 'text/x-c++hdr'],
    aliases: ['cpp', 'c++']
  },
  {
    id: 'c',
    name: 'C',
    extensions: ['.c', '.h'],
    mimetypes: ['text/x-csrc', 'text/x-chdr'],
    aliases: ['c']
  },
  {
    id: 'csharp',
    name: 'C#',
    extensions: ['.cs'],
    mimetypes: ['text/x-csharp'],
    aliases: ['csharp', 'c#', 'cs']
  },
  {
    id: 'php',
    name: 'PHP',
    extensions: ['.php', '.phtml', '.php3', '.php4', '.php5', '.phps'],
    mimetypes: ['application/x-httpd-php'],
    aliases: ['php', 'phtml']
  },
  {
    id: 'ruby',
    name: 'Ruby',
    extensions: ['.rb', '.rbw', '.gem', '.rake'],
    mimetypes: ['text/x-ruby'],
    aliases: ['ruby', 'rb']
  },
  {
    id: 'go',
    name: 'Go',
    extensions: ['.go'],
    mimetypes: ['text/x-go'],
    aliases: ['go']
  },
  {
    id: 'rust',
    name: 'Rust',
    extensions: ['.rs', '.rlib'],
    mimetypes: ['text/x-rust'],
    aliases: ['rust', 'rs']
  },
  {
    id: 'swift',
    name: 'Swift',
    extensions: ['.swift'],
    mimetypes: ['text/x-swift'],
    aliases: ['swift']
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    extensions: ['.kt', '.kts'],
    mimetypes: ['text/x-kotlin'],
    aliases: ['kotlin', 'kt']
  },
  {
    id: 'scala',
    name: 'Scala',
    extensions: ['.scala', '.sc'],
    mimetypes: ['text/x-scala'],
    aliases: ['scala', 'sc']
  },
  {
    id: 'dart',
    name: 'Dart',
    extensions: ['.dart'],
    mimetypes: ['text/x-dart'],
    aliases: ['dart']
  },
  {
    id: 'vue',
    name: 'Vue',
    extensions: ['.vue'],
    mimetypes: ['text/x-vue'],
    aliases: ['vue']
  },
  {
    id: 'svelte',
    name: 'Svelte',
    extensions: ['.svelte'],
    mimetypes: ['text/x-svelte'],
    aliases: ['svelte']
  },
  {
    id: 'xml',
    name: 'XML',
    extensions: ['.xml', '.xsl', '.xslt', '.xsd', '.dtd'],
    mimetypes: ['application/xml', 'text/xml'],
    aliases: ['xml', 'xsl', 'xslt', 'xsd']
  },
  {
    id: 'yaml',
    name: 'YAML',
    extensions: ['.yaml', '.yml'],
    mimetypes: ['text/x-yaml'],
    aliases: ['yaml', 'yml']
  },
  {
    id: 'toml',
    name: 'TOML',
    extensions: ['.toml'],
    mimetypes: ['text/x-toml'],
    aliases: ['toml']
  },
  {
    id: 'ini',
    name: 'INI',
    extensions: ['.ini', '.cfg', '.conf'],
    mimetypes: ['text/x-ini'],
    aliases: ['ini', 'cfg', 'conf']
  },
  {
    id: 'sql',
    name: 'SQL',
    extensions: ['.sql'],
    mimetypes: ['text/x-sql'],
    aliases: ['sql']
  },
  {
    id: 'shell',
    name: 'Shell',
    extensions: ['.sh', '.bash', '.zsh', '.fish'],
    mimetypes: ['text/x-shellscript'],
    aliases: ['shell', 'bash', 'sh', 'zsh', 'fish']
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    extensions: ['.ps1', '.psm1', '.psd1'],
    mimetypes: ['application/x-powershell'],
    aliases: ['powershell', 'ps1', 'ps']
  },
  {
    id: 'batch',
    name: 'Batch',
    extensions: ['.bat', '.cmd'],
    mimetypes: ['application/x-msdos-program'],
    aliases: ['batch', 'bat', 'cmd']
  },
  {
    id: 'dockerfile',
    name: 'Dockerfile',
    extensions: ['.dockerfile', 'Dockerfile'],
    mimetypes: ['text/x-dockerfile'],
    aliases: ['dockerfile', 'docker']
  },
  {
    id: 'plaintext',
    name: 'Plain Text',
    extensions: ['.txt', '.text'],
    mimetypes: ['text/plain'],
    aliases: ['plaintext', 'text', 'txt']
  }
];

export const fileEncodings: FileEncoding[] = [
  { name: 'UTF-8', charset: 'utf8' },
  { name: 'UTF-8 with BOM', charset: 'utf8', bom: true },
  { name: 'UTF-16 LE', charset: 'utf16le' },
  { name: 'UTF-16 BE', charset: 'utf16be' },
  { name: 'ASCII', charset: 'ascii' },
  { name: 'ISO-8859-1', charset: 'latin1' },
  { name: 'Windows-1252', charset: 'win1252' }
];

export const lineEndings: LineEnding[] = [
  { type: 'CRLF', label: 'Windows (CRLF)', value: '\r\n' },
  { type: 'LF', label: 'Unix/Linux (LF)', value: '\n' },
  { type: 'CR', label: 'Classic Mac (CR)', value: '\r' }
];

export function getLanguageFromExtension(extension: string): string {
  const language = supportedLanguages.find(lang => 
    lang.extensions.includes(extension.toLowerCase())
  );
  return language?.id || 'plaintext';
}

export function getLanguageInfo(languageId: string): LanguageInfo | undefined {
  return supportedLanguages.find(lang => lang.id === languageId);
}

export function getExtensionFromFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) {
    return '';
  }
  return fileName.substring(lastDot).toLowerCase();
}
