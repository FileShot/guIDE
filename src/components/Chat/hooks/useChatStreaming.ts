/**
 * useChatStreaming — Manages streaming token/thinking state with RAF batching.
 * Extracted from ChatPanel to isolate the complex streaming logic.
 */
import { useState, useRef, useEffect, MutableRefObject } from 'react';

export interface ChatStreamingState {
  streamingText: string;
  thinkingSegments: string[];
  setStreamingText: React.Dispatch<React.SetStateAction<string>>;
  setThinkingSegments: React.Dispatch<React.SetStateAction<string[]>>;
  /** Direct ref to the stream buffer (used by sendMessage to read accumulated text) */
  streamBufferRef: MutableRefObject<string>;
  /** Direct ref to thinking segments array */
  thinkingSegmentsRef: MutableRefObject<string[]>;
  /** Whether the last token was a response (not thinking) */
  wasRespondingRef: MutableRefObject<boolean>;
  /** Increment this to invalidate all in-flight tokens (used by clearChat/cancel) */
  streamEpochRef: MutableRefObject<number>;
  /** Set this to streamEpochRef.current when starting a new generation */
  activeEpochRef: MutableRefObject<number>;
  /**
   * Resolves when the typewriter animation has fully revealed all buffered chars.
   * Await this before committing the assistant message bubble so the committed text
   * matches exactly what was already visible — prevents wall-of-text flash on fast
   * cloud responses where dispose() flushes a large batch in one IPC call.
   */
  waitForTypewriterDone: () => Promise<void>;
}

export function useChatStreaming(): ChatStreamingState {
  const [streamingText, setStreamingText] = useState('');
  const [thinkingSegments, setThinkingSegments] = useState<string[]>([]);

  const streamBufferRef = useRef('');
  const displayPosRef = useRef(0); // typewriter: how many chars of the buffer are currently visible
  const thinkingSegmentsRef = useRef<string[]>([]);
  const wasRespondingRef = useRef(false);
  const streamRafRef = useRef<number | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingRafRef = useRef<number | null>(null);
  const streamDirtyRef = useRef(false);
  const thinkingDirtyRef = useRef(false);
  const lastFlushTimeRef = useRef(0);
  const streamEpochRef = useRef(0);
  const activeEpochRef = useRef(0);
  const iterationStartOffsetRef = useRef(0); // offset where current iteration's text starts in streamBufferRef

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLlmToken) return;

    // Token callbacks compare streamEpochRef against activeEpochRef.
    // - streamEpochRef is incremented on clear/cancel (invalidates current generation)
    // - activeEpochRef is set to streamEpochRef.current when a NEW generation starts
    // This way, tokens are accepted during active generation, but discarded after clear/cancel
    // until a new generation begins and re-syncs the epochs.

    // Throttled display: flush buffer to React state at most every STREAM_THROTTLE_MS.
    // Each flush triggers renderStreamingContent() which runs O(n) parsing on the
    // full buffer (extractCompleteBlocks, markdownInlineToHTML, DOMPurify).
    // At 16ms/frame (RAF), a 5000+ char buffer causes >50ms render cycles that block
    // the event loop and freeze the browser. Throttling to 100ms keeps the UI responsive
    // while still showing ~10 visual updates per second during active generation.
    // For short buffers (<200 chars), updates happen immediately via RAF for fast startup.
    const STREAM_THROTTLE_MS = 100;

    const flushStreamUpdate = () => {
      streamRafRef.current = null;
      streamTimerRef.current = null;
      streamDirtyRef.current = false;
      lastFlushTimeRef.current = Date.now();
      const buffer = streamBufferRef.current;
      displayPosRef.current = buffer.length;
      if (buffer.length <= 50 || buffer.length % 500 < 20) {
        console.log('[STREAM-DIAG] flushStreamUpdate: bufLen=', buffer.length, 'preview:', JSON.stringify(buffer.slice(0, 40)));
      }
      setStreamingText(buffer);
    };
    const flushThinkingUpdate = () => {
      thinkingRafRef.current = null;
      if (thinkingDirtyRef.current) {
        thinkingDirtyRef.current = false;
        setThinkingSegments([...thinkingSegmentsRef.current]);
      }
    };

    const scheduleStreamUpdate = () => {
      streamDirtyRef.current = true;
      // Short buffers: update immediately via RAF for fast perceived startup
      if (streamBufferRef.current.length < 200) {
        if (streamTimerRef.current) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
        if (!streamRafRef.current) {
          streamRafRef.current = requestAnimationFrame(flushStreamUpdate);
        }
        return;
      }
      // Longer buffers: throttle to STREAM_THROTTLE_MS to prevent event loop blocking
      if (streamRafRef.current) { cancelAnimationFrame(streamRafRef.current); streamRafRef.current = null; }
      if (streamTimerRef.current) return; // timer already pending
      const elapsed = Date.now() - lastFlushTimeRef.current;
      if (elapsed >= STREAM_THROTTLE_MS) {
        streamRafRef.current = requestAnimationFrame(flushStreamUpdate);
      } else {
        streamTimerRef.current = setTimeout(flushStreamUpdate, STREAM_THROTTLE_MS - elapsed);
      }
    };
    const scheduleThinkingUpdate = () => {
      thinkingDirtyRef.current = true;
      if (!thinkingRafRef.current) {
        thinkingRafRef.current = requestAnimationFrame(flushThinkingUpdate);
      }
    };

    const cleanupToken = api.onLlmToken((token: string) => {
      // Discard tokens when epoch is out of sync (stale IPC pipeline tokens after clear/cancel)
      if (streamEpochRef.current !== activeEpochRef.current) {
        console.warn('[STREAM-DIAG] Token DISCARDED — epoch mismatch:', streamEpochRef.current, '!==', activeEpochRef.current, 'token:', token.slice(0, 30));
        return;
      }

      streamBufferRef.current += token;
      // Diagnostic: log first 5 tokens and every 50th after
      const bufLen = streamBufferRef.current.length;
      if (bufLen <= 50 || bufLen % 500 < token.length) {
        console.log('[STREAM-DIAG] Token received, bufLen:', bufLen, 'token:', JSON.stringify(token.slice(0, 20)));
      }
      wasRespondingRef.current = true;

      // Normalize <thinking> variants to <think>
      streamBufferRef.current = streamBufferRef.current
        .replace(/<thinking>/gi, '<think>')
        .replace(/<\/thinking>/gi, '</think>');

      // Frontend fallback: detect <think>...</think> tags
      const buf = streamBufferRef.current;
      const thinkStart = buf.indexOf('<think>');
      if (thinkStart !== -1) {
        const thinkEnd = buf.indexOf('</think>', thinkStart);
        if (thinkEnd !== -1) {
          const thinkContent = buf.substring(thinkStart + 7, thinkEnd);
          if (wasRespondingRef.current || thinkingSegmentsRef.current.length === 0) {
            thinkingSegmentsRef.current.push(thinkContent);
          } else {
            thinkingSegmentsRef.current[thinkingSegmentsRef.current.length - 1] += thinkContent;
          }
          wasRespondingRef.current = false;
          streamBufferRef.current = buf.substring(0, thinkStart) + buf.substring(thinkEnd + 8);
          scheduleStreamUpdate();
          scheduleThinkingUpdate();
        } else {
          // <think> found but </think> not yet — partial thinking in progress.
          // Show partial thinking content in the ThinkingBlock so user sees model reasoning.
          const partialThink = buf.substring(thinkStart + 7);
          if (partialThink.trim()) {
            if (thinkingSegmentsRef.current.length === 0) {
              thinkingSegmentsRef.current.push(partialThink);
            } else {
              // Update the last segment with the latest content
              thinkingSegmentsRef.current[thinkingSegmentsRef.current.length - 1] = partialThink;
            }
            scheduleThinkingUpdate();
          }

          streamDirtyRef.current = true;
          if (!streamRafRef.current) {
            streamRafRef.current = requestAnimationFrame(() => {
              streamRafRef.current = null;
              const b = streamBufferRef.current;
              const ts = b.indexOf('<think>');
              const visibleText = ts !== -1 ? b.substring(0, ts) : b;
              displayPosRef.current = visibleText.length;
              setStreamingText(visibleText);
            });
          }
        }
      } else {
        scheduleStreamUpdate();
      }
    });

    const cleanupThinking = api.onLlmThinkingToken?.((token: string) => {
      // Discard stale thinking tokens when epoch out of sync
      if (streamEpochRef.current !== activeEpochRef.current) return;

      if (wasRespondingRef.current || thinkingSegmentsRef.current.length === 0) {
        thinkingSegmentsRef.current.push(token);
        wasRespondingRef.current = false;
      } else {
        thinkingSegmentsRef.current[thinkingSegmentsRef.current.length - 1] += token;
      }
      // Strip artifacts that bleed from tool-calling iterations and planning directives into thinking output.
      // Models sometimes write `json or ```json inside <think> as a self-note before outputting a tool call.
      // Also strip planning directive headers that the pipeline injects — these are not user-facing reasoning.
      const lastIdx = thinkingSegmentsRef.current.length - 1;
      thinkingSegmentsRef.current[lastIdx] = thinkingSegmentsRef.current[lastIdx]
        // Strip complete tool-call code blocks (```json ... ``` etc.) that bleed from context summaries
        .replace(/```(?:json|tool_call|tool)[^\n]*\n[\s\S]*?```/g, '')
        // Strip any remaining lone opening fence markers left after partial streaming
        .replace(/^`{1,3}(?:json|tool_call|tool)\s*/gim, '')
  // Strip pipeline planning directive headers that models echo in reasoning
        .replace(/^##\s*(?:NEXT STEP|CURRENT STEP|PLAN COMPLETE)[^\n]*\n?/gim, '')
        .replace(/^\*\*(?:NOW|DO NOW):\*\*[^\n]*\n?/gim, '')
        // Strip reasoning step header artifacts (dashes + "next reasoning step" + dashes)
        // Only strips the header formatting, NOT the actual reasoning content
        .replace(/^-{3,}\s*\n?/gm, '')
        .replace(/^[\s-]*(?:next|current)\s+reasoning\s+step[\s-]*$/gim, '');
      scheduleThinkingUpdate();
    });

    // Track where the current iteration's text starts in the accumulated buffer.
    // When the backend sends llm-replace-last with just the current iteration's cleaned text,
    // we prepend prior iterations' text so we don't wipe what the user was reading.
    const cleanupIterationBegin = (api as any).onLlmIterationBegin?.(() => {
      console.log('[STREAM-DIAG] llm-iteration-begin: offset set to', streamBufferRef.current.length);
      iterationStartOffsetRef.current = streamBufferRef.current.length;
    });

    // Anti-hallucination: backend detected fake tool results, or tool-call iteration wipe.
    // The backend (agenticChat.js) already routes any planning text to llm-thinking-token
    // BEFORE sending llm-replace-last, so we just wipe this iteration's slot here.
    const cleanupReplace = api.onLlmReplaceLast?.((cleanedText: string) => {
      if (streamEpochRef.current !== activeEpochRef.current) return;
      const prefix = streamBufferRef.current.slice(0, iterationStartOffsetRef.current);
      console.log('[STREAM-DIAG] llm-replace-last: prefixLen=', prefix.length, 'cleanedLen=', cleanedText.length, 'cleaned:', JSON.stringify((cleanedText || '').slice(0, 60)));
      // Preserve text from prior iterations — only replace current iteration's portion
      streamBufferRef.current = prefix + cleanedText;
      // Jump display to buffer end — corrections show immediately, no typewriter delay
      displayPosRef.current = streamBufferRef.current.length;
      scheduleStreamUpdate();
    });

    return () => {
      cleanupToken?.();
      cleanupThinking?.();
      cleanupIterationBegin?.();
      cleanupReplace?.();
      if (streamRafRef.current) cancelAnimationFrame(streamRafRef.current);
      if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
      if (thinkingRafRef.current) cancelAnimationFrame(thinkingRafRef.current);
    };
  }, []);

  /**
   * Poll via RAF until the typewriter has revealed all chars in streamBufferRef.
   * For local models this resolves in 0-1 frames (typewriter always caught up).
   * For bundled cloud where dispose() delivers a large batch, this waits until the
   * 100 chars/sec animation finishes before the caller commits the bubble.
   * 30-second safety ceiling prevents hanging if something goes wrong.
   */
  const waitForTypewriterDone = (): Promise<void> => {
    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = () => { if (!resolved) { resolved = true; resolve(); } };
      const check = () => {
        if (displayPosRef.current >= streamBufferRef.current.length) {
          safeResolve();
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
      // Safety ceiling — resolve unconditionally after 30s
      setTimeout(safeResolve, 30000);
    });
  };

  return {
    streamingText, thinkingSegments,
    setStreamingText, setThinkingSegments,
    streamBufferRef, thinkingSegmentsRef, wasRespondingRef,
    streamEpochRef, activeEpochRef, waitForTypewriterDone,
  };
}
