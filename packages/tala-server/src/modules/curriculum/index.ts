import { HttpError, requireUser, type ServerModule } from '../../kernel/types';
import { loadCurriculumData, type CurriculumData } from './data';
export { loadCurriculumData } from './data';
export function createCurriculumModule(options: { dataDirectory?: string; includeFixtures?: boolean } = {}): ServerModule {
  let loaded: CurriculumData | undefined;
  const data = () => loaded ??= loadCurriculumData(options.dataDirectory, options.includeFixtures);
  const pack = (id: string) => { const found = data().packs.get(id); if (!found) throw new HttpError('not_found', 'This curriculum has not been loaded yet. You can use your own objectives.'); return found; };
  return {
    name: 'curriculum', migrations: [],
    // Validates once at startup. A malformed source pack fails startup rather than serving bad data.
    services: () => ({ curriculum: data().service }),
    handlers: {
      'curriculum.index': () => data().index,
      'curriculum.pack': (_ctx, input) => pack(input.params.packId),
      'curriculum.checkSummary': (ctx, input) => {
        requireUser(ctx);
        const p = pack(input.params.packId);
        const tally = ctx.services.records.checkTallies(p.curriculumVersion, p.competencies.map(c => c.id));
        return { packId: p.packId, confirmedBy: tally.confirmed, correctedBy: tally.corrected };
      },
      'calendar.presets': () => ({ presets: [...data().presets.values()].map(({ days: _days, terms: _terms, ...meta }) => meta) }),
      'calendar.preset': (_ctx, input) => {
        const preset = data().presets.get(input.params.presetId);
        if (!preset) throw new HttpError('not_found', 'This calendar is not available. You can create your school calendar.');
        return preset;
      },
    },
  };
}
export const curriculumModule = createCurriculumModule();
