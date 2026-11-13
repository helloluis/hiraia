import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { ResponseOf } from '@hiraia/tala-core/contracts';
import type { FeatureProps } from './ui';
import type { DurableTask } from './tasks';
import type { PostTask } from './community';
import { Body, Button, Title, styles } from '../ui/components';
export function PostQueue({ rt, t, onOpen }: Pick<FeatureProps, 'rt' | 't' | 'onOpen'>) {
  const [tasks, setTasks] = useState<DurableTask<PostTask>[]>([]),
    [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const all = await rt.features.tasks.list();
      if (alive)
        setTasks(
          all
            .filter((t) => t.kind === 'post')
            .slice(-20)
            .reverse() as DurableTask<PostTask>[]
        );
    };
    void refresh();
    const off = rt.features.tasks.subscribe(() => void refresh());
    return () => {
      alive = false;
      off();
    };
  }, [rt]);
  if (!tasks.length) return null;
  return (
    <View>
      <Button
        label={`${t('postQueue')} (${tasks.filter((t) => t.state !== 'done' && t.state !== 'cancelled').length})`}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded &&
        tasks.map((task) => {
          const result = task.result as ResponseOf<'community.post'> | undefined;
          return (
            <View style={styles.card} key={task.id}>
              <Title>{task.input.body.title}</Title>
              <Body>{t(`task_${task.state}` as never)}</Body>
              {result && <Body>{t(`post_${result.artifact.status}` as never)}</Body>}
              {task.error === 'reviewPostAgain' && <Body>{t('reviewPostAgain')}</Body>}
              {result?.moderation.reasons.map((r, i) => (
                <View key={i}>
                  <Body>{t(`moderation_${r.category}` as never)}</Body>
                  <Body>{r.excerpt}</Body>
                </View>
              ))}
              <Button
                label={t('openQueuedLesson')}
                onPress={() =>
                  void rt.engine.get('plan', task.input.body.planId).then((row) => {
                    if (row) onOpen(row.data);
                  })
                }
              />
              {['queued', 'failed', 'uncertain'].includes(task.state) && (
                <Button
                  label={t('cancel')}
                  onPress={() => void rt.features.tasks.update(task.id, { state: 'cancelled' })}
                />
              )}
            </View>
          );
        })}
    </View>
  );
}
