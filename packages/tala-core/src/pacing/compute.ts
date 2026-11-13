import type { Competency, PacedItem, PacingInput, PacingPlan } from '../contracts/curriculum';
import { applyChecks } from '../curriculum';
import { enumerateSessions } from './sessions';

/** Minimum-constrained proportional apportionment, then stable largest remainders. */
export function allocate(weights: number[], total: number, minimum: number): number[] {
  const counts = weights.map(() => 0);
  if (!weights.length) return counts;
  if (total < minimum * weights.length) {
    for (let i = 0; i < counts.length && total >= minimum; i++, total -= minimum) counts[i] = minimum;
    return counts;
  }
  let pending = weights.map((_, i) => i), remaining = total;
  while (pending.length) {
    const sum = pending.reduce((n, i) => n + weights[i]!, 0);
    const small = pending.filter(i => remaining * weights[i]! / sum < minimum);
    if (!small.length) {
      const shares = pending.map(i => ({ i, value: remaining * weights[i]! / sum }));
      for (const s of shares) counts[s.i] = Math.floor(s.value);
      let rest = remaining - shares.reduce((n, s) => n + counts[s.i]!, 0);
      shares.sort((a, b) => (b.value % 1) - (a.value % 1) || a.i - b.i);
      for (const s of shares) { if (rest-- <= 0) break; counts[s.i]!++; }
      break;
    }
    for (const i of small) { counts[i] = minimum; remaining -= minimum; }
    pending = pending.filter(i => !small.includes(i));
  }
  return counts;
}

export function orderedCompetencies(input: PacingInput): Competency[] {
  const order = input.track.overrides.order ?? [];
  return applyChecks(input.competencies, input.checks, input.track.curriculumVersion)
    .filter(c => c.termIndex === input.term.index || input.track.overrides.movedIn?.includes(c.id))
    .sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || a.sequence - b.sequence || a.id.localeCompare(b.id);
    });
}

export function computePacing(input: PacingInput): PacingPlan {
  const { track } = input, overrides = track.overrides;
  const params = { ...input.defaults, ...track.params };
  const competencies = orderedCompetencies(input);
  const startIndex = track.startPosition ? competencies.findIndex(c => c.id === track.startPosition!.competencyId) : 0;
  const beforeIds = new Set(competencies.slice(0, Math.max(0, startIndex)).map(c => c.id));
  const deferred = new Set(overrides.deferred ?? []);
  const sessions = enumerateSessions(input.schoolYear, input.term, input.assignment, input.calendarDays).filter(s => !track.startPosition || s.date >= track.startPosition.date);
  const assessmentCount = Math.min(sessions.length, params.assessmentSessionsPerTerm);
  const assessmentSessions = assessmentCount ? sessions.slice(-assessmentCount) : [];
  const available = sessions.slice(0, sessions.length - assessmentCount);
  const bufferCount = Math.min(available.length, Math.floor(sessions.length * params.bufferRatio));
  const bufferSessions = bufferCount ? available.slice(-bufferCount) : [];
  const teach = available.slice(0, available.length - bufferCount);
  const used = new Set<string>();
  const groups: Competency[][] = [];
  for (const c of competencies) {
    if (used.has(c.id)) continue;
    const merge = overrides.merges?.find(m => m.includes(c.id));
    const group = merge && !beforeIds.has(c.id) && !deferred.has(c.id)
      ? competencies.filter(x => merge.includes(x.id) && !beforeIds.has(x.id) && !deferred.has(x.id) && !used.has(x.id)) : [c];
    group.forEach(x => used.add(x.id)); groups.push(group);
  }
  const active = groups.filter(g => !beforeIds.has(g[0]!.id) && !deferred.has(g[0]!.id));
  const fixed = active.map(g => {
    const explicit = g.map(c => overrides.sessions?.[c.id]).filter((n): n is number => n !== undefined);
    return explicit.length ? Math.max(...explicit) : g.length > 1 ? 1 : null;
  });
  const weights = active.map(g => g.reduce((n, c) => n + (overrides.weights?.[c.id] ?? c.weight ?? 1), 0));
  const flexible = active.map((_, i) => i).filter(i => fixed[i] === null);
  const budget = Math.max(0, teach.length - fixed.reduce<number>((n, x) => n + (x ?? 0), 0));
  const allocated = allocate(flexible.map(i => weights[i]!), budget, params.minSessionsPerCompetency);
  const counts = fixed.map(x => x ?? 0);
  flexible.forEach((i, j) => { counts[i] = allocated[j]!; });
  const taken = new Set<number>();
  const placements = new Map<string, typeof teach>();
  // Pins reserve their periods before unpinned competencies; collisions never silently overwrite.
  for (let i = 0; i < active.length; i++) {
    const g = active[i]!;
    const pin = g.map(c => overrides.pins?.[c.id]).find(Boolean);
    if (!pin) continue;
    const at = teach.findIndex(s => s.date === pin);
    const assigned: typeof teach = [];
    if (at >= 0) for (let k = at; k < teach.length && assigned.length < counts[i]!; k++) {
      if (taken.has(k)) break;
      taken.add(k); assigned.push(teach[k]!);
    }
    placements.set(g[0]!.id, assigned);
  }
  for (let i = 0; i < active.length; i++) {
    const g = active[i]!;
    if (placements.has(g[0]!.id)) continue;
    const assigned: typeof teach = [];
    for (let k = 0; k < teach.length && assigned.length < counts[i]!; k++) if (!taken.has(k)) { taken.add(k); assigned.push(teach[k]!); }
    placements.set(g[0]!.id, assigned);
  }
  let sessionsBehind = 0;
  const atRisk: string[] = [];
  const marks = input.marks.filter(m => m.classId === track.classId && m.assignmentId === track.assignmentId && m.gradeGroupId === track.gradeGroupId);
  const items: PacedItem[] = groups.map(g => {
    const ids = g.map(c => c.id), assigned = placements.get(ids[0]!) ?? [];
    const pinned = ids.some(id => overrides.pins?.[id] !== undefined);
    const weightSource = ids.some(id => overrides.weights?.[id] !== undefined) ? 'teacher' : g.every(c => c.weight !== null && c.weightSource === 'official') ? 'official' : 'estimated';
    let state: PacedItem['state'] = 'scheduled';
    if (beforeIds.has(ids[0]!)) state = 'before_tala';
    else if (deferred.has(ids[0]!)) state = 'deferred';
    else {
      const index = active.findIndex(a => a[0]!.id === ids[0]);
      if (assigned.length < (counts[index] || params.minSessionsPerCompetency)) atRisk.push(...ids);
      const relevant = marks.filter(m => m.competencyIds.some(id => ids.includes(id)));
      const past = assigned.filter(s => s.date < input.today);
      let credit = 0;
      for (const s of past) {
        const mark = relevant.find(m => m.date === s.date);
        credit += mark ? mark.status === 'taught' ? 1 : mark.status === 'partial' ? 0.5 : 0 : params.assumeTaught ? 1 : 0;
      }
      // Explicit early teaching earns credit; future-dated marks do not.
      credit += relevant.filter(m => m.date <= input.today && !past.some(s => s.date === m.date)).reduce((n, m) => n + (m.status === 'taught' ? 1 : m.status === 'partial' ? 0.5 : 0), 0);
      sessionsBehind += past.length - Math.min(Math.max(assigned.length, past.length), credit);
      if (!assigned.length) state = 'unscheduled';
      else if (credit >= assigned.length && relevant.some(m => m.status === 'taught')) state = 'taught';
      else if (relevant.some(m => m.date <= input.today && m.status === 'not_taught')) state = 'not_taught';
      else if (relevant.some(m => m.date <= input.today && m.status === 'partial')) state = 'partial';
      else if (past.length === assigned.length && params.assumeTaught) state = 'assumed_taught';
    }
    return { competencyIds: ids, sessions: assigned, state, pinned, weightSource };
  });
  return { trackId: track.id, items, bufferSessions, assessmentSessions, atRisk, sessionsBehind, effectiveParams: params };
}
