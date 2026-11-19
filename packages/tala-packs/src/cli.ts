/**
 * tala-packs CLI.
 *   targets                      list every weekly target (the coverage denominator)
 *   draft <targetId> [--flash]   draft one pack (writes build/work/<id>/draft.json)
 *   run [--targets a,b] [--all] [--budget 40] [--concurrency 2] [--stages ...]
 *                                resumable pipeline: draft → checks → critique → revise → images → render → ledger
 *   index                        rebuild library/index.json from pack folders
 *   render --targets a,b         re-render built packs from the library (no model calls)
 *   inventory                    write library/INVENTORY.md (coverage denominator, status, gaps, failures, spend)
 *   approve <packId> --by "<name>" --role "<role>" [--notes "..."]   record a HUMAN approval (never a model)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Meter, MODELS } from './llm';
import { loadInputs } from './context';
import { draftPack } from './generate';
import { BUILD, WORK } from './paths';
import { targetTopic } from './targets';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

async function main() {
  if (cmd === 'targets') {
    const { targets } = loadInputs();
    for (const t of targets) console.log(`${t.targetId}\t${t.competencies.length}\t${targetTopic(t)}`);
    console.log(`total ${targets.length}`);
    return;
  }
  if (cmd === 'draft') {
    const id = args[1]!;
    const t = loadInputs().targets.find((x) => x.targetId === id);
    if (!t) throw new Error(`Unknown target ${id}`);
    const meter = new Meter(Number(opt('budget', '3')), resolve(BUILD, 'calls.jsonl'));
    const res = await draftPack(meter, t, { writer: flag('flash') ? MODELS.writerFlash : MODELS.writer, thinking: !flag('no-thinking'), force: flag('force') });
    mkdirSync(resolve(WORK, id), { recursive: true });
    writeFileSync(resolve(WORK, id, 'draft.json'), JSON.stringify(res.content, null, 1));
    console.log(`drafted ${id}: ${res.content.slides.length} slides, cost $${res.costUsd.toFixed(4)} (${meter.calls} calls)`);
    return;
  }
  if (cmd === 'inventory') {
    const { writeInventory } = await import('./inventory');
    const text = writeInventory();
    console.log(text.split('\n').slice(0, 14).join('\n'));
    return;
  }
  if (cmd === 'run' || cmd === 'index' || cmd === 'approve' || cmd === 'render') {
    const { runCli } = await import('./runner');
    await runCli(cmd, args.slice(1));
    return;
  }
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
