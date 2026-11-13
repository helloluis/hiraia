import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CalendarPreset, CurriculumPack, type CurriculumIndex } from '@hiraia/tala-core';
import { packId } from '@hiraia/tala-core/curriculum';
import type { CurriculumService } from '../../kernel/types';

export interface CurriculumData {
  index: CurriculumIndex;
  packs: Map<string, CurriculumPack>;
  presets: Map<string, CalendarPreset>;
  service: CurriculumService;
}
export const defaultDataDirectory = fileURLToPath(new URL('../../../data/', import.meta.url));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function loadCurriculumData(directory = defaultDataDirectory, includeFixtures = false): CurriculumData {
  const packs = new Map<string, CurriculumPack>(), presets = new Map<string, CalendarPreset>();
  const byVersion = new Map<string, Map<string, CurriculumPack['competencies'][number]>>();
  for (const folder of includeFixtures ? ['packs', 'fixtures'] : ['packs']) {
    for (const name of readdirSync(join(directory, folder)).filter(f => f.endsWith('.json')).sort()) {
      const raw = readFileSync(join(directory, folder, name));
      const pack = CurriculumPack.parse(JSON.parse(raw.toString('utf8')));
      if (pack.packId !== packId(pack.curriculumVersion, pack.grade, pack.learningAreaId) || pack.competencyCount !== pack.competencies.length || pack.bytes !== raw.byteLength || packs.has(pack.packId)) throw new Error(`Invalid curriculum pack metadata: ${name}`);
      const fixture = pack.curriculumVersion.startsWith('fixture-');
      if ((folder === 'fixtures') !== fixture) throw new Error(`Fixture must be isolated from curriculum: ${name}`);
      const version = byVersion.get(pack.curriculumVersion) ?? new Map();
      for (const c of pack.competencies) {
        if (c.grade !== pack.grade || c.learningAreaId !== pack.learningAreaId || !c.id.startsWith(`${pack.curriculumVersion}.`) || version.has(c.id)) throw new Error(`Inconsistent competency identity: ${name}`);
        if (!fixture && (!c.source.page || !c.source.url)) throw new Error(`Source page and URL are required: ${name}`);
        if (fixture && !c.text.startsWith('SAMPLE DATA')) throw new Error(`Unlabelled fixture: ${name}`);
        version.set(c.id, c);
      }
      byVersion.set(pack.curriculumVersion, version); packs.set(pack.packId, pack);
    }
  }
  for (const name of readdirSync(join(directory, 'calendars')).filter(f => f.endsWith('.json')).sort()) {
    const preset = CalendarPreset.parse(JSON.parse(readFileSync(join(directory, 'calendars', name), 'utf8')));
    if (presets.has(preset.id) || preset.startDate > preset.endDate || preset.terms.some(t => t.startDate > t.endDate || t.startDate < preset.startDate || t.endDate > preset.endDate)) throw new Error(`Invalid calendar preset: ${name}`);
    presets.set(preset.id, preset);
  }
  const areaGroups = new Map<string, CurriculumIndex['learningAreas'][number]>();
  for (const p of packs.values()) {
    const stage = p.grade === 'K' ? 'kinder' : Number(p.grade) <= 6 ? 'elementary' : Number(p.grade) <= 10 ? 'jhs' : 'shs_core';
    const key = p.learningAreaId;
    const name = p.learningAreaId === 'science' ? { en: 'Science', fil: 'Agham' } : { en: 'Mathematics (sample data)', fil: 'Matematika (halimbawang datos)' };
    const area = areaGroups.get(key) ?? { id: p.learningAreaId, name, grades: [], stage, stages: [] };
    if (!area.stages!.includes(stage)) area.stages!.push(stage);
    if (!area.grades.includes(p.grade)) area.grades.push(p.grade);
    areaGroups.set(key, area);
  }
  const stageOrder = ['kinder', 'elementary', 'jhs', 'shs_core'];
  for (const area of areaGroups.values()) {
    area.grades.sort((a, b) => (a === 'K' ? 0 : Number(a)) - (b === 'K' ? 0 : Number(b)));
    area.stages!.sort((a, b) => stageOrder.indexOf(a) - stageOrder.indexOf(b));
    area.stage = area.stages![0]!;
  }
  const index = { learningAreas: [...areaGroups.values()], packs: [...packs.values()].map(({ competencies: _competencies, ...meta }) => meta) };
  const service: CurriculumService = {
    getCompetencies(version, ids) { const map = byVersion.get(version); return ids.flatMap(id => map?.has(id) ? [clone(map.get(id)!)] : []); },
    versionFor(year, grade, area) {
      const candidates = [...packs.values()].filter(p => p.schoolYears.includes(year) && p.grade === grade && p.learningAreaId === area);
      // Prefer sourced packs even when sample data was explicitly enabled.
      candidates.sort((a, b) => Number(a.curriculumVersion.startsWith('fixture-')) - Number(b.curriculumVersion.startsWith('fixture-')) || b.dataRevision - a.dataRevision || a.curriculumVersion.localeCompare(b.curriculumVersion));
      return candidates[0]?.curriculumVersion ?? null;
    },
  };
  return { packs, presets, index, service };
}
