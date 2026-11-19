/** Small text helpers shared by the generators, checks and review (no imports, so no cycles). */

/** Slide line limit per language: Filipino sentences run about 20% longer than English. */
export const lineMax = (lang: string) => (lang === 'fil' ? 130 : 110);
/** Characters on one slide's lines (TV fit): 340 in English, 420 in Filipino; the 48/60-word readability limit is the same. */
export const slideCharsMax = (lang: string) => (lang === 'fil' ? 420 : 340);
/** The deck numbers and bullets lines itself; a leading "1." or "-" the model wrote does not count. */
export const stripEnumerator = (l: string) => l.replace(/^\s*(?:[-–•●*]\s+|\d{1,2}[.)]\s+)/, '');

/** Split one over-long slide line at sentence (then dash/semicolon) boundaries into lines of at most `max` characters. */
export function splitSlideLine(line: string, max = 110): string[] | null {
  if (line.length <= max) return [line];
  const pack = (parts: string[], joiner: string) => {
    const out: string[] = [];
    for (const part of parts) {
      const last = out.at(-1);
      if (last !== undefined && (last + joiner + part).length <= max) out[out.length - 1] = last + joiner + part;
      else out.push(part);
    }
    return out.every((x) => x.length <= max) ? out : null;
  };
  return pack(line.split(/(?<=[.!?])\s+/), ' ') ?? pack(line.split(/\s+(?=—\s)|(?<=;)\s+/), ' ');
}
