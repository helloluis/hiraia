'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdownRaw from 'react-markdown';

// react-markdown 10's component type doesn't line up with React 19's JSX types
// across TS versions; treat it as untyped (it renders fine at runtime).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactMarkdown = ReactMarkdownRaw as any;

/**
 * Returns `value` but updated at most once per `ms`. While `flush` is false
 * (streaming) the value settles on a ~1s cadence so markdown re-renders calmly
 * instead of reflowing on every token (and never shows half-parsed `**`).
 * When `flush` flips true (stream finished) it updates immediately.
 */
function useThrottled(value: string, ms: number, flush: boolean): string {
  const [out, setOut] = useState(value);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (flush) {
      clearTimeout(timer.current);
      setOut(value);
      last.current = Date.now();
      return;
    }
    const elapsed = Date.now() - last.current;
    if (elapsed >= ms) {
      setOut(value);
      last.current = Date.now();
    } else {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setOut(value);
        last.current = Date.now();
      }, ms - elapsed);
    }
    return () => clearTimeout(timer.current);
  }, [value, ms, flush]);

  return out;
}

export function AssistantMessage({ content, streaming }: { content: string; streaming: boolean }) {
  // Markdown conversion lags the live stream by ~1s; snaps to full content when done.
  const shown = useThrottled(content, 1000, !streaming);
  return (
    <div className="prose prose-sm max-w-none chat-md">
      <ReactMarkdown>{shown}</ReactMarkdown>
    </div>
  );
}
