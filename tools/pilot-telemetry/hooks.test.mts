import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const mobile =
  process.env.PILOT_MOBILE_PATH ||
  path.resolve(import.meta.dirname, '../../../hiraia-unified/packages/mobile');
const temp = mkdtempSync(path.join(tmpdir(), 'hiraia-hooks-'));
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
const load = async (entry: string) => {
  const outfile = path.join(temp, `${entry}.cjs`);
  await build({
    entryPoints: [path.join(mobile, `src/telemetry/${entry}.ts`)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'capture-events',
        setup(b) {
          b.onResolve({ filter: /^\.\/index$/ }, () => ({
            path: path.join(import.meta.dirname, 'events-shim.ts'),
          }));
        },
      },
    ],
  });
  return createRequire(import.meta.url)(outfile);
};
const views = await load('views');
const download = await load('download');
test('quiz repeated tap grades once, shares attempt IDs, and quick answers still record shown', () => {
  const events: any[] = ((globalThis as any).__telemetryEvents = []);
  views.gradeQuiz(1, 'fact-1', 'tagalog', false);
  views.gradeQuiz(1, 'fact-1', 'tagalog', true);
  views.showQuiz(1, 'fact-1', 'tagalog');
  assert.deepEqual(
    events.map((e) => e.name),
    ['quiz_shown', 'quiz_answer_submitted', 'quiz_graded']
  );
  assert.equal(events[2].props.correct, false);
  assert.equal(new Set(events.map((e) => e.props.attempt_id)).size, 1);
});
test('re-renders of the same page do not inflate views', () => {
  const events: any[] = ((globalThis as any).__telemetryEvents = []);
  views.viewCard(2, 'curated', 'english', 'fact-1');
  views.viewCard(2, 'curated', 'english', 'fact-1');
  views.viewCard(3, 'generated', 'english');
  assert.equal(events.length, 2);
  assert.equal(events[1].props.source, 'generated');
});
test('image-compatible download helper records resume and exactly one verified completion', () => {
  const events: any[] = ((globalThis as any).__telemetryEvents = []);
  const attempt = download.beginDownload('images-v1.zip', 'images', 10000, 2000, 2);
  attempt.installed(10000);
  attempt.installed(10000);
  attempt.failed(Error('late callback'));
  assert.deepEqual(
    events.map((e) => e.name),
    ['download_started', 'download_resumed', 'download_installed']
  );
  assert.equal(new Set(events.map((e) => e.props.attempt_id)).size, 1);
  assert.equal(events[2].props.bytes, 10000);
});
