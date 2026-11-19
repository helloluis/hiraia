'use client';
/**
 * Teacher-facing prose laid out for scanning (see prose.ts): what to SAY stands on its own lines like a script,
 * what to do reads as ordinary sentences between them, and bracketed asides (expected answers) are quieter.
 * The words and their order are never changed.
 */
import { segmentProse, type ProseSegment } from './prose';

function Inline({ parts }: { parts: ProseSegment[] }) {
  return (
    <>
      {parts.map((s, i) =>
        s.kind === 'aside' ? (
          <span key={i} className="text-forestMuted">
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

/** A teacher's step as a script: instructions, then each spoken sentence on its own marked line. */
export function Script({ text, className }: { text: string; className?: string }) {
  const blocks: Array<{ say: boolean; parts: ProseSegment[] }> = [];
  for (const s of segmentProse(text)) {
    const last = blocks[blocks.length - 1];
    if (s.kind === 'say') blocks.push({ say: true, parts: [s] });
    else if (last && !last.say) last.parts.push(s);
    else blocks.push({ say: false, parts: [s] });
  }
  const shown = blocks
    .map((b) => {
      if (b.say) return b;
      const parts = b.parts.map((p) => ({ ...p }));
      parts[0] = { ...parts[0]!, text: parts[0]!.text.replace(/^\s+/, '') };
      const end = parts.length - 1;
      parts[end] = { ...parts[end]!, text: parts[end]!.text.replace(/\s+$/, '') };
      return { say: false, parts };
    })
    .filter((b) => b.parts.some((p) => p.text.length > 0));
  return (
    <div className={className}>
      {shown.map((b, i) =>
        b.say ? (
          <p key={i} className="my-2 border-l-[3px] border-talaTeal/70 pl-3 font-medium text-forest break-words">
            {b.parts[0]!.text}
          </p>
        ) : (
          <p key={i} className="break-words">
            <Inline parts={b.parts} />
          </p>
        )
      )}
    </div>
  );
}

/** A paragraph with bracketed asides quieter; nothing else changes. */
export function Prose({ text, className }: { text: string; className?: string }) {
  const parts = segmentProse(text).map((s): ProseSegment => (s.kind === 'say' ? { kind: 'text', text: s.text } : s));
  return (
    <p className={className}>
      <Inline parts={parts} />
    </p>
  );
}
