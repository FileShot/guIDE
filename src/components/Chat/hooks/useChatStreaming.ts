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
}

export function useChatStreaming(): ChatStreamingState {
  const [streamingText, setStreamingText] = useState('');
  const [thinkingSegments, setThinkingSegments] = useState<string[]>([]);

  const streamBufferRef = useRef('');
  const displayPosRef = useRef(0); // typewriter: how many chars of the buffer are currently visible
  const thinkingSegmentsRef = useRef<string[]>([]);
  const wasRespondingRef = useRef(false);
  const streamRafRef = useRef<number | null>(null);
  const thinkingRafRef = useRef<number | null>(null);
  const streamDirtyRef = useRef(false);
  const thinkingDirtyRef = useRef(false);
  const streamEpochRef = useRef(0);
  const activeEpochRef = useRef(0);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLlmToken) return;

    // Token callbacks compare streamEpochRef against activeEpochRef.
    // - streamEpochRef is incremented on clear/cancel (invalidates current generation)
    // - activeEpochRef is set to streamEpochRef.current when a NEW generation starts
    // This way, tokens are accepted during active generation, but discarded after clear/cancel
    // until a new generation begins and re-syncs the epochs.

    // Typewriter effect: advance at most this many chars per animation frame (~60fps).
    // 60 chars/frame × 60fps ≈ 3600 chars/sec — fast enough to feel responsive,
    // slow enough that rapid models (Cerebras 1000 tok/s) don't dump the whole response at once.
    const MAX_CHARS_PER_FRAME = 60;
    const flushStreamUpdate = () => {
      streamRafRef.current = null;
      streamDirtyRef.current = false;
      const buffer = streamBufferRef.current;
      const target = Math.min(displayPosRef.current + MAX_CHARS_PER_FRAME, buffer.length);
      displayPosRef.current = target;
      setStreamingText(buffer.slice(0, target));
      // Continue animating until the full buffer has been revealed
      if (target < buffer.length) {
        streamRafRef.current = requestAnimationFrame(flushStreamUpdate);
      }
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
      if (!streamRafRef.current) {
        streamRafRef.current = requestAnimationFrame(flushStreamUpdate);
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
      if (streamEpochRef.current !== activeEpochRef.current) return;

      streamBufferRef.current += token;
      wasRespondingRef.current = true;

      // Normalize <thinking> variants to <think>
      streamBufferRef.current = streamBufferRef.current
        .replace(/<thinking>/gi, '<think>')
        .replace(/<\/thinking>/gi, '</think>');

      // Strip internal reasoning patterns
      streamBufferRef.current = streamBufferRef.current
        .replace(/^\s*We need to[^.]*\.[^\n]*\n?/gim, '')
        .replace(/^\s*The user[^.]*\.[^\n]*\n?/gim, '')
        .replace(/^\s*Let me think[^.]*\.[^\n]*\n?/gim, '')
        .replace(/\*\*Summary\*\*[\s\S]*?(?=\n\n[A-Z#]|$)/gi, '')
        .replace(/\nWe need to[^\n]*\n/gi, '\n');

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
          streamBufferRef.current = buf;
          streamDirtyRef.current = true;
          if (!streamRafRef.current) {
            streamRafRef.current = requestAnimationFrame(() => {
              streamRafRef.current = null;
              const b = streamBufferRef.current;
              const ts = b.indexOf('<think>');
              const visibleText = ts !== -1 ? b.substring(0, ts) : b;
              displayPosRef.current = visibleText.length; // sync so typewriter doesn't jump backward
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
      scheduleThinkingUpdate();
    });

    // Anti-hallucination: backend detected fake tool results
    const cleanupReplace = api.onLlmReplaceLast?.((cleanedText: string) => {
      if (streamEpochRef.current !== activeEpochRef.current) return;
      streamBufferRef.current = cleanedText;
      // Jump display to buffer end — corrections show immediately, no typewriter delay
      displayPosRef.current = cleanedText.length;
      scheduleStreamUpdate();
    });

    return () => {
      cleanupToken?.();
      cleanupThinking?.();
      cleanupReplace?.();
      if (streamRafRef.current) cancelAnimationFrame(streamRafRef.current);
      if (thinkingRafRef.current) cancelAnimationFrame(thinkingRafRef.current);
    };
  }, []);

  return {
    streamingText, thinkingSegments,
    setStreamingText, setThinkingSegments,
    streamBufferRef, thinkingSegmentsRef, wasRespondingRef,
    streamEpochRef, activeEpochRef,
  };
}
