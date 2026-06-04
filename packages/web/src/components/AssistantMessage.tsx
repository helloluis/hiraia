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

// The tutor may end a reply with an invisible control token, e.g.
//   [image: cross-section of a leaf showing photosynthesis]
// It signals "a diagram would help here"; the retrieval layer (when wired) maps
// the description to an actual image and renders it. The token itself must NEVER
// be shown to the student — whether or not a matching image is found. We also
// suppress a half-typed token at the streaming tail so it doesn't flash before
// it finishes arriving. The raw text (with the token) is still what gets saved,
// so the model stays aware of it in multi-turn history.
const COMPLETE_IMAGE_TAG = /\s*\[image:[^\]]*\]/gi;
const IMAGE_TAG_PREFIX = '[image:';

/** Hide a trailing, not-yet-closed token that could be forming an `[image:` tag. */
function stripTrailingPartialTag(s: string): string {
  const open = s.lastIndexOf('[');
  if (open === -1 || s.indexOf(']', open) !== -1) return s; // none, or already closed
  const tail = s.slice(open).toLowerCase();
  if (IMAGE_TAG_PREFIX.startsWith(tail) || tail.startsWith(IMAGE_TAG_PREFIX)) {
    return s.slice(0, open);
  }
  return s;
}

/** Strip image control tokens for display; also surface the first description. */
export function parseImageTag(raw: string): { text: string; imageDesc: string | null } {
  const m = raw.match(/\[image:\s*([^\]]*)\]/i);
  const imageDesc = m?.[1]?.trim() ?? null;
  const text = stripTrailingPartialTag(raw.replace(COMPLETE_IMAGE_TAG, '')).trimEnd();
  return { text, imageDesc };
}

export function AssistantMessage({ content, streaming }: { content: string; streaming: boolean }) {
  // Markdown conversion lags the live stream by ~1s; snaps to full content when done.
  const shown = useThrottled(content, 1000, !streaming);
  // The control token is removed before render; `imageDesc` is parsed and ready
  // for the retrieval layer. Until that's wired, an unmatched (or any) token
  // simply renders nothing — it is never shown to the student as raw text.
  const { text } = parseImageTag(shown);
  return (
    <div className="prose prose-sm max-w-none chat-md">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}
