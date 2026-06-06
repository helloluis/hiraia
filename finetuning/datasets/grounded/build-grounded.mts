// Build the grounding-faithfulness SFT set from an authored seed.
//
// Emits train-grounded.jsonl where each row's system message is assembled with
// the SAME functions the app uses at runtime (generateSystemPrompt +
// formatGroundingBlock) and the VERIFIED FACTS block is filled from the SAME
// fact bank the app serves (SCIENCE_FACTS) — so training and serving match.
//
//   run: node_modules/.bin/tsx finetuning/datasets/grounded/build-grounded.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCIENCE_FACTS } from '../../../packages/shared/src/rag/facts.generated.ts';
import { generateSystemPrompt, formatGroundingBlock } from '../../../packages/shared/src/prompts/system.ts';
import type { RagResult } from '../../../packages/shared/src/types/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

type Lang = 'tagalog' | 'cebuano';
const LANG_KEY: Record<Lang, 'tl' | 'bis'> = { tagalog: 'tl', cebuano: 'bis' };

interface SeedExample {
  mode: 'grounded' | 'abstain' | 'chitchat' | 'summarize';
  grade: number;
  factIds: string[];
  user: string;
  assistant: string;
}

// Auto-compacter instruction — MUST stay byte-identical to LocalEngine.summarize()
// and finetuning/eval/harness/probe-compaction.mts so train/serve/test all match.
const SUMMARIZE_INSTRUCTION =
  'Ibuod ang sumusunod na sagot ng science tutor sa ISA o DALAWANG napakaikling pangungusap, ' +
  'para magamit bilang maikling alaala (memory) sa susunod na usapan. Panatilihin LANG ang ' +
  'mahalagang science fact at termino. Alisin ang pagbati, mga halimbawa, at ang tanong sa dulo. ' +
  'Sumagot ng buod lamang, walang ibang sasabihin.\n\nSAGOT:\n';
interface Seed {
  language: Lang;
  examples: SeedExample[];
}

const byId = new Map(SCIENCE_FACTS.map((f) => [f.id, f]));

function groundingFor(factIds: string[], lang: Lang): RagResult[] {
  return factIds.map((id) => {
    const f = byId.get(id);
    if (!f) throw new Error(`Unknown factId in seed: ${id}`);
    return {
      content: f.fact[LANG_KEY[lang]],
      source: f.source,
      score: 1,
      metadata: { topic: f.topic },
    };
  });
}

function buildRow(ex: SeedExample, lang: Lang) {
  // Summarization rows train the auto-compacter. They are served with NO system
  // prompt (LocalEngine.summarize sends only a user turn), so train them the same
  // way: bare instruction + the answer to compress -> the target summary.
  if (ex.mode === 'summarize') {
    return {
      messages: [
        { role: 'user', content: SUMMARIZE_INSTRUCTION + ex.user },
        { role: 'assistant', content: ex.assistant },
      ],
    };
  }
  // tag-aware system (imageTags=true) so the adapter keeps [image: ...] behavior
  let system = generateSystemPrompt(lang as any, ex.grade as any, true);
  const block = formatGroundingBlock(groundingFor(ex.factIds, lang));
  if (block) system += `\n\n${block}`;
  // Multi-turn examples carry a `turns` array; single-turn use user/assistant.
  const turns =
    Array.isArray((ex as any).turns) && (ex as any).turns.length
      ? (ex as any).turns
      : [
          { role: 'user', content: ex.user },
          { role: 'assistant', content: ex.assistant },
        ];
  return { messages: [{ role: 'system', content: system }, ...turns] };
}

const seedFile = process.argv[2] ?? join(HERE, 'seed.tagalog.json');
const outFile = process.argv[3] ?? join(HERE, 'train-grounded.jsonl');

const seed: Seed = JSON.parse(readFileSync(seedFile, 'utf8'));
const counts: Record<string, number> = { grounded: 0, abstain: 0, chitchat: 0, summarize: 0 };
const lines: string[] = [];
for (const ex of seed.examples) {
  lines.push(JSON.stringify(buildRow(ex, seed.language)));
  counts[ex.mode] = (counts[ex.mode] ?? 0) + 1;
}

writeFileSync(outFile, lines.join('\n') + '\n');
console.log(`wrote ${lines.length} rows -> ${outFile}`);
console.log(
  `  modes: grounded=${counts.grounded} abstain=${counts.abstain} chitchat=${counts.chitchat} summarize=${counts.summarize}`
);
