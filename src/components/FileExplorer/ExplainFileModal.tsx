/**
 * ExplainFileModal — AI-powered file explanation popup
 * Shows an AI analysis of a file's purpose, structure, and key elements
 */
import React, { useState, useEffect } from 'react';
import { markdownInlineToHTML } from '@/utils/sanitize';
import { X, FileText, Loader2, Brain, Copy, Check } from 'lucide-react';

interface ExplainFileModalProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export const ExplainFileModal: React.FC<ExplainFileModalProps> = ({ filePath, fileName, onClose }) => {
  const [explanation, setExplanation] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const explain = async () => {
      try {
        // Read the file content
        const fileResult = await window.electronAPI?.readFile(filePath);
        if (!fileResult?.success || !fileResult.content) {
          setError('Could not read file contents.');
          setIsLoading(false);
          return;
        }

        const content = fileResult.content;
        // Truncate very large files
        const truncated = content.length > 15000 ? content.substring(0, 15000) + '\n\n... (truncated)' : content;

        const prompt = `Analyze this file and provide a clear, structured explanation. Be concise but thorough.

**File:** ${fileName}
**Path:** ${filePath}

\`\`\`
${truncated}
\`\`\`

Provide:
1. **Purpose** — What this file does in 1-2 sentences
2. **Key Elements** — Main functions/classes/components/exports with brief descriptions
3. **Dependencies** — What it imports and relies on
4. **How It Works** — Brief explanation of the logic flow
5. **Notable Patterns** — Any design patterns, potential issues, or interesting techniques`;

        // Try cloud LLM first (Groq Llama 3.3 70B is free + ultra-fast), fall back to local
        let result;
        try {
          result = await window.electronAPI?.cloudLLMGenerate(prompt, {
            provider: 'groq',
            model: 'llama-3.3-70b-versatile',
            systemPrompt: 'You are guIDE, an AI coding assistant. Provide clear, well-structured file explanations using markdown formatting. Be concise and technical.',
            maxTokens: 2048,
            temperature: 0.3,
            stream: false,
          });
        } catch (_) {}

        if (!result?.text) {
          // Fallback to local LLM
          try {
            result = await window.electronAPI?.llmGenerate(prompt, { maxTokens: 2048, temperature: 0.3 });
          } catch (_) {}
        }

        if (cancelled) return;

        if (result?.text) {
          setExplanation(result.text);
        } else {
          setError('Could not generate explanation. Make sure a model is loaded or cloud API is configured.');
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'An unexpected error occurred.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    explain();
    return () => { cancelled = true; };
  }, [filePath, fileName]);

  const handleCopy = () => {
    navigator.clipboard.writeText(explanation);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Hide BrowserView while this modal is open (native overlay sits above DOM)
  useEffect(() => {
    window.dispatchEvent(new Event('browser-overlay-show'));
    return () => { window.dispatchEvent(new Event('browser-overlay-hide')); };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#1e1e1e] border border-[#3c3c3c] rounded-lg shadow-2xl w-[680px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3c3c3c] bg-[#252526] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-[#007acc]" />
            <span className="text-[13px] font-semibold text-[#cccccc]">Explain File</span>
            <span className="text-[11px] text-[#808080] ml-1">{fileName}</span>
          </div>
          <div className="flex items-center gap-1">
            {explanation && (
              <button
                onClick={handleCopy}
                className="text-[#858585] hover:text-white p-1 rounded hover:bg-[#ffffff10]"
                title="Copy explanation"
              >
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            )}
            <button onClick={onClose} className="text-[#858585] hover:text-white p-1 rounded hover:bg-[#ffffff10]">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 size={28} className="text-[#007acc] animate-spin" />
              <span className="text-[12px] text-[#808080]">Analyzing {fileName}...</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <FileText size={28} className="text-[#f44747]" />
              <span className="text-[12px] text-[#f44747]">{error}</span>
            </div>
          )}

          {explanation && (
            <div className="text-[13px] text-[#cccccc] leading-relaxed prose prose-invert prose-sm max-w-none
              [&_h1]:text-[15px] [&_h1]:font-bold [&_h1]:text-[#dcdcaa] [&_h1]:mb-2
              [&_h2]:text-[14px] [&_h2]:font-bold [&_h2]:text-[#dcdcaa] [&_h2]:mb-1 [&_h2]:mt-3
              [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-[#9cdcfe] [&_h3]:mb-1
              [&_strong]:text-[#569cd6]
              [&_code]:bg-[#2a2a2a] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[#ce9178] [&_code]:text-[12px]
              [&_pre]:bg-[#1a1a1a] [&_pre]:p-3 [&_pre]:rounded [&_pre]:border [&_pre]:border-[#3c3c3c] [&_pre]:overflow-x-auto
              [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1
              [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1
              [&_li]:text-[#cccccc]
              [&_p]:mb-2
            ">
              {/* Render markdown-like content */}
              {explanation.split('\n').map((line, i) => {
                // Headers
                if (line.startsWith('### ')) return <h3 key={i}>{line.slice(4)}</h3>;
                if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>;
                if (line.startsWith('# ')) return <h1 key={i}>{line.slice(2)}</h1>;
                // Bold headers like **Purpose**
                if (/^\*\*\d+\.\s/.test(line) || /^\*\*[A-Z]/.test(line)) {
                  const cleaned = line.replace(/\*\*/g, '');
                  return <h3 key={i} className="text-[#9cdcfe] font-semibold mt-3 mb-1">{cleaned}</h3>;
                }
                // List items
                if (line.startsWith('- ') || line.startsWith('* ')) {
                  const content = line.slice(2);
                  return <li key={i} dangerouslySetInnerHTML={{
                    __html: markdownInlineToHTML(content)
                  }} />;
                }
                // Numbered list
                if (/^\d+\.\s/.test(line)) {
                  const content = line.replace(/^\d+\.\s/, '');
                  return <li key={i} dangerouslySetInnerHTML={{
                    __html: markdownInlineToHTML(content)
                  }} />;
                }
                // Empty line
                if (!line.trim()) return <div key={i} className="h-2" />;
                // Regular paragraph
                return <p key={i} dangerouslySetInnerHTML={{
                  __html: markdownInlineToHTML(line)
                }} />;
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#3c3c3c] bg-[#252526] flex-shrink-0">
          <span className="text-[10px] text-[#606060]">Powered by guIDE AI</span>
          <button
            onClick={onClose}
            className="bg-[#007acc] text-white text-[12px] px-4 py-1 rounded hover:bg-[#006bb3] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
