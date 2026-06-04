#!/usr/bin/env node
/**
 * The correctness gate. Runtime ONLY serves verified:true factoids, and the only
 * way to earn that flag is to pass this check.
 *
 *   PROMOTE staged drafts (default): fact-check each verified:false entry in
 *   bank/staging.json; passes move into bank/factoids.json (verified:true),
 *   failures stay in staging with a verifyNote explaining why.
 *     node scripts/verify-bank.mjs
 *
 *   RECHECK the live bank (audit): re-verify already-served facts, flag any the
 *   checker is no longer confident about (does not auto-remove).
 *     node scripts/verify-bank.mjs --recheck
 *
 * The checker is deliberately skeptical: "not confident" counts as a FAIL, so a
 * weak model errs toward withholding rather than asserting a wrong fact to a kid.
 * Use a STRONG model here (point HIRAIA_LLM_* at it); --mock tests plumbing only.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatComplete, mockComplete, extractJson, LLM_CONFIG } from './llm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const BANK_PATH = join(PKG, 'bank', 'factoids.json');
const STAGING_PATH = join(PKG, 'bank', 'staging.json');

function parseArgs(argv) {
  const a = { recheck: false, limit: 1000, ids: null, mock: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--recheck') a.recheck = true;
    else if (k === '--limit') a.limit = parseInt(argv[++i], 10);
    else if (k === '--ids') a.ids = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--mock') a.mock = true;
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const complete = args.mock ? mockComplete : chatComplete;
const iso = new Date().toISOString();
const modelLabel = args.mock ? 'mock' : `${LLM_CONFIG.model}@${LLM_CONFIG.baseUrl}`;

const readJson = (p, f) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : f);
const factoidsOf = (file) => (Array.isArray(file) ? file : file?.factoids || []);
const write = (p, factoids) => writeFileSync(p, JSON.stringify({ version: 1, builtAt: iso, count: factoids.length, factoids }, null, 2) + '\n');

const VERIFY_SYSTEM =
  'You are a strict science fact-checker for a children\'s tutor in the Philippines. ' +
  'Given a factual claim, decide: is it factually correct, safe/appropriate for grade-school, and are you CONFIDENT about it? ' +
  'Be skeptical — if you are not confident it is correct, answer correct:false. No human-reproduction topics. ' +
  'Output STRICT JSON only: {"correct":true|false,"confident":true|false,"issue":"<short reason or empty>","correction":"<corrected claim if easily fixable, else empty>"}';
const verifyUser = (f) => `Claim: ${f.source || f.hook?.en || f.hook?.tl}\nSubject: ${f.subject}`;

async function check(f) {
  const text = await complete(
    [
      { role: 'system', content: VERIFY_SYSTEM },
      { role: 'user', content: verifyUser(f) },
    ],
    { temperature: 0, maxTokens: 200 },
  );
  const j = extractJson(text);
  if (!j) return { pass: false, note: 'verifier returned unparseable output' };
  const pass = j.correct === true && j.confident === true;
  return { pass, note: pass ? '' : `${j.issue || 'not confident'}${j.correction ? ` | sugg: ${j.correction}` : ''}` };
}

async function runPromote() {
  const staging = factoidsOf(readJson(STAGING_PATH, null));
  if (staging.length === 0) {
    console.log(`No staging at ${STAGING_PATH} (nothing to promote). Run: node scripts/generate-factoids.mjs --mode draft`);
    return;
  }
  const bank = factoidsOf(readJson(BANK_PATH, null));
  const bankIds = new Set(bank.map((f) => f.id));

  let pending = staging.filter((f) => f.verified !== true);
  if (args.ids) pending = pending.filter((f) => args.ids.includes(f.id) || args.ids.includes(f.imageId));
  pending = pending.slice(0, args.limit);

  console.log(`VERIFY · model=${modelLabel} · ${pending.length} staged draft(s)\n`);
  const promoted = [];
  const keep = new Map(staging.map((f) => [f.id, f]));
  let pass = 0;
  for (const f of pending) {
    process.stdout.write(`  • ${f.id} … `);
    try {
      const r = await check(f);
      if (r.pass && !bankIds.has(f.id)) {
        const v = { ...f, verified: true, verifiedBy: modelLabel, verifiedAt: iso };
        delete v.verifyNote;
        promoted.push(v);
        keep.delete(f.id);
        pass++;
        console.log('PASS → promoted');
      } else {
        keep.set(f.id, { ...f, verifyNote: r.note });
        console.log(`FAIL (${r.note})`);
      }
    } catch (err) {
      keep.set(f.id, { ...f, verifyNote: `error: ${err.message}` });
      console.log(`ERROR ${err.message}`);
    }
  }

  if (promoted.length) write(BANK_PATH, [...bank, ...promoted]);
  write(STAGING_PATH, [...keep.values()]);
  console.log(`\nPromoted ${pass}/${pending.length} → ${BANK_PATH}. Remaining in staging: ${keep.size}.`);
}

async function runRecheck() {
  const bank = factoidsOf(readJson(BANK_PATH, null));
  let targets = bank.filter((f) => f.verified === true);
  if (args.ids) targets = targets.filter((f) => args.ids.includes(f.id) || args.ids.includes(f.imageId));
  targets = targets.slice(0, args.limit);
  console.log(`RECHECK · model=${modelLabel} · auditing ${targets.length} live factoid(s)\n`);
  const flagged = [];
  for (const f of targets) {
    process.stdout.write(`  • ${f.id} … `);
    try {
      const r = await check(f);
      console.log(r.pass ? 'ok' : `⚠️  FLAG (${r.note})`);
      if (!r.pass) flagged.push({ id: f.id, note: r.note });
    } catch (err) {
      console.log(`ERROR ${err.message}`);
      flagged.push({ id: f.id, note: `error: ${err.message}` });
    }
  }
  console.log(`\n${flagged.length} flagged${flagged.length ? ':' : '.'}`);
  for (const x of flagged) console.log(`  ⚠️  ${x.id} — ${x.note}`);
  if (flagged.length) console.log('\nReview these by hand; this audit does not auto-remove anything.');
}

(async () => {
  try {
    if (args.recheck) await runRecheck();
    else await runPromote();
  } catch (err) {
    console.error(`\n✖ ${err.message}`);
    process.exit(1);
  }
})();
