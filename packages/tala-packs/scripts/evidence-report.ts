/**
 * Evidence report for the teaching-pack work: coverage denominator, per-pack review stages (kept separate), wording
 * metrics, which model wrote which artifact tier, spend, and links to sample files and screenshots.
 *
 *   npx tsx scripts/evidence-report.ts --packs a,b,c --samples samples.tsv --shots shots.tsv --narrative narrative.json \
 *     --out build/evidence/report
 *
 * samples.tsv: packId<TAB>lang<TAB>file<TAB>url (scripts/publish_samples.sh); shots.tsv: label<TAB>url.
 * narrative.json: { "title": "...", "sections": [ { "heading": "...", "paragraphs": ["..."], "bullets": ["..."] } ] }
 * Writes <out>.html (static HTML, inline CSS only, no scripts or images: the relay's sandbox allows none) and <out>.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PackReview, WeeklyPackContent, type PackLang } from '@hiraia/tala-core/contracts';
import { buildIndex } from '../src/runner';
import { BUILD, LIBRARY } from '../src/paths';

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const packIds = (opt('packs') ?? '').split(',').filter(Boolean);
const tsv = (f?: string) => (f && existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')) : []);
const samples = tsv(opt('samples'));
const shots = tsv(opt('shots'));
const narrative = opt('narrative') ? (JSON.parse(readFileSync(opt('narrative')!, 'utf8')) as { title: string; sections: Array<{ heading: string; paragraphs?: string[]; bullets?: string[] }> }) : { title: 'Teaching packs — evidence', sections: [] };
const out = resolve(opt('out') ?? resolve(BUILD, 'evidence', 'report'));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** `code` and **bold** and [text](https://…) only. */
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

// ---- spend per artifact tier, from the call ledger ----
type Call = { at: string; label: string; model: string; costUsd: number };
const calls: Call[] = existsSync(resolve(BUILD, 'calls.jsonl'))
  ? readFileSync(resolve(BUILD, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const tierOf = (stage: string): string =>
  stage === 'outline' ? 'Week design, teacher guide, assessment (English)'
  : /^day\d$/.test(stage) ? 'Day plans, slides, speaker notes (English)'
  : stage === 'image' ? 'Illustration checks'
  : stage === 'fil-guide' ? 'Teacher guide + assessment (Filipino)'
  : /^fil-day\d$/.test(stage) ? 'Day plans, slides, speaker notes (Filipino)'
  : /^(en-)?(critique|recheck)\d$/.test(stage) ? 'Model critique (English)'
  : /^fil-(critique|recheck)\d$/.test(stage) ? 'Model critique (Filipino)'
  : /^(en-)?revise\d$/.test(stage) ? 'Revisions (English)'
  : /^fil-revise\d$/.test(stage) ? 'Revisions (Filipino)'
  : 'other';
/** Cost of the path that produced the current files: for each stage, the calls of its most recent run only. */
function finalPathCost(packId: string) {
  const mine = calls.filter((c) => c.label.startsWith(`${packId}:`));
  const byStage = new Map<string, Call[]>();
  for (const c of mine) {
    const parts = c.label.split(':');
    const stage = parts[1] === 'image' ? `image:${parts[2]}:${parts[3]}` : parts[1]!;
    byStage.set(stage, [...(byStage.get(stage) ?? []), c]);
  }
  const tiers = new Map<string, { models: Set<string>; usd: number }>();
  for (const [stage, cs] of byStage) {
    // Stages named before the bilingual pipeline (critique1, revise1 without a language) feed no current file.
    if (/^(critique|revise)\d$/.test(stage)) continue;
    // attempts of one run are numbered 1..n; the last run starts at the last attempt numbered 1
    const lastStart = cs.map((c) => c.label.split(':').at(-1)).lastIndexOf('1');
    const run = stage.startsWith('image:') ? cs.slice(-1) : cs.slice(Math.max(0, lastStart));
    const tier = tierOf(stage.startsWith('image:') ? 'image' : stage);
    const t = tiers.get(tier) ?? { models: new Set(), usd: 0 };
    for (const c of run) {
      t.models.add(c.model);
      t.usd += c.costUsd;
    }
    tiers.set(tier, t);
  }
  return { tiers, allAttemptsUsd: mine.reduce((n, c) => n + c.costUsd, 0) };
}

// ---- per pack ----
const index = buildIndex(true);
const rows: string[][] = [];
const mdRows: string[] = [];
const packBlocks: string[] = [];
const mdBlocks: string[] = [];
for (const id of packIds) {
  const entry = index.packs.find((p) => p.packId === id);
  if (!entry) continue;
  for (const lang of ['en', 'fil'] as PackLang[]) {
    const v = entry.variants[lang];
    const rf = resolve(LIBRARY, id, lang, 'review.json');
    if (!existsSync(rf)) {
      rows.push([id, lang, v.status, '—', '—', '—', '—', '—']);
      continue;
    }
    const r = PackReview.parse(JSON.parse(readFileSync(rf, 'utf8')));
    const pack = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(LIBRARY, id, lang, 'pack.json'), 'utf8')));
    const detail = JSON.parse(readFileSync(resolve(LIBRARY, id, lang, 'review-detail.json'), 'utf8')) as { verification?: { confirmedFixed: number; withdrawn: number } };
    const m = r.verbiage?.metrics ?? {};
    const row = [
      id,
      lang,
      v.status,
      `${pack.slides.length} (${pack.slides.filter((s) => s.image).length} illustrated)`,
      `${r.autoChecks.state}${r.autoChecks.failures.length ? `: ${r.autoChecks.failures.length} failing` : ''}, ${r.autoChecks.warnings.length} warnings`,
      `${r.modelCritique.state}; ${r.modelCritique.rounds} rounds; ${detail.verification?.confirmedFixed ?? 0} confirmed fixed, ${detail.verification?.withdrawn ?? 0} withdrawn, ${r.modelCritique.openIssues.length} open`,
      r.verbiage ? `${r.verbiage.state}: max ${m.maxWordsOnSlide} words/slide, ${m.slidesOver48Words} over 48, avg sentence ${m.avgSentenceWords} words${lang === 'fil' ? `, English function words ${(((m.englishFunctionShare as number) ?? 0) * 100).toFixed(0)}%` : ''}` : '—',
      r.teacherReview ? `${r.teacherReview.reviewer}` : 'none (no human review yet)',
    ];
    rows.push(row);
    mdRows.push(`| ${row.join(' | ')} |`);
    const files = samples.filter((s) => s[0] === id && s[1] === lang);
    const open = r.modelCritique.openIssues;
    packBlocks.push(
      `<h3>${esc(id)} · ${lang === 'en' ? 'English' : 'Filipino'} — ${esc(pack.title)}</h3>` +
        (files.length ? `<p>${files.map((f) => `<a href="${esc(f[3]!)}">${esc(f[2]!)}</a>`).join(' · ')}</p>` : '') +
        (open.length ? `<p>Open model-critique issues (${open.length}):</p><ul>${open.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : '<p>No blocker or major model-critique issue left open.</p>') +
        (r.verbiage?.findings.length ? `<p>Wording findings:</p><ul>${r.verbiage.findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '')
    );
    mdBlocks.push(
      `### ${id} · ${lang === 'en' ? 'English' : 'Filipino'} — ${pack.title}\n\n` +
        (files.length ? files.map((f) => `- [${f[2]}](${f[3]})`).join('\n') + '\n\n' : '') +
        (open.length ? `Open model-critique issues (${open.length}):\n\n${open.map((o) => `- ${o}`).join('\n')}\n\n` : 'No blocker or major model-critique issue left open.\n\n') +
        (r.verbiage?.findings.length ? `Wording findings:\n\n${r.verbiage.findings.map((f) => `- ${f}`).join('\n')}\n\n` : '')
    );
  }
}

// ---- spend table ----
const spendRows: string[][] = [];
const tierTotals = new Map<string, { models: Set<string>; usd: number }>();
for (const id of packIds) {
  const { tiers, allAttemptsUsd } = finalPathCost(id);
  let total = 0;
  for (const [tier, t] of tiers) {
    total += t.usd;
    const agg = tierTotals.get(tier) ?? { models: new Set(), usd: 0 };
    t.models.forEach((m) => agg.models.add(m));
    agg.usd += t.usd;
    tierTotals.set(tier, agg);
  }
  spendRows.push([id, `$${total.toFixed(2)}`, `$${allAttemptsUsd.toFixed(2)}`]);
}
const tierRows = [...tierTotals.entries()].filter(([k]) => k !== 'other').map(([tier, t]) => [tier, [...t.models].join(', '), `$${(t.usd / Math.max(1, packIds.length)).toFixed(3)}`]);

const c = index.counts;
const table = (head: string[], body: string[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((x) => `<td>${inline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const mdTable = (head: string[], body: string[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const coverageHead = ['Status', 'Language versions'];
const coverageBody = [
  ['Denominator (262 printed DepEd weeks × English and Filipino)', String(c.targets)],
  ['Approved (public)', String(c.approved)],
  ['Draft (checks pass, no open blocker/major critique issue, awaiting human review)', String(c.draft)],
  ['Needs work', String(c.needsWork)],
  ['Failed', String(c.failed)],
  ['Not built', String(c.notBuilt)],
];
const packHead = ['Week', 'Lang', 'Status', 'Slides', 'Automatic checks', 'Model critique (not human review)', 'Wording (Hiraia rules, verbiage/1)', 'Teacher / expert review'];
const spendHead = ['Week', 'Cost of the files as built', 'All attempts incl. failed ones'];
const tierHead = ['Artifact tier', 'Model (direct API)', 'Avg cost per week'];

const css = `body{font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#1C3B2E;background:#fff}
h1{font-family:Cambria,Georgia,serif;font-size:2rem;margin:.2rem 0 1rem}h2{font-family:Cambria,Georgia,serif;border-bottom:2px solid #F5ECD6;padding-bottom:.2rem;margin-top:2.2rem}
table{border-collapse:collapse;width:100%;font-size:.88rem;margin:.6rem 0 1.2rem}th,td{border:1px solid #d9d2bf;padding:.35rem .5rem;text-align:left;vertical-align:top}th{background:#F5ECD6}
code{background:#f4f1e8;padding:0 .25rem;border-radius:3px}a{color:#2F6360}li{margin:.2rem 0}.muted{color:#6b6b6b}`;
const sections = narrative.sections
  .map((s) => `<h2>${esc(s.heading)}</h2>${(s.paragraphs ?? []).map((p) => `<p>${inline(p)}</p>`).join('')}${s.bullets?.length ? `<ul>${s.bullets.map((b) => `<li>${inline(b)}</li>`).join('')}</ul>` : ''}`)
  .join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(narrative.title)}</title><style>${css}</style></head><body>
<h1>${esc(narrative.title)}</h1><p class="muted">Generated ${new Date().toISOString()} from the pack library, review records and call ledger.</p>
${sections}
<h2>Coverage</h2>${table(coverageHead, coverageBody)}
<h2>Representative packs: review stages, kept separate</h2>${table(packHead, rows)}
${packBlocks.join('')}
<h2>Which model wrote what, and cost</h2>${table(tierHead, tierRows)}${table(spendHead, spendRows)}
${shots.length ? `<h2>Screenshots</h2><ul>${shots.map((s) => `<li><a href="${esc(s[1]!)}">${esc(s[0]!)}</a></li>`).join('')}</ul>` : ''}
</body></html>`;
const md = [
  `# ${narrative.title}`,
  '',
  ...narrative.sections.flatMap((s) => [`## ${s.heading}`, '', ...(s.paragraphs ?? []).flatMap((p) => [p, '']), ...(s.bullets ?? []).map((b) => `- ${b}`), '']),
  '## Coverage',
  '',
  mdTable(coverageHead, coverageBody),
  '',
  '## Representative packs: review stages, kept separate',
  '',
  mdTable(packHead, rows),
  '',
  ...mdBlocks,
  '## Which model wrote what, and cost',
  '',
  mdTable(tierHead, tierRows),
  '',
  mdTable(spendHead, spendRows),
  '',
  ...(shots.length ? ['## Screenshots', '', ...shots.map((s) => `- [${s[0]}](${s[1]})`), ''] : []),
].join('\n');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.html`, html);
writeFileSync(`${out}.md`, md);
console.log(`${out}.html\n${out}.md`);
