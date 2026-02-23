export const FILE_ICONS: Record<string, string> = {
  // Programming languages
  js: 'JS',
  jsx: 'JSX',
  ts: 'TS',
  tsx: 'TSX',
  py: 'PY',
  java: 'JV',
  cpp: 'C++',
  c: 'C',
  h: 'H',
  hpp: 'H++',
  cs: 'C#',
  php: 'PHP',
  rb: 'RB',
  go: 'GO',
  rs: 'RS',
  swift: 'SW',
  kt: 'KT',
  scala: 'SC',
  dart: 'DT',
  
  // Web technologies
  html: 'HTM',
  htm: 'HTM',
  css: 'CSS',
  scss: 'SCS',
  sass: 'SAS',
  less: 'LES',
  vue: 'VUE',
  svelte: 'SVL',
  
  // Data formats
  json: 'JSN',
  xml: 'XML',
  yaml: 'YML',
  yml: 'YML',
  csv: 'CSV',
  toml: 'TML',
  ini: 'INI',
  
  // Documentation
  md: 'MD',
  txt: 'TXT',
  rst: 'RST',
  tex: 'TEX',
  
  // Configuration
  config: 'CFG',
  conf: 'CFG',
  env: 'ENV',
  dockerfile: 'DKR',
  gitignore: 'GIT',
  
  // Build tools
  gradle: 'GRD',
  maven: 'MVN',
  npm: 'NPM',
  yarn: 'YRN',
  makefile: 'MK',
  
  // Databases
  sql: 'SQL',
  db: 'DB',
  sqlite: 'SQL',
  
  // Shell scripts
  sh: 'SH',
  bash: 'SH',
  zsh: 'SH',
  fish: 'SH',
  ps1: 'PS1',
  bat: 'BAT',
  cmd: 'CMD',
  
  // Images
  png: 'IMG',
  jpg: 'IMG',
  jpeg: 'IMG',
  gif: 'GIF',
  svg: 'SVG',
  ico: 'ICO',
  bmp: 'IMG',
  webp: 'IMG',
  
  // Video
  mp4: 'VID',
  avi: 'VID',
  mov: 'VID',
  wmv: 'VID',
  flv: 'VID',
  webm: 'VID',
  
  // Audio
  mp3: 'AUD',
  wav: 'AUD',
  flac: 'AUD',
  aac: 'AUD',
  ogg: 'AUD',
  
  // Archives
  zip: 'ZIP',
  rar: 'RAR',
  tar: 'TAR',
  gz: 'GZ',
  '7z': '7Z',
  
  // GGUF models
  gguf: 'LLM',
  
  // Default
  default: 'FILE',
  folder: '▸',
  folderOpen: '▾',
  folderHidden: '▸',
};

export const LANGUAGE_MAP: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.md': 'markdown',
  '.py': 'python',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.dart': 'dart',
  '.vue': 'html',
  '.svelte': 'html',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.csv': 'plaintext',
  '.toml': 'toml',
  '.ini': 'ini',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',
  '.dockerfile': 'dockerfile',
  '.gitignore': 'plaintext',
  '.env': 'plaintext',
};

export const IGNORED_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.DS_Store',
  'Thumbs.db',
  '.vscode',
  '.idea',
  '*.tmp',
  '*.temp',
  '*.log',
  '.cache',
  'dist',
  'build',
  'coverage',
  '.nyc_output',
  '.next',
  '.nuxt',
  '.output',
  '.vercel',
  '.netlify',
];

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_FILES_PER_DIRECTORY = 10000;
export const SEARCH_DEBOUNCE_MS = 300;
export const FILE_WATCH_DEBOUNCE_MS = 100;
