import { useCameraPermissions, CameraView } from 'expo-camera';
import { useRef, useSyncExternalStore, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Language } from '@hiraia/shared';
import { useProfiles } from '../profiles';
import { talaCopy } from './copy';
import { formatCode } from './manual';
import {
  enrollCode,
  enrollQr,
  fixTalaConnectivity,
  leaveClass,
  subscribeTalaUi,
  syncNow,
  talaSnapshot,
} from './nearby';

export function TalaSettings({ language }: { language: Language }) {
  const t = talaCopy(language);
  const ui = useSyncExternalStore(subscribeTalaUi, talaSnapshot, talaSnapshot);
  const profiles = useProfiles();
  // Everything below acts on the student on screen; siblings keep their own classes.
  const student = profiles.profiles.find((p) => p.id === profiles.activeId)?.name ?? t.guest;
  const [scan, setScan] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const scanned = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const needsConnectivityAction =
    ui.detail === 'bluetooth-off' || ui.detail === 'wifi-off' || ui.detail === 'radios-off';
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
                  : ui.detail === 'bluetooth-off'
                    ? t.bluetoothOff
                    : ui.detail === 'wifi-off'
                      ? t.wifiOff
                      : ui.detail === 'radios-off'
                        ? t.radiosOff
                        : ui.detail === 'bluetooth-unavailable'
                          ? t.bluetoothUnavailable
                          : ui.detail === 'wifi-unavailable'
                            ? t.wifiUnavailable
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

  // The section names itself: JOIN A CLASS before enrolment, the class's own name after.
  // Every class now HAS a name — the teacher app generates a colour-animal one when none is
  // typed — so the `yourClass` fallback only fires for a teacher build that predates the
  // field. It stays as a guard: better a generic heading than the opaque class_id.
  const heading = ui.bound ? ui.className || t.yourClass : t.sectionJoin;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading} accessibilityRole="header" numberOfLines={2}>
        {heading}
      </Text>
      <Text style={styles.student} numberOfLines={1}>
        {`${t.student}: ${student}`}
      </Text>
      {!ui.bound && ui.rejoin ? <Text style={styles.notice}>{t.rejoin}</Text> : null}
      {!ui.bound ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.scanQr}
            style={styles.primaryAction}
            onPress={openScanner}
          >
            <CameraIcon />
            <Text style={styles.primaryActionText}>{t.scanQr}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() => {
              setCode('');
              setCodeOpen(true);
            }}
          >
            <Text style={styles.secondaryText}>{t.enterTheCode}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.sync}
            style={styles.primaryAction}
            onPress={() => void syncNow()}
          >
            <SyncIcon />
            <Text style={styles.primaryActionText}>{t.sync}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.secondary}
            onPress={() =>
              Alert.alert(t.leave, t.leaveConfirm(student), [
                { text: t.cancel, style: 'cancel' },
                { text: t.leaveBtn, style: 'destructive', onPress: () => void leaveClass() },
              ])
            }
          >
            <Text style={styles.secondaryText}>{t.leaveClass}</Text>
          </Pressable>
        </>
      )}
      <Text style={styles.body}>{ui.bound ? t.leaveBody : t.joinBody}</Text>
      <Text style={styles.status}>{status}</Text>
      {needsConnectivityAction ? (
        <Pressable
          accessibilityRole="button"
          style={styles.secondary}
          onPress={() => fixTalaConnectivity()}
        >
          <Text style={styles.secondaryText}>
            {ui.detail === 'wifi-off' ? t.openWifiSettings : t.turnOnBluetooth}
          </Text>
        </Pressable>
      ) : null}
      <Modal visible={scan} animationType="slide" onRequestClose={() => setScan(false)}>
        <View style={styles.scan}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current) return;
              scanned.current = true;
              setScan(false);
              void enrollQr(
                data,
                () =>
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
              void enrollCode(
                typed,
                () =>
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

function CameraIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      <Path
        d="M4 7.5h3l1.4-2h7.2l1.4 2h3A1.5 1.5 0 0 1 21.5 9v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"
        stroke="#f4efe4"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M15.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
        stroke="#f4efe4"
        strokeWidth={1.8}
      />
    </Svg>
  );
}

function SyncIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      <Path
        d="M20 11a8 8 0 0 0-14-4.9L4 8"
        stroke="#f4efe4"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 4v4h4M4 13a8 8 0 0 0 14 4.9l2-1.9M20 20v-4h-4"
        stroke="#f4efe4"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // A rule along the top separates this from Wika and Baitang above it: classroom enrolment
  // shares data off the device, so it should not read as one more preference in the same list.
  section: {
    marginTop: 20,
    marginBottom: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#cfc7b6',
    gap: 8,
  },
  sectionHeading: {
    color: '#20342c',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  student: { color: '#58635c', fontSize: 13 },
  notice: { color: '#20342c', fontSize: 13, lineHeight: 18, fontWeight: '600' },
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
  primaryAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#20342c',
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderRadius: 9,
    alignSelf: 'flex-start',
  },
  primaryActionText: { color: '#f4efe4', fontWeight: '700', fontSize: 16 },
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
