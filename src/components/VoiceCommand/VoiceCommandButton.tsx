/**
 * VoiceCommandButton — Floating push-to-talk button for voice commands.
 * Shows recording state, transcription feedback, and processed command.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, Loader, X, Volume2 } from 'lucide-react';
import { useVoiceCommand, VoiceCommandResult } from './useVoiceCommand';

interface VoiceCommandButtonProps {
  onAction: (action: string, params?: Record<string, any>) => void;
  onChatMessage?: (message: string) => void;
}

export const VoiceCommandButton: React.FC<VoiceCommandButtonProps> = ({ onAction, onChatMessage }) => {
  const [feedback, setFeedback] = useState<{ type: 'transcription' | 'command' | 'error'; text: string } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = (type: 'transcription' | 'command' | 'error', text: string) => {
    setFeedback({ type, text });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 4000);
  };

  const handleCommand = useCallback((command: VoiceCommandResult) => {
    const actionMap: Record<string, () => void> = {
      'open-file': () => {
        // Dispatch file search with the query
        if (command.query) {
          onAction('find-in-files');
          // Also dispatch as custom event for search panel to pick up
          window.dispatchEvent(new CustomEvent('voice-search-file', { detail: { query: command.query } }));
          showFeedback('command', `Opening: ${command.query}`);
        }
      },
      'go-to-line': () => {
        if (command.line) {
          window.dispatchEvent(new CustomEvent('voice-go-to-line', { detail: { line: command.line } }));
          showFeedback('command', `Go to line ${command.line}`);
        }
      },
      'search': () => {
        if (command.query) {
          onAction('find-in-files');
          window.dispatchEvent(new CustomEvent('voice-search', { detail: { query: command.query } }));
          showFeedback('command', `Searching: ${command.query}`);
        }
      },
      'run-command': () => {
        if (command.command) {
          onAction('toggle-terminal');
          window.dispatchEvent(new CustomEvent('voice-run-command', { detail: { command: command.command } }));
          showFeedback('command', `Running: ${command.command}`);
        }
      },
      'new-file': () => { onAction('new-file'); showFeedback('command', 'New file'); },
      'save': () => { onAction('save'); showFeedback('command', 'File saved'); },
      'toggle-terminal': () => { onAction('toggle-terminal'); showFeedback('command', 'Toggle terminal'); },
      'toggle-sidebar': () => { onAction('toggle-sidebar'); showFeedback('command', 'Toggle sidebar'); },
      'command-palette': () => { onAction('command-palette'); showFeedback('command', 'Command palette'); },
      'undo': () => { document.execCommand('undo'); showFeedback('command', 'Undo'); },
      'redo': () => { document.execCommand('redo'); showFeedback('command', 'Redo'); },
      'close-file': () => {
        window.dispatchEvent(new CustomEvent('voice-close-file'));
        showFeedback('command', 'Close file');
      },
      'new-project': () => { onAction('new-project'); showFeedback('command', 'New project'); },
      'git-commit': () => {
        if (command.message) {
          window.electronAPI?.gitStageAll?.().then(() => {
            window.electronAPI?.gitCommit?.(command.message!);
            showFeedback('command', `Committed: ${command.message}`);
          });
        }
      },
      'git-push': () => {
        window.electronAPI?.gitPush?.();
        showFeedback('command', 'Pushing...');
      },
      'git-pull': () => {
        window.electronAPI?.gitPull?.();
        showFeedback('command', 'Pulling...');
      },
      'git-create-branch': () => {
        if (command.name) {
          window.electronAPI?.gitCreateBranch?.(command.name, true);
          showFeedback('command', `Created branch: ${command.name}`);
        }
      },
      'find-replace': () => {
        window.dispatchEvent(new CustomEvent('voice-find-replace', {
          detail: { find: command.find, replace: command.replace }
        }));
        showFeedback('command', `Find: ${command.find} → ${command.replace}`);
      },
      'insert-text': () => {
        if (command.text) {
          window.dispatchEvent(new CustomEvent('voice-insert-text', { detail: { text: command.text } }));
          showFeedback('command', 'Text inserted');
        }
      },
      'ask-ai': () => {
        if (command.message) {
          onChatMessage?.(command.message);
          showFeedback('command', `AI: ${command.message.substring(0, 50)}...`);
        }
      },
    };

    const handler = actionMap[command.action];
    if (handler) {
      handler();
    } else {
      // Unknown action — treat as chat
      onChatMessage?.(command.message || JSON.stringify(command));
      showFeedback('command', `Command: ${command.action}`);
    }
  }, [onAction, onChatMessage]);

  const handleError = useCallback((error: string) => {
    showFeedback('error', error);
  }, []);

  const handleTranscription = useCallback((text: string) => {
    showFeedback('transcription', `"${text}"`);
  }, []);

  const { isRecording, isProcessing, toggleRecording } = useVoiceCommand({
    onCommand: handleCommand,
    onTranscription: handleTranscription,
    onError: handleError,
  });

  useEffect(() => {
    // Global keyboard shortcut: Ctrl+Shift+V for voice command
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        toggleRecording();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleRecording]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  return (
    <>
      {/* Voice command button in status bar area */}
      <button
        onClick={toggleRecording}
        disabled={isProcessing}
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-all ${
          isRecording
            ? 'bg-[#f14c4c] text-white animate-pulse'
            : isProcessing
              ? 'bg-[#dcdcaa30] text-[#dcdcaa]'
              : 'hover:bg-[#ffffff15] text-[#858585] hover:text-[#cccccc]'
        }`}
        title={isRecording ? 'Stop recording (Ctrl+Shift+V)' : isProcessing ? 'Processing...' : 'Voice command (Ctrl+Shift+V)'}
      >
        {isRecording ? (
          <>
            <Mic size={12} />
            <span className="hidden sm:inline">Listening...</span>
            <span className="flex gap-0.5 items-end h-3">
              {[1, 2, 3].map(i => (
                <span
                  key={i}
                  className="w-[2px] bg-white rounded-full"
                  style={{
                    animation: `voiceWave 0.5s ease-in-out infinite alternate`,
                    animationDelay: `${i * 0.15}s`,
                    height: '4px',
                  }}
                />
              ))}
            </span>
          </>
        ) : isProcessing ? (
          <>
            <Loader size={12} className="animate-spin" />
            <span className="hidden sm:inline">Processing...</span>
          </>
        ) : (
          <>
            <Mic size={12} />
          </>
        )}
      </button>

      {/* Feedback tooltip */}
      {feedback && (
        <div className={`fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-[12px] max-w-[400px] flex items-center gap-2 animate-[fadeInUp_0.2s_ease-out] ${
          feedback.type === 'error'
            ? 'bg-[#f14c4c] text-white'
            : feedback.type === 'command'
              ? 'bg-[#007acc] text-white'
              : 'bg-[#3c3c3c] text-[#cccccc] border border-[#555]'
        }`}>
          {feedback.type === 'transcription' && <Volume2 size={14} />}
          {feedback.type === 'command' && <Mic size={14} />}
          <span className="truncate">{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="ml-2 hover:opacity-70 flex-shrink-0">
            <X size={12} />
          </button>
        </div>
      )}

      {/* CSS for voice wave animation */}
      <style>{`
        @keyframes voiceWave {
          from { height: 3px; }
          to { height: 12px; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 8px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </>
  );
};
