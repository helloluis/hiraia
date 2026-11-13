import React, { useState } from 'react';
import { View } from 'react-native';
import type { Runtime } from '../runtime/runtime';
import type { Plan } from '@hiraia/tala-core/contracts';
import type { StringKey } from '../i18n/en';
import { Body, Button, styles } from '../ui/components';
import { messageForError } from '../runtime/errors';
export interface FeatureProps {
  rt: Runtime;
  online: boolean;
  canWrite: boolean;
  language: 'fil' | 'en';
  t(key: StringKey): string;
  onOpen(plan: Plan): void;
  onBack(): void;
}
export function useAction(t: FeatureProps['t']) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    async run(fn: () => Promise<unknown>) {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (cause) {
        setError(t(messageForError(cause)));
      } finally {
        setBusy(false);
      }
    },
  };
}
export function Feedback({
  busy,
  error,
  t,
}: {
  busy: boolean;
  error: string | null;
  t: FeatureProps['t'];
}) {
  return (
    <View style={styles.row}>
      {busy && <Body>{t('workingBackground')}</Body>}
      {error && <Body>{error}</Body>}
    </View>
  );
}
