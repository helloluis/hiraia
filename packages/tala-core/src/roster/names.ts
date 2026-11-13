import type { RosterProposed, RosterRow } from '../contracts/features';

export const emptyName = (displayName = ''): RosterProposed => ({ displayName, familyName: '', givenName: '', middleName: '', suffix: '', sex: null, grade: null, localId: null });
const fold = (s: string) => s.normalize('NFC').toLocaleLowerCase('en');
const runs = (s: string) => fold(s).match(/[\p{L}\p{M}]+|\d+/gu) ?? [];
/** Compare complete source runs (with multiplicity), never substring letters: J cannot become Juan. */
export function traceable(source: string, proposal: RosterProposed): boolean {
  const check = (value: string) => {
    const available = runs(source);
    for (const word of runs(value)) { const index = available.indexOf(word); if (index < 0) return false; available.splice(index, 1); }
    return true;
  };
  return check(proposal.displayName) && check([proposal.givenName, proposal.middleName, proposal.familyName, proposal.suffix].join(' '));
}
export function displayCase(value: string): string {
  // Mixed case is deliberate; don't damage Mc/Ng/other naming conventions.
  if (value !== value.toUpperCase() && value !== value.toLowerCase()) return value;
  return value.toLowerCase().replace(/(^|[\s,\-'’])\p{L}/gu, s => s.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|Van|Von)\b/g, s => s.toLowerCase())
    .replace(/\b(ii|iii|iv|vi|vii|viii)\b/gi, s => s.toUpperCase());
}
export function normalizeName(original: string, rowIndex: number, exact = false): RosterRow {
  const row: RosterRow = { rowIndex, original, proposed: emptyName(original), status: 'clean', flags: [], removed: [], duplicateGroup: null };
  if (original.length > 200) row.flags.push('maybe_not_person');
  if (/[\uFFFD\x00-\x08]|Ã.|Â.|â€/.test(original)) row.flags.push('corrupted_characters');
  if (exact) { if (row.flags.length) row.status = 'needs_review'; return row; }
  let value = original;
  const strip = (regex: RegExp) => { value = value.replace(regex, found => { row.removed.push(found); return ' '; }); };
  strip(/^\s*(?:\d+[.)\-:]\s*|[✓✔☑]\s*)/u);
  strip(/^\s*(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+/i);
  strip(/\s*\((?:transferee|transferred|new|moved|balik.aral)\)\s*/gi);
  strip(/\s+-\s*(?:moved|transferred|transferee)\s*$/i);
  strip(/[✓✔☑]/gu);
  value = displayCase(value.trim().replace(/\s+/g, ' '));
  row.proposed = emptyName(value);
  if (/\s(?:and|at)\s|[&;/]|\n|\r/i.test(value)) row.flags.push('maybe_two_people');
  if (!value || /\d|[:=<>@]|\b(total|prepared|checked|school|paaralan|signature|listahan)\b/i.test(value)) row.flags.push('maybe_not_person');
  const comma = value.split(',').map(s => s.trim());
  if (comma.length === 2 && comma.every(Boolean) && !row.flags.length) {
    row.proposed.familyName = comma[0]!;
    let rest = comma[1]!;
    const suffix = rest.match(/(?:,?\s+)(Jr\.?|Sr\.?|II|III|IV|V)$/i);
    if (suffix) { row.proposed.suffix = suffix[1]!; rest = rest.slice(0, suffix.index).trim(); }
    const middle = rest.match(/\s+([\p{L}]\.)$/u);
    if (middle) { row.proposed.middleName = middle[1]!; rest = rest.slice(0, middle.index).trim(); }
    row.proposed.givenName = rest;
    // Full middle names and multiple given names are indistinguishable without separate columns.
    if (!middle && rest.split(' ').length > 1) row.flags.push('uncertain_split');
  } else {
    // Suggest particles only when a middle initial creates an explicit boundary. All
    // given-first splits remain teacher-reviewed; no cultural naming order is inferred.
    const match = value.match(/^(.+?)\s+(\p{L}\.)\s+((?:(?:Dela|Delos|De los|De la|Del|San|Santa|Sta\.)\s+)?[\p{L}\p{M}'’\-]+)(?:\s+(Jr\.?|Sr\.?|II|III|IV))?$/iu);
    if (match) Object.assign(row.proposed, { givenName: match[1], middleName: match[2], familyName: match[3], suffix: match[4] ?? '' });
    row.flags.push('uncertain_split');
  }
  if (!traceable(original, row.proposed)) { row.proposed = emptyName(original); row.flags.push('untraceable_output'); }
  row.status = row.flags.length ? 'needs_review' : row.removed.length ? 'changed' : 'clean';
  return row;
}

export function groupDuplicates(rows: RosterRow[]): void {
  let group = 0;
  const normalized = (r: RosterRow) => runs(r.proposed.displayName).join(' ');
  const similar = (a: RosterRow, b: RosterRow) => {
    if (normalized(a) === normalized(b)) return true;
    const x = a.proposed, y = b.proposed;
    if (x.familyName && y.familyName && fold(x.familyName) === fold(y.familyName) && fold(x.givenName) === fold(y.givenName)) {
      return !x.middleName || !y.middleName || fold(x.middleName)[0] === fold(y.middleName)[0];
    }
    const xx = runs(x.displayName), yy = runs(y.displayName);
    return xx.length === yy.length && xx.every((word, i) => word === yy[i] || ((word.length === 1 || yy[i]!.length === 1) && word[0] === yy[i]![0]));
  };
  const parents = rows.map((_, i) => i);
  const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]!));
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (rows[i]!.status !== 'not_student' && rows[j]!.status !== 'not_student' && similar(rows[i]!, rows[j]!)) parents[root(j)] = root(i);
  }
  const groups = new Map<number, RosterRow[]>();
  rows.forEach((r, i) => { const key = root(i); groups.set(key, [...(groups.get(key) ?? []), r]); });
  for (const matches of groups.values()) if (matches.length > 1) {
    for (const row of matches) { row.duplicateGroup = group; if (!row.flags.includes('possible_duplicate')) row.flags.push('possible_duplicate'); row.status = 'needs_review'; }
    group++;
  }
}
