import React from 'react';
import { Platform, ScrollView } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { isLoaded } from 'expo-font';
import { Body, Button, Title, styles } from '../ui/components';
import { storageDiagnostics } from '../storage/native';
import { startupMeasurement } from '../runtime/diagnostics';
import type { FeatureProps } from './ui';
export function AboutScreen({ t, onBack }: Pick<FeatureProps, 't' | 'onBack'>) {
  const config = Constants.expoConfig;
  const boot = startupMeasurement();
  const cipher = storageDiagnostics();
  const fields = [
    [t('diagnosticVersion'), `${config?.version ?? '?'} (${config?.android?.versionCode ?? '?'})`],
    [t('diagnosticBuild'), config?.extra?.buildDate ?? '?'],
    [t('diagnosticId'), config?.android?.package ?? '?'],
    [t('diagnosticServer'), config?.extra?.apiBase ?? 'https://tala.hiraia.org'],
    [
      t('diagnosticDatabase'),
      cipher ? `SQLCipher ${cipher}; ${t('diagnosticKey')}` : t('diagnosticUnknown'),
    ],
    [
      t('diagnosticFonts'),
      `${isLoaded('FrauncesSemiBold') ? 'Fraunces SemiBold' : t('diagnosticFontMissing')}; ${t('diagnosticSystemFont')}`,
    ],
    [
      t('diagnosticRam'),
      Device.totalMemory
        ? `${Math.round(Device.totalMemory / 1048576)} MiB`
        : t('diagnosticUnknown'),
    ],
    [t('diagnosticAndroid'), `${Device.osVersion ?? '?'} / API ${Platform.Version}`],
    [
      t('diagnosticStartup'),
      boot
        ? `${boot.milliseconds} ms (${t(boot.native ? 'diagnosticNativeStart' : 'diagnosticJsStart')})`
        : t('diagnosticUnknown'),
    ],
    [t('diagnosticBundle'), `${config?.extra?.bundleBytes ?? 0} bytes (${t('diagnosticExport')})`],
  ];
  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Title>{t('aboutDiagnostics')}</Title>
      {fields.map(([label, value]) => (
        <Body key={label}>
          {label}: {String(value)}
        </Body>
      ))}
      <Body>{t('diagnosticStartupNote')}</Body>
      <Button label={t('back')} onPress={onBack} />
    </ScrollView>
  );
}
