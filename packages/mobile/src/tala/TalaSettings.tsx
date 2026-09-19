import { useCameraPermissions, CameraView } from 'expo-camera';
import { useRef, useSyncExternalStore, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Language } from '@hiraia/shared';
import { talaCopy } from './copy';
import { formatCode } from './manual';
import {
  enrollCode,
  enrollQr,
  leaveClass,
  subscribeTalaUi,
  syncNow,
  talaSnapshot,
} from './nearby';

export function TalaSettings({ language }: { language: Language }) {
  const t = talaCopy(language);
  const ui = useSyncExternalStore(subscribeTalaUi, talaSnapshot, talaSnapshot);
  const [scan, setScan] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const scanned = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const status =
    ui.state === 'searching'
      ? t.searching
      : ui.state === 'connected'
        ? t.connected
        : ui.state === 'sending'
          ? t.sending
          : ui.state === 'synced'
            ? t.synced
            : ui.state === 'error'
              ? ui.detail === 'play-services'
                ? t.playServices
                : ui.detail === 'permission'
                  ? t.permission
                  : ui.detail === 'code'
                    ? t.codeExpired
                    : t.nearby
              : ui.bound
                ? t.idle
                : t.unbound;

  const openScanner = () => {
    const go = () => {
      scanned.current = false;
      setScan(true);
    };
    if (permission?.granted) go();
    else void requestPermission().then((p) => p.granted && go());
  };

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.body}>{t.disclose}</Text>
      <Text style={styles.status}>{status}</Text>
      {!ui.bound ? (
        <>
          <Pressable accessibilityRole="button" style={styles.button} onPress={openScanner}>
            <Text style={styles.buttonText}>{t.join}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() => {
              setCode('');
              setCodeOpen(true);
            }}
          >
            <Text style={styles.secondaryText}>{t.enterCode}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => void syncNow()}>
            <Text style={styles.buttonText}>{t.sync}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() =>
              Alert.alert(t.leave, t.leaveConfirm, [
                { text: t.cancel, style: 'cancel' },
                { text: t.leaveBtn, style: 'destructive', onPress: () => void leaveClass() },
              ])
            }
          >
            <Text style={styles.secondaryText}>{t.leave}</Text>
          </Pressable>
        </>
      )}
      <Modal visible={scan} animationType="slide" onRequestClose={() => setScan(false)}>
        <View style={styles.scan}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current) return;
              scanned.current = true;
              setScan(false);
              void enrollQr(data, () =>
                new Promise((resolve) => {
                  Alert.alert(t.join, t.rebind, [
                    { text: t.cancel, onPress: () => resolve(false) },
                    { text: t.confirm, onPress: () => resolve(true) },
                  ]);
                })
              ).catch(() => Alert.alert(t.title, t.invalid));
            }}
          />
          <Pressable style={styles.closeScan} onPress={() => setScan(false)}>
            <Text style={styles.buttonText}>{t.cancel}</Text>
          </Pressable>
        </View>
      </Modal>
      <Modal visible={codeOpen} animationType="slide" onRequestClose={() => setCodeOpen(false)}>
        <View style={styles.codeBox}>
          <Text style={styles.title}>{t.enterCode}</Text>
          <Text style={styles.body}>{t.codeHint}</Text>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={(v) => setCode(formatCode(v))}
            placeholder="XXXX-XXXX-XXXX"
            placeholderTextColor="#8a928c"
            style={styles.input}
            accessibilityLabel={t.enterCode}
          />
          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() => {
              const typed = code;
              setCodeOpen(false);
              void enrollCode(typed, () =>
                new Promise((resolve) => {
                  Alert.alert(t.join, t.rebind, [
                    { text: t.cancel, onPress: () => resolve(false) },
                    { text: t.confirm, onPress: () => resolve(true) },
                  ]);
                })
              ).catch(() => Alert.alert(t.title, t.codeInvalid));
            }}
          >
            <Text style={styles.buttonText}>{t.confirm}</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={() => setCodeOpen(false)}>
            <Text style={styles.secondaryText}>{t.cancel}</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginVertical: 16, gap: 8 },
  title: { color: '#20342c', fontWeight: '600', fontSize: 16 },
  body: { color: '#58635c', fontSize: 13, lineHeight: 18 },
  status: { color: '#20342c', fontSize: 14 },
  button: {
    backgroundColor: '#20342c',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  buttonText: { color: '#f4efe4', fontWeight: '600' },
  secondary: { paddingVertical: 8, alignSelf: 'flex-start' },
  secondaryText: { color: '#20342c', textDecorationLine: 'underline' },
  scan: { flex: 1, backgroundColor: '#000' },
  closeScan: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: '#20342c',
    padding: 12,
    borderRadius: 8,
  },
  codeBox: { flex: 1, backgroundColor: '#f4efe4', padding: 24, gap: 12, justifyContent: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#20342c',
    borderRadius: 8,
    padding: 12,
    fontSize: 20,
    letterSpacing: 2,
    color: '#20342c',
    backgroundColor: '#fff',
  },
});
