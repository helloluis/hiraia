import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreparedCue, createQuizStreak, createSoundBag } from '../src/audio/quizFeedbackCore';

test('ten variations exhaust the bag and never repeat at a cycle boundary', () => {
  const next = createSoundBag(10, () => 0.5);
  const picks = Array.from({ length: 50 }, next);
  for (let i = 0; i < picks.length; i += 10) assert.equal(new Set(picks.slice(i, i + 10)).size, 10);
  for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1]);
});

test('three correct answers celebrate; wrong answers and profile changes break the streak', () => {
  const answer = createQuizStreak();
  assert.deepEqual([answer('a', true), answer('a', true), answer('a', true)], [false, false, true]);
  assert.deepEqual([answer('a', true), answer('a', true), answer('a', true)], [false, false, true]);
  answer('a', false);
  assert.equal(answer('a', true), false);
  assert.equal(answer('b', true), false);
  assert.equal(answer('b', true), false);
  assert.equal(answer('b', true), true);
});

test('a prepared cue plays synchronously once and releases once', () => {
  const events: string[] = [];
  const cue = createPreparedCue(
    {
      isLoaded: true,
      play() {
        events.push('play');
      },
      pause() {
        events.push('pause');
      },
      remove() {
        events.push('remove');
      },
    },
    () => true
  );
  events.push('burst-start');
  cue.play();
  events.push('burst-running');
  cue.play();
  cue.stop();
  cue.dispose();
  cue.dispose();
  cue.play();
  assert.deepEqual(events, ['burst-start', 'play', 'burst-running', 'pause', 'remove']);
});

test('muted, background, unloaded and disposed cues never play late', () => {
  for (const reason of ['muted', 'background', 'unloaded', 'disposed']) {
    let allowed = !['muted', 'background'].includes(reason);
    const player = {
      isLoaded: reason !== 'unloaded',
      play() {
        assert.fail(reason);
      },
      pause() {},
      remove() {},
    };
    const cue = createPreparedCue(player, () => allowed);
    if (reason === 'disposed') cue.dispose();
    cue.play();
    allowed = true;
    player.isLoaded = true;
    cue.play(); // Becoming ready later must not make the previous answer audible.
    cue.dispose();
  }
});

test('native playback failures cannot prevent quiz feedback', () => {
  const cue = createPreparedCue(
    {
      isLoaded: true,
      play() {
        throw Error('audio unavailable');
      },
      pause() {
        throw Error('released');
      },
      remove() {
        throw Error('released');
      },
    },
    () => true
  );
  assert.doesNotThrow(() => {
    cue.play();
    cue.stop();
    cue.dispose();
  });
});
