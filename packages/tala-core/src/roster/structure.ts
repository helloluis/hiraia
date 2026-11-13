import { GradeLevel } from '../contracts/common';
import { RosterProposed, type RosterField, type RosterImportDraft, type RosterRow } from '../contracts/features';
import { displayCase, emptyName, groupDuplicates, normalizeName } from './names';
export type Column = RosterImportDraft['columns'][number];
export type SafeSource = { rowIndex: number; cells: string[]; kind: 'data' | 'excluded'; grade: GradeLevel | null; sex: 'M' | 'F' | null };
export type StructuredRoster = { columns: Column[]; droppedColumns: string[]; source: SafeSource[]; rows: RosterRow[]; counts: RosterImportDraft['counts'] };
const canonical = (s: string) => s.toLowerCase().replace(/[._()\-]/g, ' ').replace(/\s+/g, ' ').trim();
export function fieldForHeader(header: string): RosterField {
  const h = canonical(header);
  if (/\b(lrn|learner reference|birth(?:date|day)?|date of birth|kapanganakan|address|tirahan|guardian|parent|father|mother|magulang|contact|phone|mobile|email|religion|ethnic|health|medical|4ps|attendance|grades|marks|mark|score|age|edad|photo|status|remarks)\b/.test(h)) return 'drop';
  if (/^(surname|last name|family name|apelyido)$/.test(h)) return 'familyName';
  if (/^(first name|given names?|pangalan sa binyag)$/.test(h)) return 'givenName';
  if (/^(middle name|middle initial|middle name initial|mi|m i|gitnang pangalan)$/.test(h)) return 'middleName';
  if (/^(suffix|extension|name extension|ext)$/.test(h)) return 'suffix';
  if (/^name of learners? (?:last name|surname|family name)/.test(h)) return 'fullName';
  if (/^(name|full name|learner name|name of learner|name of learners|student name|pangalan|pangalan ng mag aaral)$/.test(h)) return 'fullName';
  if (/^(sex|gender|kasarian)$/.test(h)) return 'sex';
  if (/^(grade|grade level|baitang|year level)$/.test(h)) return 'grade';
  if (/^(local id|teacher assigned id|class id)$/.test(h)) return 'localId';
  return 'ignore';
}
export const nameFields = new Set<RosterField>(['fullName', 'givenName', 'middleName', 'familyName', 'suffix']);
/** Refuse obvious non-name data before retention or model use, including mislabeled columns. */
export function safeNameCell(value: string): boolean {
  return value.length <= 500 && !/\d{3,}|@|https?:|\b(?:street|barangay|brgy|avenue|road|birthday|birthdate|guardian|contact|lrn)\b|\d+[\/\-]\d+[\/\-]\d+/i.test(value);
}
function gradeOf(value: string): GradeLevel | null {
  const g = value.trim().replace(/^(?:grade|baitang|gr\.?|g)\s*/i, '').replace(/^kindergarten$/i, 'K').toUpperCase();
  const result = GradeLevel.safeParse(g); return result.success ? result.data : null;
}
export function rosterCounts(rows: RosterRow[]): RosterImportDraft['counts'] {
  return { linesRead: rows.length, students: rows.filter(r => r.status === 'clean' || r.status === 'changed').length, needsReview: rows.filter(r => r.status === 'needs_review').length, notStudents: rows.filter(r => r.status === 'not_student').length };
}
export function normalizeSource(source: SafeSource[], columns: Column[], exact = false): RosterRow[] {
  const rows = source.map(s => {
    if (s.kind === 'excluded' && !exact) return { ...normalizeName('', s.rowIndex, true), status: 'not_student' as const, removed: ['Non-student structure row (header, section, total or signature).'] };
    const get = (f: RosterField) => columns.filter(c => c.field === f).map(c => s.cells[c.index] ?? '').filter(Boolean).join(' ');
    const original = get('fullName') || (['givenName', 'middleName', 'familyName', 'suffix'] as const).map(get).filter(Boolean).join(' ');
    if (original.length > 500) throw new Error('Combined name is too long. Paste only the names.');
    const row = normalizeName(original, s.rowIndex, exact);
    if (!exact && !get('fullName') && (get('givenName') || get('familyName'))) {
      row.proposed = { ...emptyName(displayCase(original.trim().replace(/\s+/g, ' '))), givenName: displayCase(get('givenName')), familyName: displayCase(get('familyName')), middleName: displayCase(get('middleName')), suffix: displayCase(get('suffix')) };
      row.flags = row.flags.filter(f => f !== 'uncertain_split');
      if (!get('givenName') || !get('familyName')) row.flags.push('uncertain_split');
      row.status = row.flags.length ? 'needs_review' : 'clean';
    }
    if (!original || original === '[withheld]') { row.flags.push('maybe_not_person'); row.status = 'needs_review'; }
    const rawGrade = get('grade');
    row.proposed.grade = rawGrade ? gradeOf(rawGrade) : s.grade;
    if (!row.proposed.grade) { row.flags.push('unknown_grade'); row.status = 'needs_review'; }
    const sex = get('sex').trim().toUpperCase();
    row.proposed.sex = /^(M|MALE|LALAKI)$/.test(sex) ? 'M' : /^(F|FEMALE|BABAE)$/.test(sex) ? 'F' : s.sex;
    const localId = get('localId');
    row.proposed.localId = localId && localId.length <= 40 && !/\d{8,}/.test(localId) ? localId : null;
    if (!RosterProposed.safeParse(row.proposed).success) { row.proposed = emptyName(original.length <= 200 ? original : ''); row.flags.push('uncertain_split'); row.status = 'needs_review'; }
    return row;
  });
  groupDuplicates(rows);
  return rows;
}
/** Structure and immediately discard all unapproved cells, even from the temporary source. */
export function structureRows(input: string[][], options: { exactlyAsWritten?: boolean; maxRows?: number; encodingReview?: boolean; columns?: Column[]; headerRowIndex?: number | null } = {}): StructuredRoster {
  const nonempty = input.map((cells, rowIndex) => ({ cells, rowIndex })).filter(r => r.cells.some(c => c.trim()));
  if (nonempty.length > (options.maxRows ?? 500)) throw new Error('This list is too long. Import at most 500 non-empty rows at a time.');
  if (input.some(r => r.length > 100 || r.some(c => c.length > 10000))) throw new Error('This file has oversized cells. Paste the names instead.');
  const nameHeader = (cells: string[]) => cells.some(c => nameFields.has(fieldForHeader(c)));
  let header = options.headerRowIndex === null ? -1 : options.headerRowIndex !== undefined ? nonempty.findIndex(r => r.rowIndex === options.headerRowIndex) : nonempty.findIndex(r => nameHeader(r.cells));
  const width = Math.max(1, ...nonempty.map(r => r.cells.length));
  let columns: Column[];
  if (options.exactlyAsWritten && width === 1) { header = -1; columns = [{ index: 0, header: 'Name as written', field: 'fullName' }]; }
  else if (options.columns) columns = options.columns;
  else if (header >= 0) columns = Array.from({ length: width }, (_, index) => {
    const value = nonempty[header]!.cells[index] ?? '', field = fieldForHeader(value);
    return { index, header: field === 'ignore' ? `Unmapped column ${index + 1}` : value.slice(0, 200), field };
  });
  else {
    header = -1;
    // Only an unambiguous one-column list (plus optional numbering) is auto-mapped.
    const numbered = width === 2 && nonempty.every(r => /^\s*\d+[.)]?\s*$/.test(r.cells[0] ?? ''));
    columns = Array.from({ length: width }, (_, index) => ({ index, header: `Column ${index + 1}`, field: width === 1 || (numbered && index === 1) ? 'fullName' : 'ignore' }));
  }
  if (columns.some(c => c.index < 0 || c.index >= width || !Number.isInteger(c.index)) || new Set(columns.map(c => c.index)).size !== columns.length) throw new Error('Invalid column mapping.');
  columns = columns.map(c => {
    const rawHeader = header >= 0 ? nonempty[header]!.cells[c.index] ?? '' : '';
    // A teacher mapping cannot turn a recognized LRN/address/guardian column into a name.
    return fieldForHeader(rawHeader) === 'drop' ? { ...c, field: 'drop' as const, header: rawHeader.slice(0, 200) } : c;
  });
  const droppedColumns = columns.filter(c => c.field === 'drop' || c.field === 'ignore').map(c => c.header);
  let grade: GradeLevel | null = null, sex: 'M' | 'F' | null = null;
  const source: SafeSource[] = nonempty.map(({ cells, rowIndex }, i) => {
    const joined = cells.filter(c => c.trim()).join(' ').trim();
    const gradeHeading = /^(?:grade|baitang)\s+(?:K|\d{1,2})\s*$/i.test(joined);
    const sexHeading = /^(boys|girls|male|female|lalaki|babae)\s*:?(?:\s*\(\d+\))?$/i.test(joined);
    if (gradeHeading) grade = gradeOf(joined);
    if (sexHeading) sex = /^(boys|male|lalaki)/i.test(joined) ? 'M' : 'F';
    const excluded = !(options.exactlyAsWritten && width === 1) && (i === header || (header >= 0 && i < header) || nameHeader(cells) || gradeHeading || sexHeading || /^(?:grand total|total|kabuuan)\s*[:=\d ]*$|^(?:prepared by|checked by|approved by|signature)\s*:/i.test(joined));
    const sanitized = Array.from({ length: width }, (_, index) => {
      const c = columns.find(column => column.index === index);
      if (!c) return '';
      const value = cells[c.index] ?? '';
      if (excluded || c.field === 'drop' || c.field === 'ignore') return '';
      if (nameFields.has(c.field)) return safeNameCell(value) ? value : '[withheld]';
      if (c.field === 'grade') return gradeOf(value) ?? '';
      if (c.field === 'sex') return /^(M|F|male|female|lalaki|babae)$/i.test(value.trim()) ? value : '';
      return value.length <= 40 && !/\d{8,}|@/.test(value) ? value : '';
    });
    return { rowIndex, cells: sanitized, kind: excluded ? 'excluded' : 'data', grade, sex };
  });
  const rows = normalizeSource(source, columns, options.exactlyAsWritten);
  if (options.encodingReview) for (const row of rows) if (row.status !== 'not_student') { row.flags.push('corrupted_characters'); row.status = 'needs_review'; }
  return { source, columns, droppedColumns, rows, counts: rosterCounts(rows) };
}
