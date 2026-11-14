import React, { useEffect, useState } from 'react';
import { ScrollView, Switch } from 'react-native';
import { Body, Button, Field, Title, styles } from '../../ui/components';
import type { FeatureProps } from '../ui';
import { localAi, localAiSupported } from './runtime';
import { MODEL } from './model';
import type { Completion } from './types';
export function OnDeviceScreen({ t, onBack }: Pick<FeatureProps, 't' | 'onBack'>) {
  const rt = localAi();
  const [model, setModel] = useState(rt.model.snapshot()),
    [consent, setConsent] = useState(false),
    [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [output, setOutput] = useState(''),
    [prompt, setPrompt] = useState('Reply with one short sentence about why plants need sunlight.'),
    [result, setResult] = useState<Completion | null>(null),
    [loaded, setLoaded] = useState(rt.engine.isLoaded());
  useEffect(() => {
    const unsub = rt.model.subscribe(() => setModel(rt.model.snapshot()));
    void rt.model.init();
    return unsub;
  }, []);
  async function run(action: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      setError(message.startsWith('localAi') ? message : 'localAiFailed');
    } finally {
      setBusy(false);
      setLoaded(rt.engine.isLoaded());
    }
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pad}>
      <Title>{t('onDeviceAi')}</Title>
      <Body>{t(localAiSupported() ? 'localAiExperimental' : 'localAiUnsupported')}</Body>
      <Body>
        {MODEL.label} · {(MODEL.bytes / 1000000).toFixed(1)} MB · {MODEL.license}
      </Body>
      <Body>{MODEL.source}</Body>
      <Body>{t('localAiNoNamesSent')}</Body>
      <Body>
        {t(`localAi_${model.state}` as never)} · {Math.round(model.bytes / 1000000)} MB
      </Body>
      <Body>{t(loaded ? 'localAiLoaded' : 'localAiUnloaded')}</Body>
      {error && <Body>{t(error as never) || t('localAiFailed')}</Body>}
      <Body>{t('localAiDownloadConsent')}</Body>
      <Switch
        accessibilityLabel={t('localAiDownloadConsent')}
        value={consent}
        onValueChange={setConsent}
      />
      <Body>{t('localAiMobileConsent')}</Body>
      <Switch
        accessibilityLabel={t('localAiMobileConsent')}
        value={mobile}
        onValueChange={setMobile}
      />
      <Button
        primary
        label={t('localAiDownload')}
        disabled={!localAiSupported() || !consent || busy || model.state === 'ready'}
        onPress={() => void run(() => rt.model.download({ optIn: consent, allowMobile: mobile }))}
      />
      <Button
        label={t('localAiPause')}
        disabled={model.state !== 'downloading'}
        onPress={() => void rt.model.pause().catch(() => setError('localAiDownloadFailed'))}
      />
      <Button
        label={t('localAiStart')}
        disabled={!localAiSupported() || busy || model.state !== 'ready' || loaded}
        onPress={() => void run(() => rt.engine.start())}
      />
      <Field label={t('localAiPrompt')} value={prompt} onChange={setPrompt} multiline />
      <Button
        label={t('localAiSelfTest')}
        disabled={!localAiSupported() || busy || model.state !== 'ready'}
        onPress={() =>
          void run(async () => {
            setOutput('');
            setResult(null);
            setResult(await rt.engine.complete(prompt, (token) => setOutput((old) => old + token)));
          })
        }
      />
      <Button label={t('cancel')} disabled={!busy} onPress={() => void rt.engine.cancel()} />
      <Body>{output}</Body>
      {result && (
        <Body>
          {t('localAiStats')}: {result.tokens ?? '?'} tokens · {result.elapsedMs} ms ·{' '}
          {result.tokensPerSecond?.toFixed(2) ?? '?'} tok/s ·{' '}
          {result.peakPssBytes ? Math.round(result.peakPssBytes / 1048576) : '?'} MiB PSS (
          {t('localAiSampledPeak')})
        </Body>
      )}
      <Button
        label={t('localAiUnload')}
        disabled={busy || !loaded}
        onPress={() => void run(() => rt.engine.close())}
      />
      <Button
        label={t('localAiDelete')}
        disabled={busy}
        onPress={() =>
          void run(async () => {
            await rt.engine.close();
            await rt.model.remove();
          })
        }
      />
      <Button label={t('back')} onPress={onBack} />
    </ScrollView>
  );
}
