import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

interface DiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  language: string;
  filePath: string;
  onAccept?: () => void;
  onReject?: () => void;
}

/**
 * Side-by-side diff viewer using Monaco's built-in DiffEditor.
 * Used for:
 * - Viewing AI-generated code changes (accept/reject)
 * - Git diff visualization
 * - File comparison
 */
export const DiffViewer: React.FC<DiffViewerProps> = ({
  originalContent,
  modifiedContent,
  language,
  filePath: _filePath,
  onAccept,
  onReject,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create Monaco diff editor
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: 'ide-dark',
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      fontLigatures: true,
      lineHeight: 22,
      readOnly: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      originalEditable: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      padding: { top: 8, bottom: 8 },
      renderOverviewRuler: true,
      diffWordWrap: 'on',
    });

    diffEditorRef.current = diffEditor;

    // Create original and modified models
    const originalModel = monaco.editor.createModel(originalContent, language);
    const modifiedModel = monaco.editor.createModel(modifiedContent, language);

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    // Auto-scroll to first diff
    setTimeout(() => {
      const changes = diffEditor.getLineChanges();
      if (changes && changes.length > 0) {
        const firstChange = changes[0];
        diffEditor.getModifiedEditor().revealLineInCenter(firstChange.modifiedStartLineNumber);
      }
    }, 200);

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      diffEditor.layout();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      originalModel.dispose();
      modifiedModel.dispose();
      diffEditor.dispose();
      diffEditorRef.current = null;
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync content changes
  useEffect(() => {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;
    const model = diffEditor.getModel();
    if (!model) return;
    if (model.original.getValue() !== originalContent) {
      model.original.setValue(originalContent);
    }
    if (model.modified.getValue() !== modifiedContent) {
      model.modified.setValue(modifiedContent);
    }
  }, [originalContent, modifiedContent]);

  return (
    <div className="flex flex-col h-full">
      {/* Diff header */}
      <div className="flex items-center h-[32px] bg-[#252526] border-b border-[#3c3c3c] px-3 flex-shrink-0">
        <div className="flex items-center flex-1 gap-2">
          <span className="text-[11px] text-[#858585] font-medium uppercase tracking-wider">Changes</span>
          <div className="flex-1" />
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#c6524f] inline-block" />
              <span className="text-[#858585]">Original</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#4ec9b0] inline-block" />
              <span className="text-[#858585]">Modified</span>
            </span>
          </div>
        </div>
      </div>

      {/* Diff editor */}
      <div ref={containerRef} className="flex-1 min-h-0" />

      {/* Action buttons */}
      {(onAccept || onReject) && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 bg-[#252526] border-t border-[#3c3c3c] flex-shrink-0">
          {onReject && (
            <button
              className="px-3 py-1.5 text-[12px] text-[#cccccc] bg-[#3c3c3c] rounded hover:bg-[#4c4c4c] transition-colors"
              onClick={onReject}
            >
              Reject Changes
            </button>
          )}
          {onAccept && (
            <button
              className="px-3 py-1.5 text-[12px] text-white bg-[#007acc] rounded hover:bg-[#006bb3] transition-colors font-medium"
              onClick={onAccept}
            >
              Accept Changes
            </button>
          )}
        </div>
      )}
    </div>
  );
};
