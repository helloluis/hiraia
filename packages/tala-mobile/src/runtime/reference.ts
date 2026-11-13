import { CalendarPreset, CurriculumPack } from '@hiraia/tala-core/contracts';
import type { LocalStore, TalaClient, CalendarPreset as Preset, CurriculumPack as Pack } from '@hiraia/tala-core/contracts';
/** Reference data is committed as a whole only after schema validation; interrupted fetch leaves old pack intact. */
export function referenceCache(store: LocalStore, client: TalaClient) {
  return {
    async packs(): Promise<Pack[]> { const ids = JSON.parse(await store.getMeta('packs') ?? '[]') as string[]; const all = await Promise.all(ids.map(id => store.getMeta(`pack.${id}`))); return all.filter((x): x is string => !!x).map(x => CurriculumPack.parse(JSON.parse(x))); },
    async presets(): Promise<Preset[]> { return JSON.parse(await store.getMeta('presets') ?? '[]').map((x: unknown) => CalendarPreset.parse(x)); },
    async refresh(grades: string[], areas: string[]) {
      const index = await client.call('curriculum.index');
      const selected = index.packs.filter(p => grades.includes(p.grade) && areas.includes(p.learningAreaId));
      for (const meta of selected) {
        const old = await store.getMeta(`pack.${meta.packId}`);
        if (old && CurriculumPack.parse(JSON.parse(old)).dataRevision >= meta.dataRevision) continue;
        const pack = CurriculumPack.parse(await client.call('curriculum.pack', {params:{packId:meta.packId}}));
        const ids = new Set<string>(JSON.parse(await store.getMeta('packs') ?? '[]')); ids.add(pack.packId);
        await store.commit({meta:{[`pack.${pack.packId}`]:JSON.stringify(pack), packs:JSON.stringify([...ids])}});
      }
      const {presets} = await client.call('calendar.presets');
      const full: Preset[] = [];
      for (const preset of presets) full.push(CalendarPreset.parse(await client.call('calendar.preset',{params:{presetId:preset.id}})));
      await store.commit({meta:{presets:JSON.stringify(full)}});
    },
  };
}
