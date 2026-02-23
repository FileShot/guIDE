import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Loader2, Check, Undo2 } from 'lucide-react';

/**
 * InlineChat — Ctrl+I triggers a lightweight prompt at the cursor position
 * in the Monaco editor. User types an instruction, AI returns edited code
 * which is shown as a diff preview. Accept or reject.
 */

interface InlineChatProps {
  editor: any; // monaco.editor.IStandaloneCodeEditor
  filePath: string;
  onClose: () => void;
}

export const InlineChat: React.FC<InlineChatProps> = ({ editor, filePath, onClose }) => {
  const [instruction, setInstruction] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [_result, setResult] = useState<string | null>(null);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (applied && originalText !== null) {
          // Revert if applied
          const model = editor?.getModel();
          if (model) {
            const selection = editor.getSelection();
            if (selection) {
              editor.executeEdits('inline-chat-revert', [{
                range: selection,
                text: originalText,
              }]);
            }
          }
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [applied, originalText, editor, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!instruction.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const api = window.electronAPI;
      if (!api) throw new Error('No API');

      const model = editor?.getModel();
      if (!model) throw new Error('No editor model');

      const selection = editor.getSelection();
      const selectedText = selection && !selection.isEmpty()
        ? model.getValueInRange(selection)
        : '';
      
      const position = editor.getPosition();
      const cursorLine = position?.lineNumber || 1;

      // Get surrounding context (20 lines around cursor)
      const startLine = Math.max(1, cursorLine - 10);
      const endLine = Math.min(model.getLineCount(), cursorLine + 10);
      const surrounding = model.getValueInRange({
        startLineNumber: startLine,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn: model.getLineMaxColumn(endLine),
      });

      const params: any = {
        filePath,
        fileContent: model.getValue(),
        selectedText,
        cursorLine,
        instruction: instruction.trim(),
        surrounding,
      };

      // Use cloud if configured
      try {
        const cloudProvider = localStorage.getItem('guide-cloud-provider');
        const cloudModel = localStorage.getItem('guide-cloud-model');
        if (cloudProvider && cloudModel) {
          params.cloudProvider = cloudProvider;
          params.cloudModel = cloudModel;
        }
      } catch (_) {}

      const response = await api.inlineEdit(params);

      if (response.success && response.code) {
        setResult(response.code);

        // Apply the edit as a preview
        if (selectedText) {
          setOriginalText(selectedText);
          editor.executeEdits('inline-chat', [{
            range: selection,
            text: response.code,
          }]);
        } else {
          // Insert at cursor
          const pos = editor.getPosition();
          if (pos) {
            setOriginalText('');
            editor.executeEdits('inline-chat', [{
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: pos.lineNumber,
                endColumn: pos.column,
              },
              text: response.code,
            }]);
          }
        }
        setApplied(true);
      } else {
        setError(response.error || 'No result');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [instruction, isLoading, editor, filePath]);

  const handleAccept = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleReject = useCallback(() => {
    if (applied && originalText !== null) {
      // Undo the edit
      editor?.trigger('inline-chat', 'undo', null);
    }
    onClose();
  }, [applied, originalText, editor, onClose]);

  return (
    <div
      ref={containerRef}
      className="absolute z-50 left-[60px] right-4"
      style={{ top: '50%', transform: 'translateY(-50%)' }}
    >
      <div className="bg-[#252526] border border-[#007acc] rounded-lg shadow-2xl overflow-hidden"
        style={{ boxShadow: '0 0 20px rgba(0,122,204,0.3)' }}>
        {/* Input row */}
        <div className="flex items-center gap-2 px-3 py-2">
          <Sparkles size={14} className="text-[#007acc] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (applied) handleAccept();
                else handleSubmit();
              }
            }}
            placeholder={applied ? 'Press Enter to accept, Escape to reject' : 'Describe the edit... (e.g. "add error handling")'}
            className="flex-1 bg-transparent text-[13px] text-[#cccccc] outline-none placeholder-[#6a6a6a]"
            disabled={isLoading}
          />
          {isLoading && <Loader2 size={14} className="text-[#007acc] animate-spin" />}
          {applied && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleAccept}
                className="p-1 rounded hover:bg-[#3c3c3c] text-green-400 transition-colors"
                title="Accept (Enter)"
              >
                <Check size={14} />
              </button>
              <button
                onClick={handleReject}
                className="p-1 rounded hover:bg-[#3c3c3c] text-red-400 transition-colors"
                title="Reject (Escape)"
              >
                <Undo2 size={14} />
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#3c3c3c] text-[#858585] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="px-3 py-1.5 text-[11px] text-red-400 bg-red-900/20 border-t border-[#333]">
            {error}
          </div>
        )}

        {/* Status */}
        {applied && !error && (
          <div className="px-3 py-1.5 text-[11px] text-green-400 bg-green-900/10 border-t border-[#333]">
            Edit applied — Enter to accept, Escape to revert
          </div>
        )}
      </div>
    </div>
  );
};
