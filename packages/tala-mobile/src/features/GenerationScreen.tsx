import React, { useEffect, useState } from 'react';
import { ScrollView, View, Alert } from 'react-native';
import { GenerationInput, BUILTIN_TEMPLATES } from '@hiraia/tala-core/contracts';
import type { GenerationAllowance, GenerationJob, Plan } from '@hiraia/tala-core/contracts';
import type { z } from 'zod';
import { Body, Button, Field, Title, styles } from '../ui/components';
import { ContentEditor } from '../ui/ContentEditor';
import { buildPrefilledDraft } from '@hiraia/tala-core/generation';
import type { DurableTask } from './tasks';
import type { GenerationRequest } from './generation';
import { Feedback, useAction, type FeatureProps } from './ui';
export function GenerationScreen(props: FeatureProps & { plan: Plan }) {
  const { rt, t, plan, online, canWrite } = props,
    action = useAction(t);
  const [guidance, setGuidance] = useState(''),
    [objectives, setObjectives] = useState(plan.customObjectives.join('\n')),
    [minutes, setMinutes] = useState(String(plan.durationMinutes)),
    [materials, setMaterials] = useState(''),
    [sectionKey, setSectionKey] = useState<string | null>(null),
    [task, setTask] = useState<DurableTask<GenerationRequest> | null>(null),
    [allowance, setAllowance] = useState<z.infer<typeof GenerationAllowance> | null>(null),
    [counts, setCounts] = useState<Record<string, string>>({});
  const template = BUILTIN_TEMPLATES.find((x) => x.id === plan.templateId);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const all = await rt.features.tasks.list();
      if (alive)
        setTask(
          (all
            .filter(
              (v) => v.kind === 'generation' && (v.input as GenerationRequest).planId === plan.id
            )
            .at(-1) as DurableTask<GenerationRequest>) ?? null
        );
    };
    void refresh();
    const off = rt.features.tasks.subscribe(() => void refresh());
    void rt.engine.list('class').then((rows) => {
      const cls = rows.find((c) => plan.placements.some((p) => p.classId === c.id));
      if (cls && alive) {
        setMaterials(cls.data.profile.materials.join('\n'));
        setCounts(
          Object.fromEntries(
            cls.data.gradeGroups.map((g) => [
              g.id,
              g.learnerCount === null ? '' : String(g.learnerCount),
            ])
          )
        );
      }
    });
    if (online)
      void rt.client
        .call('generation.allowance')
        .then((v) => {
          if (alive) setAllowance(v);
        })
        .catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, [rt, plan.id, online]);
  const job = task?.result as GenerationJob | undefined;
  async function request() {
    const cls = (await rt.engine.list('class')).find((c) =>
      plan.placements.some((p) => p.classId === c.id)
    )?.data;
    if (!cls) throw Error('Class missing');
    const pk = await rt.store.getMeta('packs');
    const lookup: Record<string, string[]> = {};
    for (const id of JSON.parse(pk ?? '[]') as string[]) {
      const pack = JSON.parse((await rt.store.getMeta(`pack.${id}`)) ?? 'null');
      for (const [group, ids] of Object.entries(plan.competencies)) {
        lookup[group] ??= [];
        lookup[group]!.push(
          ...(pack?.competencies ?? [])
            .filter((c: { id: string }) => ids.includes(c.id))
            .map((c: { text: string }) => c.text)
        );
      }
    }
    const budget = Number(minutes);
    const input = GenerationInput.parse({
      kind: sectionKey ? 'section' : 'full',
      sectionKey: sectionKey ?? undefined,
      planId: plan.id,
      templateId: plan.templateId,
      language: plan.language,
      subjectName: plan.subjectName,
      learningAreaId: plan.learningAreaId,
      timeBudgetMinutes: budget,
      sessions: template?.span === 'week' ? 5 : 1,
      gradeGroups: cls.gradeGroups.map((g) => ({
        ...g,
        learnerCount: counts[g.id]?.trim() ? Number(counts[g.id]) : null,
      })),
      competencies: plan.competencies,
      curriculumVersion: plan.curriculumVersion,
      customObjectives: objectives.split('\n').filter(Boolean),
      classProfile: { ...cls.profile, materials: materials.split('\n').filter(Boolean) },
      guidance,
    });
    await rt.features.generation.request(plan.id, input, lookup);
    void rt.features.tick(online);
  }
  function apply(mode: 'result' | 'fallback') {
    Alert.alert(t('replaceSections'), t('previousTextKept'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('confirm'),
        onPress: () =>
          void action.run(async () => {
            await rt.features.generation.apply(task!.id, mode, true);
            const p = await rt.engine.get('plan', plan.id);
            if (p) props.onOpen(p.data);
          }),
      },
    ]);
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pad}>
      <Title>{t('generateLesson')}</Title>
      <Body>{t('generationPrivacy')}</Body>
      <Body>
        {plan.subjectName} · {plan.grades.join(', ')}
      </Body>
      <Body>{t('checkBeforeUse')}</Body>
      {allowance && (
        <Body>
          {t('allowance')}: {allowance.fullRemainingToday} / {allowance.sectionRemainingToday}
        </Body>
      )}
      <Feedback {...action} t={t} />
      <Field label={t('minutes')} value={minutes} onChange={setMinutes} />
      <Field label={t('customObjectives')} multiline value={objectives} onChange={setObjectives} />
      <Field label={t('materials')} multiline value={materials} onChange={setMaterials} />
      <Field label={t('guidance')} multiline value={guidance} onChange={setGuidance} />
      {Object.entries(counts).map(([id, count], index) => (
        <Field
          key={id}
          label={`${t('learnerCount')} ${plan.grades[index] ?? ''}`}
          value={count}
          onChange={(value) => setCounts((old) => ({ ...old, [id]: value }))}
        />
      ))}
      <Button
        label={
          sectionKey
            ? `${t('regenerateSection')}: ${t(sectionKey as never) ?? sectionKey}`
            : t('wholeLesson')
        }
        onPress={() => {
          const keys = [null, ...(template?.sections.map((s) => s.key) ?? [])];
          setSectionKey(keys[(keys.indexOf(sectionKey) + 1) % keys.length]!);
        }}
      />
      {(!task || ['failed', 'cancelled', 'done'].includes(task.state)) && (
        <Button
          primary
          label={t(online ? 'generateLesson' : 'queueGeneration')}
          disabled={!canWrite || action.busy}
          onPress={() => void action.run(request)}
        />
      )}
      {task && (
        <View style={styles.card}>
          <Body>{t(`task_${task.state}` as never)}</Body>
          {task.state === 'uncertain' && <Body>{t('generationUncertain')}</Body>}
          {job?.failure && <Body>{t('generationUnavailable')}</Body>}
          {job?.result && (
            <>
              <Body>{t('aiDraft')}</Body>
              <Body>{t('checkBeforeUse')}</Body>
              {job.result.sections.map((s) => (
                <View key={s.key}>
                  <Title>{t(s.key as never) ?? s.key}</Title>
                  <ContentEditor value={s.content} onChange={() => {}} editable={false} t={t} />
                </View>
              ))}
            </>
          )}
          {task.state === 'ready' && (
            <Button
              primary
              disabled={!canWrite || action.busy}
              label={t('useGeneratedDraft')}
              onPress={() => apply('result')}
            />
          )}
          <Button
            disabled={!canWrite || action.busy}
            primary={task.state === 'failed' || task.state === 'uncertain'}
            label={t('usePrefilledTemplate')}
            onPress={() => apply('fallback')}
          />
          {!['done', 'cancelled'].includes(task.state) && (
            <Button
              label={t('cancel')}
              onPress={() =>
                void action.run(async () => {
                  await rt.features.generation.cancel(task.id);
                  void rt.features.tick(online);
                })
              }
            />
          )}
          <Button label={t('continueBackground')} onPress={props.onBack} />
        </View>
      )}
    </ScrollView>
  );
}
