/**
 * Streaming buffer hook for smooth TUI text rendering.
 *
 * Accumulates text deltas in a ref (avoiding React re-renders on every delta)
 * and flushes to React state at a controlled interval.
 *
 * Pattern: useRef(buffer) --append(delta)--> buffer grows (no render)
 *                |
 *         setInterval (80ms)
 *                |
 *         useState(displayText) --> React re-render
 *
 * Usage:
 *   const sb = useStreamingBuffer();
 *   sb.append("hello ");     // no re-render
 *   sb.append("world");      // no re-render
 *   // ... 80ms later, displayText = "hello world" triggers a re-render
 *   const final = sb.finalize(); // returns "hello world", clears buffer
 */

import { useState, useRef, useCallback, useEffect } from "react";

const DEFAULT_FLUSH_INTERVAL_MS = 80;

export interface StreamingBuffer {
  /** The currently displayed streaming text (React state — causes re-renders). */
  displayText: string;
  /** Append a text delta. Does NOT trigger a re-render. */
  append: (delta: string) => void;
  /** Start periodic flushing of the ref buffer to React state. */
  startFlushing: (intervalMs?: number) => void;
  /** Stop flushing, return the accumulated text, and clear everything. */
  finalize: () => string;
  /** Clear the buffer and display text without finalizing. */
  reset: () => void;
}

export function useStreamingBuffer(): StreamingBuffer {
  const bufferRef = useRef("");
  const [displayText, setDisplayText] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const append = useCallback((delta: string) => {
    bufferRef.current += delta;
  }, []);

  const startFlushing = useCallback((intervalMs = DEFAULT_FLUSH_INTERVAL_MS) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = setInterval(() => {
      if (bufferRef.current !== "") {
        setDisplayText(bufferRef.current);
      }
    }, intervalMs);
  }, []);

  const finalize = useCallback((): string => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const final = bufferRef.current;
    bufferRef.current = "";
    setDisplayText("");
    return final;
  }, []);

  const reset = useCallback(() => {
    bufferRef.current = "";
    setDisplayText("");
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return { displayText, append, startFlushing, finalize, reset };
}
