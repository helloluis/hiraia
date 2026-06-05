import { Text, type StyleProp, type TextStyle } from 'react-native';

import { fonts } from '../theme';

/**
 * Lightweight markdown rendering for chat bubbles. The model emits markdown
 * (**bold**, `# headers`, `- bullets`, `code`), but React Native <Text> shows it
 * raw — so "**photosynthesis**" appeared with literal asterisks. We render inline
 * **bold** in the display font (matching the web's chat-md) and strip the rest to
 * clean text. Not a full markdown engine — just what the tutor actually produces.
 */

interface Segment {
  text: string;
  bold: boolean;
}

/** Strip block/inline markdown that we don't render, leaving readable text. */
function cleanBlockMarkdown(s: string): string {
  return s
    .replace(/^#{1,6}\s+/gm, '') // ATX header hashes
    .replace(/^\s{0,3}[-*+]\s+/gm, '• ') // list markers → bullet
    .replace(/`([^`]+)`/g, '$1') // inline code backticks
    .replace(/^\s*```.*$/gm, ''); // fenced-code fences
}

/** Split text into bold / non-bold runs on **…**, after cleaning other markdown. */
function parseInline(input: string): Segment[] {
  const cleaned = cleanBlockMarkdown(input);
  const segments: Segment[] = [];
  for (const part of cleaned.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const bold = /^\*\*[^*]+\*\*$/.test(part);
    segments.push({
      text: bold ? part.slice(2, -2) : part.replace(/\*/g, ''),
      bold,
    });
  }
  return segments;
}

interface RichTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  boldStyle?: StyleProp<TextStyle>;
}

export function RichText({ text, style, boldStyle }: RichTextProps) {
  const segments = parseInline(text);
  return (
    <Text style={style}>
      {segments.map((seg, i) =>
        seg.bold ? (
          <Text key={i} style={[{ fontFamily: fonts.display }, boldStyle]}>
            {seg.text}
          </Text>
        ) : (
          seg.text
        )
      )}
    </Text>
  );
}
