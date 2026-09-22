/**
 * The parts of the read-aloud path that fail SILENTLY if they are wrong.
 *
 * A tokenizer bug does not throw — it produces audio that says the wrong thing, which
 * nobody notices until a kid hears it. So the tokenizer is checked against the real
 * vocabulary that ships in the APK, including the three MMS rules that are easy to get
 * backwards: pad is the character "a" at id 0, add_blank interleaves it everywhere, and
 * anything outside the vocabulary is dropped rather than mapped to <unk>.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { chunk, speechChunks, SPEECH_PAUSE_MS } from '../src/voice/chunk.ts';
import { normalizeForSpeech, numberToWords } from '../src/voice/normalize.ts';
import { encode, hasSpeakableText } from '../src/voice/tokenizer.ts';
import { encodeWav } from '../src/voice/wav.ts';

type Voice = { sampleRate: number; vocab: Record<string, number> };
const load = (id: string) =>
  JSON.parse(
    readFileSync(new URL(`../assets/voices/${id}/voice.json`, import.meta.url), 'utf8'),
  ) as Voice;
const voice = load('tl');
const V = voice.vocab;
const EN = load('en').vocab;

test('the shipped vocabulary still has MMS shape', () => {
  // The pad token is id 0 in every MMS language, but which LETTER holds it differs:
  // "a" in Tagalog, "k" in English. Hardcoding the letter silently interleaves a real
  // letter through every English word, so only the id may be relied on.
  assert.equal(V.a, 0, 'Tagalog pad is the letter "a", at id 0');
  assert.equal(EN.k, 0, 'English pad is the letter "k", at id 0');
  assert.notEqual(EN.a, 0, 'and "a" is an ORDINARY letter in English - the whole trap');
  for (const [id, vocab] of [['tl', V], ['en', EN]] as const) {
    assert.equal(Object.values(vocab).filter((n) => n === 0).length, 1, `${id}: id 0 unique`);
  }
  assert.ok(V[' '] !== undefined, 'space is in the vocabulary');
  assert.equal(V['.'], undefined, 'there is no punctuation in an MMS vocabulary');
  assert.equal(voice.sampleRate, 16000);
});

test('encode interleaves the pad token around every symbol', () => {
  const ids = encode('ab', V);
  assert.deepEqual(ids, [V.a, V.a, V.a, V.b, V.a], 'pad, a, pad, b, pad');
  assert.equal(encode('', V).length, 1, 'empty text is a lone pad');
  assert.equal(encode('hello', V).length, 5 * 2 + 1);
});

test('encode lowercases and drops what the model cannot say', () => {
  assert.deepEqual(encode('AB', V), encode('ab', V));
  // Punctuation is not in the vocabulary at all, so it vanishes - which is why question
  // intonation has to come from the training data, not from "?".
  assert.deepEqual(encode('bakit?', V), encode('bakit', V));
  assert.deepEqual(encode('grade 5!', V), encode('grade 5', V));
  assert.deepEqual(encode('\u65e5\u672c', V), encode('', V));
});

test('hasSpeakableText rejects text with nothing to say', () => {
  assert.equal(hasSpeakableText('   ', V), false);
  assert.equal(hasSpeakableText('.', V), false);
  assert.equal(hasSpeakableText('!?,', V), false);
  assert.equal(hasSpeakableText('oo', V), true);
});

test('numbers become words, because the voice never learned digits', () => {
  assert.equal(numberToWords(0), 'zero');
  assert.equal(numberToWords(15), 'fifteen');
  assert.equal(numberToWords(42), 'forty-two');
  assert.equal(numberToWords(100), 'one hundred');
  assert.equal(numberToWords(101), 'one hundred one');
  assert.equal(numberToWords(1250), 'one thousand two hundred fifty');
  assert.equal(numberToWords(150_000_000), 'one hundred fifty million');
});

test('normalising expands the units and symbols the vocabulary would eat', () => {
  const tl = (s: string) => normalizeForSpeech(s, 'tagalog');
  assert.equal(
    tl('Kumukulo sa 100\u00b0C (212\u00b0F).'),
    'Kumukulo sa one hundred degrees Celsius.',
    'a numbers-only aside is a gloss, not a second fact',
  );
  assert.equal(tl('May anim (6) na paa.'), 'May anim na paa.');
  assert.equal(tl('Mga 20\u201325\u00b0C.'), 'Mga twenty hanggang twenty-five degrees Celsius.');
  assert.ok(tl('Mga 78%.').endsWith('seventy-eight porsyento.'));
  assert.ok(normalizeForSpeech('About 78%.', 'english').endsWith('seventy-eight percent.'));
  assert.equal(tl('Ito ay 3.5 metro.'), 'Ito ay three punto five metro.');
  // The dash in a range must not be read as a minus sign.
  assert.ok(!tl('Mga 20\u201325.').includes('bawas'));
});

test('normalising leaves nothing a tokenizer would silently drop', () => {
  const out = normalizeForSpeech('Ang tubig ay 0\u00b0C = 32\u00b0F, o 1,000 gramo/litro.', 'tagalog');
  assert.equal(/\d/.test(out), false, `no digits survive: ${out}`);
  assert.equal(/[\u00b0%=]/.test(out), false, `no bare symbols survive: ${out}`);
});

test('chunking splits on sentences and caps the long ones', () => {
  assert.deepEqual(chunk('Isa. Dalawa! Tatlo?'), ['Isa.', 'Dalawa!', 'Tatlo?']);
  assert.deepEqual(chunk('  '), []);
  const long = `${'salita '.repeat(60).trim()}.`;
  const parts = chunk(long);
  assert.ok(parts.length > 1, 'a 400-character sentence is broken up');
  for (const p of parts) assert.ok(p.length <= 180, `chunk within cap: ${p.length}`);
  // Nothing may be lost or invented: the words must survive the split exactly.
  assert.equal(parts.join(' ').split(/\s+/).length, long.split(/\s+/).length);
});

test('punctuation creates distinct audible phrases even without spaces', () => {
  const parts = speechChunks('Una,pangalawa—paliwanag. Susunod!');
  assert.deepEqual(parts, [
    { text: 'Una,', pauseAfterMs: SPEECH_PAUSE_MS.comma },
    { text: 'pangalawa—', pauseAfterMs: SPEECH_PAUSE_MS.clause },
    { text: 'paliwanag.', pauseAfterMs: SPEECH_PAUSE_MS.sentence },
    { text: 'Susunod!', pauseAfterMs: 0 },
  ]);
  assert.deepEqual(chunk('Oo.Hindi.'), ['Oo.', 'Hindi.']);
});

test('spoken measurements retain prose pauses without breaking decimals, ranges or hyphenated words', () => {
  const text = normalizeForSpeech('May 6, pero 1,000 ang iba—mga 3.5 hanggang 20–25. Balik-aral.', 'tagalog');
  const parts = speechChunks(text);
  assert.deepEqual(parts.map((p) => p.text), [
    'May six,',
    'pero one thousand ang iba—',
    'mga three punto five hanggang twenty hanggang twenty-five.',
    'Balik-aral.',
  ]);
  assert.equal(parts[0]!.pauseAfterMs, SPEECH_PAUSE_MS.comma);
  assert.deepEqual(chunk('Dr. Reyes at J. Cruz ay narito.'), ['Dr. Reyes at J. Cruz ay narito.']);
  assert.deepEqual(chunk('It is 3.5, not 1,000.'), ['It is 3.5,', 'not 1,000.']);
});

test('closing quotes, repeated punctuation and bare dashes do not create empty voice requests', () => {
  assert.deepEqual(speechChunks('“Tama!” Susunod… Oo.'), [
    { text: '“Tama!”', pauseAfterMs: SPEECH_PAUSE_MS.sentence },
    { text: 'Susunod…', pauseAfterMs: SPEECH_PAUSE_MS.sentence },
    { text: 'Oo.', pauseAfterMs: 0 },
  ]);
  assert.deepEqual(chunk('— Una, — dalawa.'), ['Una,', 'dalawa.']);
  assert.deepEqual(speechChunks('... — , !'), []);
});

test('length-only splits preserve all words without adding punctuation pauses', () => {
  const text = `${'salita '.repeat(60).trim()}, tapos.`;
  const parts = speechChunks(text);
  assert.ok(parts[0]!.text.length <= 90);
  assert.ok(parts.every((p) => p.text.length <= 180));
  assert.equal(parts.map((p) => p.text).join(' '), text);
  assert.ok(parts.slice(0, -2).every((p) => p.pauseAfterMs === 0));
  assert.equal(parts[parts.length - 2]!.pauseAfterMs, SPEECH_PAUSE_MS.comma);
  assert.equal(parts[parts.length - 1]!.pauseAfterMs, 0);
});

test('the two shipped voices are separate vocabularies, not one shared table', () => {
  // They differ in size (44 vs 39) and in assignment, which is why voice.json carries a
  // vocabulary per voice instead of one table in the bundle.
  assert.notEqual(Object.keys(V).length, Object.keys(EN).length);
  const sameSentence = (vocab: Record<string, number>) => encode('the sun is a star', vocab);
  assert.notDeepEqual(sameSentence(V), sameSentence(EN));
});

test('the WAV header describes the samples that follow', () => {
  const bytes = encodeWav(Float32Array.from([0, 1, -1, 0.5]), 16000);
  assert.equal(bytes.length, 44 + 4 * 2);
  const v = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');
  assert.equal(v.getUint16(22, true), 1, 'mono');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(34, true), 16, 'bits per sample');
  assert.equal(v.getUint32(40, true), 8, 'data chunk size');
  assert.equal(v.getInt16(44 + 2, true), 32767, '+1.0 saturates, never wraps');
  assert.equal(v.getInt16(44 + 4, true), -32768, '-1.0 saturates, never wraps');
});

test('overshoot past 1.0 clamps instead of wrapping to noise', () => {
  const bytes = encodeWav(Float32Array.from([1.4, -1.4]), 16000);
  const v = new DataView(bytes.buffer);
  assert.equal(v.getInt16(44, true), 32767);
  assert.equal(v.getInt16(46, true), -32768);
});

test('each deliberate pause is PCM silence with the correct duration and WAV lengths', () => {
  const samples = Float32Array.from([0.25, -0.5, 1]);
  const original = encodeWav(samples, 16000);
  for (const pause of Object.values(SPEECH_PAUSE_MS)) {
    const bytes = encodeWav(samples, 16000, pause);
    const silenceSamples = Math.round(16000 * pause / 1000);
    const view = new DataView(bytes.buffer);
    assert.equal(bytes.length, original.length + silenceSamples * 2);
    assert.equal(view.getUint32(4, true), bytes.length - 8);
    assert.equal(view.getUint32(40, true), bytes.length - 44);
    assert.deepEqual(bytes.slice(44, original.length), original.slice(44), 'voice samples preserved');
    assert.ok(bytes.slice(original.length).every((byte) => byte === 0), 'silence, not a model token');
  }
});
