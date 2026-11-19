import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadSentence, segmentProse } from './prose';

const kinds = (s: string) => segmentProse(s).map((x) => `${x.kind}:${x.text}`);

test('whole spoken sentences are marked; the words are unchanged', () => {
  const s = "Hold up a magnet and ask: 'Have you seen one of these at home? What does it stick to?' Let 3–4 learners answer. [Expected: refrigerator door.] Write their ideas on the board.";
  const seg = segmentProse(s);
  assert.equal(seg.map((x) => x.text).join(''), s);
  assert.deepEqual(seg.map((x) => x.kind), ['text', 'say', 'text', 'aside', 'text']);
  assert.equal(seg[1]!.text, "'Have you seen one of these at home? What does it stick to?'");
});

test('quoted single words, apostrophes and possessives stay ordinary text', () => {
  assert.deepEqual(kinds("Say 'push' or 'pull' with the class."), ["text:Say 'push' or 'pull' with the class."]);
  assert.deepEqual(kinds("Write the learners' ideas on the board."), ["text:Write the learners' ideas on the board."]);
  assert.deepEqual(kinds("Ipakita 'yung magnet sa klase."), ["text:Ipakita 'yung magnet sa klase."]);
  assert.deepEqual(kinds("It doesn't stick."), ["text:It doesn't stick."]);
});

test('a possessive inside speech does not end it early', () => {
  const seg = segmentProse("Say: 'Write your seatmates' ideas down.' Then move on.");
  assert.equal(seg[1]!.kind, 'say');
  assert.equal(seg[1]!.text, "'Write your seatmates' ideas down.'");
});

test('a quoted title is never joined to a later spoken sentence', () => {
  const seg = segmentProse("Show 'Why magnets pull' and explain it. Then say: 'Now it is your turn.' Wait.");
  assert.deepEqual(seg.filter((x) => x.kind === 'say').map((x) => x.text), ["'Now it is your turn.'"]);
});

test('an unclosed quote or bracket is left alone', () => {
  assert.deepEqual(kinds("Ask: 'What is a force"), ["text:Ask: 'What is a force"]);
  assert.deepEqual(kinds('See [note'), ['text:See [note']);
});

test('lead sentence only when short', () => {
  assert.deepEqual(leadSentence('A magnetic force can act without touching. Light and sound also travel.'), {
    lead: 'A magnetic force can act without touching.',
    rest: 'Light and sound also travel.',
  });
  assert.equal(leadSentence('One sentence only.'), null);
  assert.equal(leadSentence(`${'Very long '.repeat(30)}sentence. Next one.`), null);
});
