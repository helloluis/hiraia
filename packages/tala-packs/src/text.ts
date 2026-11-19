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

/** Last resort for a line over the contract with no sentence break: split at the comma nearest the middle. */
export function splitAtComma(line: string, max: number): string[] | null {
  const commas = [...line.matchAll(/, /g)].map((m) => m.index!);
  const mid = line.length / 2;
  const best = commas.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  if (best === undefined) return null;
  const parts = [line.slice(0, best + 1).trim(), line.slice(best + 2).trim()];
  return parts.every((x) => x.length > 0 && x.length <= max) ? parts : null;
}

/** Shorten descriptive text (image alt text) to `max` characters at a sentence end, else a word boundary + "…". */
export function clampText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sentence = cut.lastIndexOf('. ');
  if (sentence >= max * 0.6) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(' ', max - 1);
  return `${cut.slice(0, space > 0 ? space : max - 1).replace(/[,;:\s]+$/, '')}…`;
}

/** A list over the contract's length keeps its first items and joins the rest into the last allowed one. */
export function foldList(items: string[], max: number): string[] {
  if (items.length <= max) return items;
  return [...items.slice(0, max - 1), items.slice(max - 1).join('; ')];
}

