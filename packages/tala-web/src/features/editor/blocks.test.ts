import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MultigradeBlock } from '@hiraia/tala-core/contracts';
import {
  defaultTransitionMinutes,
  gradesWithContent,
  groupTint,
  removalNeedsConfirm,
} from './blocks';

const groups = [
  { id: 'g3', grade: '3' },
  { id: 'g4', grade: '4' },
  { id: 'g5', grade: '5' },
];
const block = (groupsContent: Record<string, string>): MultigradeBlock => ({
  id: 'b1',
  label: '',
  minutes: 10,
  transitionMinutes: 0,
  teacherWith: 'g3',
  pairedGroupIds: [],
  groups: Object.fromEntries(
    groups.map((g) => [
      g.id,
      {
        mode: 'independent' as const,
        activity: groupsContent[g.id]
          ? [{ t: 'p' as const, spans: [{ text: groupsContent[g.id]! }] }]
          : [],
      },
    ])
  ),
});

test('the confirmation names only the grades that actually have activities in the block', () => {
  assert.deepEqual(gradesWithContent(block({ g3: 'Ramp test', g5: 'Record results' }), groups), [
    '3',
    '5',
  ]);
  assert.deepEqual(gradesWithContent(block({ g4: '   ' }), groups), []);
});

test('an empty, unnamed block can be removed without a dialog; anything typed needs one', () => {
  assert.equal(removalNeedsConfirm(block({}), groups), false);
  assert.equal(removalNeedsConfirm({ ...block({}), label: 'Opening' }, groups), true);
  assert.equal(removalNeedsConfirm(block({ g4: 'x' }), groups), true);
});

test('new blocks take the engine default for transition minutes; tints cycle and repeat per grade', () => {
  assert.equal(defaultTransitionMinutes('all'), 0);
  assert.equal(defaultTransitionMinutes('none'), 0);
  assert.equal(defaultTransitionMinutes('g3'), 1);
  assert.equal(groupTint(0).bg, 'bg-cream');
  assert.equal(groupTint(4).bg, groupTint(0).bg);
});
