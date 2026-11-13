import { HttpError, requireUser, type ServerModule, type TalaServerConfig } from '../../kernel/types';
import { loadCurriculumData, type CurriculumData } from './data';
export { loadCurriculumData } from './data';
/** includeFixtures is retained for source compatibility; environment is the authority. */
export function createCurriculumModule(options: { dataDirectory?: string; includeFixtures?: boolean } = {}): ServerModule {
  const loaded = new Map<boolean, CurriculumData>();
  const data = (environment: TalaServerConfig['environment']) => {
    const fixtures = environment !== 'production';
    let catalog = loaded.get(fixtures);
    if (!catalog) { catalog = loadCurriculumData(options.dataDirectory, fixtures); loaded.set(fixtures, catalog); }
    return catalog;
  };
  const pack = (id: string, environment: TalaServerConfig['environment']) => { const found = data(environment).packs.get(id); if (!found) throw new HttpError('not_found', 'This curriculum has not been loaded yet. You can use your own objectives.'); return found; };
  return {
    name: 'curriculum', migrations: [],
    // Validates once at startup. A malformed source pack fails startup rather than serving bad data.
    services: ({ config }) => ({ curriculum: data(config.environment).service }),
    handlers: {
      'curriculum.index': ctx => data(ctx.config.environment).index,
      'curriculum.pack': (ctx, input) => pack(input.params.packId, ctx.config.environment),
      'curriculum.checkSummary': (ctx, input) => {
        requireUser(ctx);
        const p = pack(input.params.packId, ctx.config.environment);
        const tally = ctx.services.records.checkTallies(p.curriculumVersion, p.competencies.map(c => c.id));
        return { packId: p.packId, confirmedBy: tally.confirmed, correctedBy: tally.corrected };
      },
      'calendar.presets': ctx => ({ presets: [...data(ctx.config.environment).presets.values()].map(({ days: _days, terms: _terms, ...meta }) => meta) }),
      'calendar.preset': (ctx, input) => {
        const preset = data(ctx.config.environment).presets.get(input.params.presetId);
        if (!preset) throw new HttpError('not_found', 'This calendar is not available. You can create your school calendar.');
        return preset;
      },
    },
  };
}
export const curriculumModule = createCurriculumModule();
