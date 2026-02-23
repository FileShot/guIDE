/**
 * File type detection utilities and run command mappings — extracted from Editor.tsx.
 * Pure functions with no React dependency.
 */

// ── Extension sets ──────────────────────────────────────────────────
export const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml']);
export const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.mdown']);
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff', '.tif']);
export const BINARY_EXTENSIONS = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.zip', '.rar', '.7z', '.tar', '.gz', '.pdf', '.docx', '.xlsx', '.pptx', '.mp3', '.mp4', '.wav', '.avi', '.mov', '.gguf']);
export const JSON_EXTENSIONS = new Set(['.json', '.jsonc', '.json5', '.geojson']);
export const CSV_EXTENSIONS = new Set(['.csv', '.tsv']);
export const XML_EXTENSIONS = new Set(['.xml', '.xsl', '.xslt', '.rss', '.atom', '.plist']);
export const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);
export const TOML_EXTENSIONS = new Set(['.toml']);

// ── File extension helper ───────────────────────────────────────────
export function getFileExtension(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() || '';
  const dotIdx = name.lastIndexOf('.');
  return dotIdx >= 0 ? name.substring(dotIdx).toLowerCase() : '';
}

// ── Type checks ─────────────────────────────────────────────────────
export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getFileExtension(filePath));
}

export function isBinaryFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return BINARY_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
}

export function isHtmlFile(filePath: string): boolean {
  return HTML_EXTENSIONS.has(getFileExtension(filePath));
}

export function isMarkdownFile(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(getFileExtension(filePath));
}

export function isSvgFile(filePath: string): boolean {
  return getFileExtension(filePath) === '.svg';
}

export function isJsonFile(filePath: string): boolean {
  return JSON_EXTENSIONS.has(getFileExtension(filePath));
}

export function isCsvFile(filePath: string): boolean {
  return CSV_EXTENSIONS.has(getFileExtension(filePath));
}

export function isXmlFile(filePath: string): boolean {
  return XML_EXTENSIONS.has(getFileExtension(filePath));
}

export function isYamlFile(filePath: string): boolean {
  return YAML_EXTENSIONS.has(getFileExtension(filePath));
}

export function isTomlFile(filePath: string): boolean {
  return TOML_EXTENSIONS.has(getFileExtension(filePath));
}

export function isDataPreviewable(filePath: string): boolean {
  return isJsonFile(filePath) || isCsvFile(filePath) || isXmlFile(filePath) || isYamlFile(filePath) || isTomlFile(filePath);
}

export function isPreviewableFile(filePath: string): boolean {
  return isHtmlFile(filePath) || isMarkdownFile(filePath) || isSvgFile(filePath) || isDataPreviewable(filePath);
}

export function getPreviewLabel(filePath: string): string {
  if (isHtmlFile(filePath)) return 'Preview HTML';
  if (isMarkdownFile(filePath)) return 'Preview Markdown';
  if (isSvgFile(filePath)) return 'Preview SVG';
  if (isJsonFile(filePath)) return 'Preview JSON';
  if (isCsvFile(filePath)) return 'Preview Table';
  if (isXmlFile(filePath)) return 'Preview XML';
  if (isYamlFile(filePath)) return 'Preview YAML';
  if (isTomlFile(filePath)) return 'Preview TOML';
  return 'Preview';
}

// ── Run commands ────────────────────────────────────────────────────
export const RUN_COMMANDS: Record<string, (filePath: string) => string> = {
  '.py': (f) => `python "${f}"`,
  '.js': (f) => `node "${f}"`,
  '.mjs': (f) => `node "${f}"`,
  '.cjs': (f) => `node "${f}"`,
  '.ts': (f) => `npx tsx "${f}"`,
  '.tsx': (f) => `npx tsx "${f}"`,
  '.java': (f) => {
    const cls = (f.split(/[/\\]/).pop() || '').replace('.java', '');
    const dir = f.replace(/[/\\][^/\\]+$/, '');
    return `cd "${dir}" && javac "${cls}.java" && java "${cls}"`;
  },
  '.c': (f) => { const out = f.replace(/\.c$/, '.exe'); return `gcc "${f}" -o "${out}" && "${out}"`; },
  '.cpp': (f) => { const out = f.replace(/\.cpp$/, '.exe'); return `g++ "${f}" -o "${out}" && "${out}"`; },
  '.cc': (f) => { const out = f.replace(/\.cc$/, '.exe'); return `g++ "${f}" -o "${out}" && "${out}"`; },
  '.rs': (f) => { const out = f.replace(/\.rs$/, '.exe'); return `rustc "${f}" -o "${out}" && "${out}"`; },
  '.go': (f) => `go run "${f}"`,
  '.rb': (f) => `ruby "${f}"`,
  '.php': (f) => `php "${f}"`,
  '.pl': (f) => `perl "${f}"`,
  '.sh': (f) => `bash "${f}"`,
  '.bat': (f) => `"${f}"`,
  '.cmd': (f) => `"${f}"`,
  '.ps1': (f) => `powershell -ExecutionPolicy Bypass -File "${f}"`,
  '.lua': (f) => `lua "${f}"`,
  '.r': (f) => `Rscript "${f}"`,
  '.R': (f) => `Rscript "${f}"`,
  '.swift': (f) => `swift "${f}"`,
  '.kt': (f) => { const out = f.replace(/\.kt$/, '.jar'); return `kotlinc "${f}" -include-runtime -d "${out}" && java -jar "${out}"`; },
  '.dart': (f) => `dart run "${f}"`,
  '.jl': (f) => `julia "${f}"`,
  '.scala': (f) => `scala "${f}"`,
  '.cs': (f) => `dotnet-script "${f}"`,
  '.ex': (f) => `elixir "${f}"`,
  '.exs': (f) => `elixir "${f}"`,
  '.hs': (f) => `runhaskell "${f}"`,
  '.lhs': (f) => `runhaskell "${f}"`,
  '.clj': (f) => `clj -M "${f}"`,
  '.cljs': (f) => `clj -M "${f}"`,
  '.fsx': (f) => `dotnet fsi "${f}"`,
  '.fs': (f) => `dotnet fsi "${f}"`,
  '.nim': (f) => `nim compile --run "${f}"`,
  '.zig': (f) => `zig run "${f}"`,
  '.v': (f) => `v run "${f}"`,
  '.ml': (f) => `ocaml "${f}"`,
  '.lisp': (f) => `sbcl --script "${f}"`,
  '.cl': (f) => `sbcl --script "${f}"`,
  '.scm': (f) => `guile "${f}"`,
  '.rkt': (f) => `racket "${f}"`,
  '.groovy': (f) => `groovy "${f}"`,
  '.cr': (f) => `crystal run "${f}"`,
  '.d': (f) => `dmd -run "${f}"`,
  '.coffee': (f) => `coffee "${f}"`,
  '.tcl': (f) => `tclsh "${f}"`,
  '.f90': (f) => {
    const isWin = typeof navigator !== 'undefined' && /win/i.test((navigator.platform || navigator.userAgent || ''));
    const out = f.replace(/\.f90$/, isWin ? '.exe' : '');
    return `gfortran "${f}" -o "${out}" && "${out}"`;
  },
  '.f95': (f) => {
    const isWin = typeof navigator !== 'undefined' && /win/i.test((navigator.platform || navigator.userAgent || ''));
    const out = f.replace(/\.f95$/, isWin ? '.exe' : '');
    return `gfortran "${f}" -o "${out}" && "${out}"`;
  },
  '.jsx': (f) => `npx tsx "${f}"`,
  '.erl': (f) => `escript "${f}"`,
  '.pro': (f) => `swipl -s "${f}"`,
  '.adb': (f) => { const base = (f.split(/[/\\]/).pop() || '').replace('.adb', ''); const dir = f.replace(/[/\\][^/\\]+$/, ''); return `cd "${dir}" && gnatmake "${base}" && "./${base}"`; },
  '.pas': (f) => { const out = f.replace(/\.pas$/, ''); return `fpc "${f}" && "${out}"`; },
  '.asm': (f) => { const out = f.replace(/\.asm$/, ''); return `nasm -f elf64 "${f}" -o "${out}.o" && ld "${out}.o" -o "${out}" && "${out}"`; },
  'Makefile': (f) => { const dir = f.replace(/[/\\][^/\\]+$/, ''); return `cd "${dir}" && make`; },
  'Dockerfile': (f) => { const dir = f.replace(/[/\\][^/\\]+$/, ''); return `cd "${dir}" && docker build .`; },
  '.sql': (f) => `sqlite3 < "${f}"`,
  '.scss': (f) => { const out = f.replace(/\.scss$/, '.css'); return `sass "${f}" "${out}"`; },
  '.sass': (f) => { const out = f.replace(/\.sass$/, '.css'); return `sass "${f}" "${out}"`; },
  '.less': (f) => { const out = f.replace(/\.less$/, '.css'); return `lessc "${f}" "${out}"`; },
  '.tf': (f) => { const dir = f.replace(/[/\\][^/\\]+$/, ''); return `cd "${dir}" && terraform plan`; },
};

export function isRunnableFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  const name = filePath.split(/[/\\]/).pop() || '';
  return ext in RUN_COMMANDS || name in RUN_COMMANDS || isHtmlFile(filePath);
}

export function getRunCommand(filePath: string): string | null {
  const ext = getFileExtension(filePath);
  const name = filePath.split(/[/\\]/).pop() || '';
  const cmdFn = RUN_COMMANDS[ext] || RUN_COMMANDS[name];
  return cmdFn ? cmdFn(filePath) : null;
}
