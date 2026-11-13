import React from 'react';
import { View, Text } from 'react-native';
import type { RichText, SectionContent } from '@hiraia/tala-core/contracts';
import { Body, Button, Field, styles } from './components';
import type { StringKey } from '../i18n/en';
export function RichEditor({
  value,
  onChange,
  editable,
  t,
}: {
  value: RichText;
  onChange: (r: RichText) => void;
  editable: boolean;
  t: (k: StringKey) => string;
}) {
  const blocks = value.length ? value : [{ t: 'p' as const, spans: [{ text: '' }] }];
  return (
    <View>
      {blocks.map((block, index) => {
        const lines = block.t === 'p' ? [block.spans] : block.items;
        const update = (line: number, span: number, text: string) => {
          const next = JSON.parse(JSON.stringify(blocks)) as RichText;
          const b = next[index]!;
          const spans = b.t === 'p' ? b.spans : b.items[line]!;
          spans[span] = { ...spans[span]!, text };
          onChange(next);
        };
        return (
          <View key={index} style={styles.card}>
            {lines.map((spans, line) =>
              editable ? (
                <View key={line}>
                  {(spans.length ? spans : [{ text: '' }]).map((span, part) => (
                    <Field
                      key={part}
                      label={`${t('section')} ${index + 1} · ${line + 1} · ${part + 1}`}
                      multiline
                      editable
                      value={span.text}
                      onChange={(text) => update(line, part, text)}
                    />
                  ))}
                </View>
              ) : (
                <Text key={line} style={styles.body}>
                  {block.t === 'ul' ? '• ' : block.t === 'ol' ? `${line + 1}. ` : ''}
                  {spans.map((span, part) => (
                    <Text
                      key={part}
                      style={{
                        fontWeight: span.b ? 'bold' : 'normal',
                        fontStyle: span.i ? 'italic' : 'normal',
                      }}
                    >
                      {span.text}
                    </Text>
                  ))}
                </Text>
              )
            )}
            {editable && (
              <View>
                <Button
                  label={t('bold')}
                  onPress={() => {
                    const next = JSON.parse(JSON.stringify(blocks)) as RichText;
                    const b = next[index]!;
                    if (b.t === 'p') b.spans = b.spans.map((s) => ({ ...s, b: !s.b }));
                    else b.items = b.items.map((ss) => ss.map((s) => ({ ...s, b: !s.b })));
                    onChange(next);
                  }}
                />
                <Button
                  label={t('italic')}
                  onPress={() => {
                    const next = JSON.parse(JSON.stringify(blocks)) as RichText;
                    const b = next[index]!;
                    if (b.t === 'p') b.spans = b.spans.map((s) => ({ ...s, i: !s.i }));
                    else b.items = b.items.map((ss) => ss.map((s) => ({ ...s, i: !s.i })));
                    onChange(next);
                  }}
                />
              </View>
            )}
          </View>
        );
      })}
      {editable && (
        <>
          <Button
            label={t('plain')}
            onPress={() => onChange([...blocks, { t: 'p', spans: [{ text: '' }] }])}
          />
          <Button
            label={t('bullet')}
            onPress={() => onChange([...blocks, { t: 'ul', items: [[{ text: '' }]] }])}
          />
        </>
      )}
    </View>
  );
}
export function ContentEditor({
  value,
  onChange,
  editable,
  t,
  labels = {},
}: {
  labels?: Record<string, string>;
  value: SectionContent;
  onChange: (v: SectionContent) => void;
  editable: boolean;
  t: (k: StringKey) => string;
}) {
  const rich = (blocks: RichText, change: (v: RichText) => void) => (
    <RichEditor value={blocks} onChange={change} editable={editable} t={t} />
  );
  switch (value.type) {
    case 'text':
      return rich(value.blocks, (blocks) => onChange({ ...value, blocks }));
    case 'list':
      return (
        <>
          {value.items.map((v, i) => (
            <Field
              key={i}
              label={`${t('section')} ${i + 1}`}
              value={v}
              editable={editable}
              onChange={(text) =>
                onChange({ ...value, items: value.items.map((old, j) => (i === j ? text : old)) })
              }
            />
          ))}
          {editable && (
            <Button
              label={t('add')}
              onPress={() => onChange({ ...value, items: [...value.items, ''] })}
            />
          )}
        </>
      );
    case 'procedure':
      return (
        <>
          {value.steps.map((step, i) => (
            <View style={styles.card} key={step.id}>
              <Field
                label={t('title')}
                value={step.title}
                editable={editable}
                onChange={(title) =>
                  onChange({
                    ...value,
                    steps: value.steps.map((s, j) => (i === j ? { ...s, title } : s)),
                  })
                }
              />
              <Field
                label={t('minutes')}
                value={String(step.minutes)}
                editable={editable}
                onChange={(v) => {
                  const minutes = Number(v);
                  if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 480)
                    onChange({
                      ...value,
                      steps: value.steps.map((s, j) => (i === j ? { ...s, minutes } : s)),
                    });
                }}
              />
              {rich(step.body, (body) =>
                onChange({
                  ...value,
                  steps: value.steps.map((s, j) => (i === j ? { ...s, body } : s)),
                })
              )}
            </View>
          ))}
        </>
      );
    case 'weekgrid':
      return (
        <>
          {value.days.map((day, i) => (
            <View style={styles.card} key={i}>
              <Body>{day.date ?? String(day.weekday)}</Body>
              {rich(day.body, (body) =>
                onChange({
                  ...value,
                  days: value.days.map((d, j) => (i === j ? { ...d, body } : d)),
                })
              )}
            </View>
          ))}
        </>
      );
    case 'pergroup':
      return (
        <>
          {Object.entries(value.groups).map(([id, blocks]) => (
            <View style={styles.card} key={id}>
              <Body>{labels[id] ?? t('group')}</Body>
              {rich(blocks, (v) => onChange({ ...value, groups: { ...value.groups, [id]: v } }))}
            </View>
          ))}
        </>
      );
    case 'multigrade':
      return (
        <>
          {value.blocks.map((block, i) => (
            <View style={styles.card} key={block.id}>
              <Body>
                {block.label} · {block.minutes} {t('minutes')}
              </Body>
              {Object.entries(block.groups).map(([id, group]) => (
                <View key={id}>
                  <Body>
                    {labels[id] ?? t('group')} · {t(group.mode)}
                  </Body>
                  {rich(group.activity, (activity) =>
                    onChange({
                      ...value,
                      blocks: value.blocks.map((b, j) =>
                        i === j
                          ? { ...b, groups: { ...b.groups, [id]: { ...group, activity } } }
                          : b
                      ),
                    })
                  )}
                </View>
              ))}
            </View>
          ))}
        </>
      );
  }
}
