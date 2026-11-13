import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domToRichText, richTextToHtml, type MiniNode } from './richtext-dom';

const text = (s: string): MiniNode => ({
  nodeType: 3,
  nodeName: '#text',
  nodeValue: s,
  childNodes: [],
});
const el = (name: string, ...children: MiniNode[]): MiniNode => ({
  nodeType: 1,
  nodeName: name,
  nodeValue: null,
  childNodes: children,
});

test('paragraphs with bold and italic runs', () => {
  const root = el(
    'DIV',
    el(
      'P',
      text('Hello '),
      el('B', text('world')),
      text(' and '),
      el('EM', el('STRONG', text('both')))
    )
  );
  assert.deepEqual(domToRichText(root), [
    {
      t: 'p',
      spans: [
        { text: 'Hello ' },
        { text: 'world', b: true },
        { text: ' and ' },
        { text: 'both', b: true, i: true },
      ],
    },
  ]);
});

test('divs and br become separate paragraphs; empty ones are dropped', () => {
  const root = el(
    'DIV',
    el('DIV', text('One')),
    el('DIV', el('BR')),
    el('DIV', text('Two'), el('BR'), text('Three')),
    text('   ')
  );
  assert.deepEqual(domToRichText(root), [
    { t: 'p', spans: [{ text: 'One' }] },
    { t: 'p', spans: [{ text: 'Two' }] },
    { t: 'p', spans: [{ text: 'Three' }] },
  ]);
});

test('lists keep items and flatten nesting; headings and tables degrade to paragraphs', () => {
  const root = el(
    'DIV',
    el('H2', text('Title')),
    el('UL', el('LI', text('a')), el('LI', text('b'), el('UL', el('LI', text('b1'))))),
    el('OL', el('LI', el('I', text('one')))),
    el('TABLE', el('TR', el('TD', text('cell'))))
  );
  assert.deepEqual(domToRichText(root), [
    { t: 'p', spans: [{ text: 'Title' }] },
    { t: 'ul', items: [[{ text: 'a' }], [{ text: 'b' }], [{ text: 'b1' }]] },
    { t: 'ol', items: [[{ text: 'one', i: true }]] },
    { t: 'p', spans: [{ text: 'cell' }] },
  ]);
});

test('scripts and styles are dropped; nbsp and runs of spaces normalise', () => {
  const root = el('DIV', el('SCRIPT', text('alert(1)')), el('P', text('a   b')));
  assert.deepEqual(domToRichText(root), [{ t: 'p', spans: [{ text: 'a b' }] }]);
});

test('round trip through HTML is stable', () => {
  const blocks = [
    { t: 'p' as const, spans: [{ text: 'Plain ' }, { text: 'bold', b: true }] },
    { t: 'ol' as const, items: [[{ text: 'x' }], [{ text: 'y', i: true }]] },
  ];
  const html = richTextToHtml(blocks);
  assert.equal(html, '<p>Plain <strong>bold</strong></p><ol><li>x</li><li><em>y</em></li></ol>');
  assert.ok(html.includes('&lt;') === false);
  assert.equal(
    richTextToHtml([{ t: 'p', spans: [{ text: '<script>' }] }]),
    '<p>&lt;script&gt;</p>'
  );
});
