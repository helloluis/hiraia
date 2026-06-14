import { Text, type StyleProp, type TextStyle } from 'react-native';

import { colors, fonts } from '../theme';

/**
 * Lightweight markdown rendering for chat bubbles. The model emits markdown
 * (**bold**, `# headers`, `- bullets`, `code`), but React Native <Text> shows it
 * raw — so "**photosynthesis**" appeared with literal asterisks. We render inline
 * **bold** in the display font (matching the web's chat-md) and strip the rest to
 * clean text. Not a full markdown engine — just what the tutor actually produces.
 */

interface Segment {
  text: string;
  kind: 'plain' | 'bold' | 'italic';
}

/**
 * The intent-distilled tutor reasons in a leading `<think> … </think>` block before
 * answering (it's how it sees through "essay tungkol sa X" framing to the real topic).
 * UX = reveal-then-replace: WHILE the block is still open mid-stream, show the reasoning
 * as muted "thinking…" text so the kid sees something during the slow on-device decode;
 * the moment `</think>` closes, drop it and render only the final answer. Adaptive — a
 * turn with no `<think>` (e.g. a simple grounded reply) just renders normally.
 */
export function splitThink(content: string): { thinking: string | null; answer: string } {
  const open = content.indexOf('<think>');
  if (open === -1) return { thinking: null, answer: content };
  const before = content.slice(0, open);
  const rest = content.slice(open + '<think>'.length);
  const close = rest.indexOf('</think>');
  if (close === -1) {
    // still thinking: nothing to answer yet, surface the in-progress reasoning
    return { thinking: rest.trim(), answer: before.trimStart() };
  }
  // done: replace the think block with the final answer
  const answer = (before + rest.slice(close + '</think>'.length)).trim();
  return { thinking: null, answer };
}

/** Pull the descriptions out of `[image: <desc>]` control tokens (the tutor emits
 *  these to request a picture). The text still strips the tag; MessageBubble renders
 *  an ImageSlot per description. */
export function extractImageDescs(content: string): string[] {
  const out: string[] = [];
  const re = /\[image:\s*([^\]]+?)\s*\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push((m[1] ?? '').trim());
  return out;
}

/** Strip block/inline markdown that we don't render, leaving readable text. */
function cleanBlockMarkdown(s: string): string {
  return s
    .replace(/<\/?think>/gi, '') // defensive: never show raw think tags if splitThink missed an edge
    .replace(/\s*\[image:[^\]]*\]/gi, '') // image control tokens (retrieval not wired on mobile — strip, never show)
    .replace(/\s*\[image:[^\]]*$/i, '') // trailing not-yet-closed image tag while streaming
    .replace(/^#{1,6}\s+/gm, '') // ATX header hashes
    .replace(/^\s{0,3}[-*+]\s+/gm, '• ') // list markers → bullet
    .replace(/`([^`]+)`/g, '$1') // inline code backticks
    .replace(/^\s*```.*$/gm, '') // fenced-code fences
    .trimEnd();
}

/** Split text into bold / italic / plain runs on **…**, *…* and _…_, after cleaning
 *  other markdown. Bold is split first so its inner asterisks don't trip the italic rule. */
function parseInline(input: string): Segment[] {
  const cleaned = cleanBlockMarkdown(input);
  const segments: Segment[] = [];
  // one regex captures **bold**, *italic*, or _italic_ as delimiters
  for (const part of cleaned.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g)) {
    if (!part) continue;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      segments.push({ text: part.slice(2, -2), kind: 'bold' });
    } else if (/^\*[^*]+\*$/.test(part) || /^_[^_]+_$/.test(part)) {
      segments.push({ text: part.slice(1, -1), kind: 'italic' });
    } else {
      // strip any stray, unmatched emphasis marks from plain runs
      segments.push({ text: part.replace(/(\*\*|\*|_)/g, ''), kind: 'plain' });
    }
  }
  return segments;
}

interface RichTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  boldStyle?: StyleProp<TextStyle>;
}

export function RichText({ text, style, boldStyle }: RichTextProps) {
  const { thinking, answer } = splitThink(text);
  // Reveal phase: block still open and no answer yet → show muted reasoning.
  if (thinking !== null && !answer) {
    return (
      <Text style={[style, { opacity: 0.55, fontStyle: 'italic' }]}>
        {`💭 ${thinking}`}
      </Text>
    );
  }
  const segments = parseInline(answer);
  return (
    <Text style={style}>
      {segments.map((seg, i) => {
        if (seg.kind === 'bold') {
          // key terms pop in the brand teal + display font so a kid's eye lands on them
          return (
            <Text key={i} style={[{ fontFamily: fonts.display, color: colors.primary }, boldStyle]}>
              {seg.text}
            </Text>
          );
        }
        if (seg.kind === 'italic') {
          return (
            <Text key={i} style={{ fontStyle: 'italic' }}>
              {seg.text}
            </Text>
          );
        }
        return seg.text;
      })}
    </Text>
  );
}
