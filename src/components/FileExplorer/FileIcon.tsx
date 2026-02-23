import React, { useState } from 'react';
import { getFileExtension } from '@/utils/helpers';
import type { FileNode } from '@/types/file';

/**
 * File icons powered by file-icon-vectors (vivid set) — 364 professional SVG icons.
 * Falls back to a generic document icon if no matching SVG exists.
 * Source: https://github.com/dmhendricks/file-icon-vectors (MIT License)
 */

// Extension aliases: map extensions without a dedicated SVG to one that exists
const EXTENSION_ALIASES: Record<string, string> = {
  htm: 'html', mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts',
  tsx: 'jsx', pyw: 'py', pyx: 'py',
  jsonc: 'json', dockerfile: 'docker',
  gitattributes: 'gitignore', gitmodules: 'gitignore',
  mdx: 'md', markdown: 'md', rst: 'txt',
  phtml: 'php', erb: 'rb', rake: 'rb',
  cc: 'cpp', cxx: 'cpp', hpp: 'h', hxx: 'h',
  zsh: 'bash', fish: 'bash',
  sqlite: 'sql', sqlite3: 'sql', db: 'sql',
  jpeg: 'jpg', webp: 'png', bmp: 'png',
  mkv: 'mp4', avi: 'mp4', mov: 'mp4', wmv: 'mp4', webm: 'mp4', flv: 'mp4',
  wav: 'mp3', flac: 'mp3', aac: 'mp3', ogg: 'mp3', m4a: 'mp3',
  tar: 'gz', bz2: 'gz', '7z': 'zip',
  ps1: 'bat', cmd: 'bat',
  jar: 'java', class: 'java',
  rlib: 'dll', lib: 'dll', mod: 'go',
  svelte: 'vue',
};

// The folder icon path from the vivid set
const FOLDER_ICON_PATH = './icons/folder.svg';

interface FileIconProps {
  file: FileNode;
  className?: string;
  isOpen?: boolean;
  size?: number;
}

export const FileIcon: React.FC<FileIconProps> = ({ file, className = '', isOpen: _isOpen, size = 14 }) => {
  const [imgError, setImgError] = useState(false);
  const isDir = file.type === 'directory';

  if (isDir) {
    return (
      <span className={`inline-flex items-center justify-center select-none ${className}`} title={file.name}>
        <img
          src={FOLDER_ICON_PATH}
          alt=""
          width={size}
          height={size}
          style={{ opacity: file.name.startsWith('.') ? 0.5 : 1 }}
          draggable={false}
        />
      </span>
    );
  }

  const rawExt = getFileExtension(file.name);
  const ext = EXTENSION_ALIASES[rawExt] || rawExt;
  const iconPath = ext ? `./icons/${ext}.svg` : '';

  // If there's no extension or the img failed to load, show generic blank icon
  if (!iconPath || imgError) {
    return (
      <span className={`inline-flex items-center justify-center select-none ${className}`} title={file.name}>
        <img src="./icons/blank.svg" alt="" width={size} height={size} draggable={false} />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center justify-center select-none ${className}`} title={file.name}>
      <img
        src={iconPath}
        alt=""
        width={size}
        height={size}
        draggable={false}
        onError={() => setImgError(true)}
      />
    </span>
  );
};
