/**
 * Community search (COM-2, COM-3, COM-7, §14.1).
 *
 * - Only `visible` artifacts, plus the caller's own (any status but removed).
 * - Every contract filter is a SQL condition; grade and competency use the term table.
 * - Free text: a deterministic parser lifts grade / quarter / learning area out of the query (§9.8: rules
 *   first); the rest is keyword search over title, summary and subject. The model step for the remainder is
 *   not used in V1.0 (see README), so the search never spends a model call.
 * - Ranking: competency match (how focused the lesson is on the asked competency), then keyword relevance,
 *   then copy count, then last update. Recency only breaks ties.
 * - 20 per page (config, never above the contract's page size), 200 results per query at most.
 */
import { GradeLevel, LIMITS } from '@hiraia/tala-core';
import type { ArtifactSearchQuery, ArtifactSummary } from '@hiraia/tala-core';
import type { z } from 'zod';
import { HttpError } from '../../kernel/types';
import type { CommunityDeps } from './service';
import { toSummary } from './store';
import type { ArtifactRow } from './store';

type Query = z.output<typeof ArtifactSearchQuery>;

export interface ParsedQuery {
  grade: GradeLevel | null;
  termIndex: number | null;
  learningAreaId: string | null;
  keywords: string[];
}

/**
 * Learning-area words mapped to curriculum ids that exist in the loaded packs. Other subjects stay as
 * keywords, which match the subject name, so a guessed id can never hide every result.
 */
const LEARNING_AREAS: Array<[RegExp, string]> = [
  [/^(?:science|agham)$/, 'science'],
  [/^(?:math|maths|mathematics|matematika)$/, 'mathematics'],
];

const ORDINALS: Record<string, number> = { una: 1, unang: 1, first: 1, ikalawa: 2, ikalawang: 2, second: 2, ikatlo: 3, ikatlong: 3, third: 3, ikaapat: 4, fourth: 4 };

const STOPWORDS = new Set(
  'the a an of for in on to and at ng sa mga ang na lesson lessons plan plans aralin banghay dll dlp about tungkol para'.split(' '),
);

/**
 * Lift grade, quarter and learning area out of free text. "grade 4 science q2 water cycle" →
 * { grade: '4', termIndex: 2, learningAreaId: 'science', keywords: ['water', 'cycle'] }.
 */
export function parseQuery(q: string): ParsedQuery {
  let text = ` ${q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;
  const out: ParsedQuery = { grade: null, termIndex: null, learningAreaId: null, keywords: [] };
  const take = (re: RegExp, f: (m: RegExpMatchArray) => void) => {
    const m = text.match(re);
    if (m) {
      f(m);
      text = text.replace(m[0], ' ');
    }
  };
  take(/\b(?:grade|gr\.?|g|baitang|ika-?)\s*(\d{1,2}|k)\b(?:\s*na\s+baitang)?/, (m) => {
    const g = m[1]!.toUpperCase();
    if ((GradeLevel.options as readonly string[]).includes(g)) out.grade = g as GradeLevel;
  });
  take(/\b(?:q|quarter|markahan|term)\s*(\d)\b/, (m) => (out.termIndex = Number(m[1])));
  take(/\b(una|unang|first|ikalawa|ikalawang|second|ikatlo|ikatlong|third|ikaapat|fourth)\s+(?:na\s+)?(?:markahan|quarter)\b/, (m) => (out.termIndex = ORDINALS[m[1]!] ?? null));
  const words = text.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  for (const w of words) {
    const area = !out.learningAreaId ? LEARNING_AREAS.find(([re]) => re.test(w)) : undefined;
    if (area) {
      out.learningAreaId = area[1];
      continue;
    }
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    if (!out.keywords.includes(w)) out.keywords.push(w);
  }
  out.keywords = out.keywords.slice(0, 8);
  return out;
}

/* ---------------- cursor ---------------- */

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const o = (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown }).o;
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0 && o <= LIMITS.maxCommunityResults) return o;
  } catch {
    /* fall through */
  }
  throw new HttpError('invalid_input', 'This list is out of date. Please search again.');
}

/* ---------------- search ---------------- */

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function searchArtifacts(deps: CommunityDeps, userId: string, query: Query): { items: ArtifactSummary[]; nextCursor: string | null } {
  const pageSize = Math.min(deps.config.limits.pageSize, LIMITS.pageSize);
  const cap = LIMITS.maxCommunityResults;
  const offset = decodeCursor(query.cursor);
  if (offset >= cap) return { items: [], nextCursor: null };

  const parsed = query.q ? parseQuery(query.q) : { grade: null, termIndex: null, learningAreaId: null, keywords: [] };
  const grade = query.grade ?? parsed.grade;
  const termIndex = query.termIndex ?? parsed.termIndex;
  const learningAreaId = query.learningAreaId ?? parsed.learningAreaId;

  const where: string[] = [];
  const params: Record<string, unknown> = { me: userId };
  if (query.mine) where.push("a.author_id = @me AND a.status != 'removed'");
  else where.push("(a.status = 'visible' OR (a.author_id = @me AND a.status != 'removed'))");
  if (grade) {
    where.push("EXISTS (SELECT 1 FROM community_artifact_terms t WHERE t.artifact_id = a.id AND t.kind = 'grade' AND t.value = @grade)");
    params['grade'] = grade;
  }
  if (query.competencyId) {
    where.push("EXISTS (SELECT 1 FROM community_artifact_terms t WHERE t.artifact_id = a.id AND t.kind = 'competency' AND t.value = @competency)");
    params['competency'] = query.competencyId;
  }
  if (learningAreaId) {
    where.push('a.learning_area_id = @learningArea');
    params['learningArea'] = learningAreaId;
  }
  if (termIndex != null) {
    where.push('a.term_index = @term');
    params['term'] = termIndex;
  }
  if (query.language) {
    where.push('a.language = @language');
    params['language'] = query.language;
  }
  if (query.region?.trim()) {
    where.push('lower(a.region) = lower(@region)');
    params['region'] = query.region.trim();
  }
  if (query.multigrade?.trim()) {
    // Accept any order and spacing: '4, 2' means the 2+4 combination.
    const combo = query.multigrade
      .split(',')
      .map((g) => g.trim().toUpperCase())
      .filter(Boolean);
    const order = GradeLevel.options as readonly string[];
    where.push('a.multigrade = @multigrade');
    params['multigrade'] = [...new Set(combo)].sort((x, y) => order.indexOf(x) - order.indexOf(y)).join(',');
  }
  if (query.maxMinutes != null) {
    where.push('a.duration_minutes <= @maxMinutes');
    params['maxMinutes'] = query.maxMinutes;
  }
  const keywordScore: string[] = [];
  parsed.keywords.forEach((k, i) => {
    const key = `kw${i}`;
    params[key] = `%${likeEscape(k)}%`;
    where.push(`(lower(a.title) LIKE @${key} ESCAPE '\\' OR lower(a.summary) LIKE @${key} ESCAPE '\\' OR lower(a.subject_name) LIKE @${key} ESCAPE '\\')`);
    keywordScore.push(`(CASE WHEN lower(a.title) LIKE @${key} ESCAPE '\\' THEN 2 ELSE 1 END)`);
  });

  // Competency match: a lesson on just this competency ranks above one that covers it among many.
  const order: string[] = [];
  if (query.competencyId) order.push('1.0 / MAX(a.competency_count, 1) DESC');
  if (keywordScore.length) order.push(`(${keywordScore.join(' + ')}) DESC`);
  order.push('a.copy_count DESC', 'a.updated_at DESC', 'a.id');
  const limit = Math.min(pageSize, cap - offset);
  const rows = deps.db
    .prepare(
      `SELECT a.* FROM community_artifacts a
       WHERE ${where.join(' AND ')}
       ORDER BY ${order.join(', ')}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: limit + 1, offset }) as ArtifactRow[];

  const more = rows.length > limit && offset + limit < cap;
  return {
    items: rows.slice(0, limit).map((r) => toSummary(deps.db, r, userId)),
    nextCursor: more ? encodeCursor(offset + limit) : null,
  };
}
