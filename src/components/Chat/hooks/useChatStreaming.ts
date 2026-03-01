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
  const iterationStartOffsetRef = useRef(0); // offset where current iteration's text starts in streamBufferRef

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLlmToken) return;

    // Token callbacks compare streamEpochRef against activeEpochRef.
    // - streamEpochRef is incremented on clear/cancel (invalidates current generation)
    // - activeEpochRef is set to streamEpochRef.current when a NEW generation starts
    // This way, tokens are accepted during active generation, but discarded after clear/cancel
    // until a new generation begins and re-syncs the epochs.

    // Typewriter effect: advance at a fixed chars-per-second rate, time-based not frame-based.
    // Frame-based (e.g. 15 chars/frame) runs 2.4x faster on 144Hz than 60Hz monitors.
    // Time-based ensures the same pace on all hardware regardless of refresh rate.
    // 100 chars/sec: deliberate pace to avoid overwhelming the user with fast text.
    const CHARS_PER_SECOND = 100;
    let lastFrameTime = 0;
    const flushStreamUpdate = (timestamp: number) => {
      streamRafRef.current = null;
      streamDirtyRef.current = false;
      const buffer = streamBufferRef.current;
      const elapsed = lastFrameTime === 0 ? 16 : Math.min(timestamp - lastFrameTime, 100); // cap at 100ms to avoid huge jump after tab switch
      lastFrameTime = timestamp;
      const charsThisFrame = Math.max(1, Math.round(CHARS_PER_SECOND * elapsed / 1000));
      const target = Math.min(displayPosRef.current + charsThisFrame, buffer.length);
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
      // Strip code-fence artifacts that bleed from tool-calling iterations into thinking output.
      // Models sometimes write `json or ```json inside <think> as a self-note before outputting a tool call.
      const lastIdx = thinkingSegmentsRef.current.length - 1;
      thinkingSegmentsRef.current[lastIdx] = thinkingSegmentsRef.current[lastIdx]
        // Strip complete tool-call code blocks (```json ... ``` etc.) that bleed from context summaries
        .replace(/```(?:json|tool_call|tool)[^\n]*\n[\s\S]*?```/g, '')
        // Strip any remaining lone opening fence markers left after partial streaming
        .replace(/^`{1,3}(?:json|tool_call|tool)\s*/gim, '');
      scheduleThinkingUpdate();
    });

    // Track where the current iteration's text starts in the accumulated buffer.
    // When the backend sends llm-replace-last with just the current iteration's cleaned text,
    // we prepend prior iterations' text so we don't wipe what the user was reading.
    const cleanupIterationBegin = (api as any).onLlmIterationBegin?.(() => {
      iterationStartOffsetRef.current = streamBufferRef.current.length;
    });

    // Anti-hallucination: backend detected fake tool results
    const cleanupReplace = api.onLlmReplaceLast?.((cleanedText: string) => {
      if (streamEpochRef.current !== activeEpochRef.current) return;
      const prefix = streamBufferRef.current.slice(0, iterationStartOffsetRef.current);
      // When cleanedText is empty (tool-call iteration wipe), the streamed planning text
      // would vanish abruptly from the main chat. Promote it to a thinking segment so it
      // transitions visually rather than disappearing — prevents the jarring flash/blank effect.
      if (!cleanedText) {
        const iterationText = streamBufferRef.current.slice(iterationStartOffsetRef.current).trim();
        if (iterationText.length > 10) {
          // Avoid duplication: backend may have already sent this text as llm-thinking-token.
          // Only push if last thinking segment doesn't already start with the same content.
          const lastSeg = thinkingSegmentsRef.current[thinkingSegmentsRef.current.length - 1] || '';
          const firstChunk = iterationText.substring(0, 80);
          if (!lastSeg.includes(firstChunk)) {
            thinkingSegmentsRef.current.push(iterationText);
            scheduleThinkingUpdate();
          }
        }
      }
      // Preserve text from prior iterations — only replace current iteration's portion
      streamBufferRef.current = prefix + cleanedText;
      // Jump display to buffer end — corrections show immediately, no typewriter delay
      displayPosRef.current = streamBufferRef.current.length;
      scheduleStreamUpdate();
    });

    // ROLLBACK signal — backend is retrying after a bad response; clear only the current
    // iteration's streamed tokens, preserving text from prior iterations.
    const cleanupReset = (api as any).onLlmStreamReset?.(() => {
      if (streamRafRef.current) cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
      // Trim back to the start of the current iteration only — prior iterations' text stays visible
      streamBufferRef.current = streamBufferRef.current.slice(0, iterationStartOffsetRef.current);
      displayPosRef.current = iterationStartOffsetRef.current;
      setStreamingText(streamBufferRef.current);
    });

    return () => {
      cleanupToken?.();
      cleanupThinking?.();
      cleanupIterationBegin?.();
      cleanupReplace?.();
      cleanupReset?.();
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
