import { Wordmark } from '../components/brand/Wordmark';
import { useRef, useState } from 'react';
import { reloadAppAsync } from 'expo';
import {
  Image,
  Keyboard,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useProfiles,
  selectFirstProfile,
  selectProfile,
  cancelProfileChoice,
  cleanFirstName,
} from './index';
import { drainTelemetryWrites } from '../telemetry';
import { card, fonts } from '../theme';
import { SlideCard } from '../components/onboarding/SlideCard';
import { CardPrint, IndexBand, cardFrame } from '../components/cards/CardFrame';
const CAT = require('../../assets/hiraia-profile.png');
export function ProfilePicker({
  onCancel,
  onFirstChoice,
}: {
  onCancel: () => void;
  onFirstChoice: () => Promise<void>;
}) {
  const state = useProfiles();
  // Saving the first name updates the store before onboarding is ready. Keep this
  // form's choices stable so the new name does not insert a row and move the buttons.
  const choices = useRef(state.profiles).current;
  const hadChoice = useRef(state.hasChoice).current;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restart, setRestart] = useState(false);
  const [firstChoiceSaved, setFirstChoiceSaved] = useState(false);
  const choose = async (id: string | null, firstName?: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    Keyboard.dismiss();
    try {
      if (!state.hasChoice || firstChoiceSaved) {
        if (!firstChoiceSaved) {
          await selectFirstProfile(firstName);
          setFirstChoiceSaved(true);
        }
        await onFirstChoice();
        return;
      }
      await drainTelemetryWrites();
      await selectProfile(id, firstName);
      setRestart(true);
      await drainTelemetryWrites();
      await reloadAppAsync();
    } catch {
      setError('Could not continue. Please try again.');
      setBusy(false);
    }
  };
  const button = (label: string, action: () => void, primary = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={action}
      style={[styles.button, primary && styles.primaryButton, busy && { opacity: 0.5 }]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <SlideCard>
          <View style={cardFrame.content}>
            <CardPrint keyline="sage" />
            <IndexBand
              tone="ink"
              label="WELCOME"
              stamp={<Image source={CAT} style={cardFrame.stampImage} resizeMode="contain" />}
            />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.flex}
              contentContainerStyle={styles.content}
            >
              <View style={{ alignItems: 'center' }}>
                <Wordmark size={36} />
              </View>
              <Text style={styles.title}>Who’s learning today?</Text>
              <Text style={styles.text}>
                You can use your first name to keep your activity separate on this phone. Your name
                stays on this device.
              </Text>
              <View style={{ minHeight: 32, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                {busy && !restart && (
                  <>
                    <ActivityIndicator color={card.ink} />
                    <Text style={styles.text}>Getting things ready…</Text>
                  </>
                )}
              </View>
              {firstChoiceSaved &&
                !busy &&
                !!error &&
                button('Continue setup', () => void choose(null), true)}
              {restart ? (
                <>
                  {button('Restart Hiraia', () => {
                    void reloadAppAsync().catch(() =>
                      setError('Close and reopen Hiraia to finish switching.')
                    );
                  })}
                  <Text style={styles.text}>
                    Your choice is saved. Hiraia will restart to open that profile.
                  </Text>
                </>
              ) : (
                <>
                  {choices.length > 0 && <Text style={styles.title}>Continue as</Text>}
                  {choices.map((p, i) => (
                    <View key={p.id}>
                      {button(
                        p.name +
                          (choices.filter(
                            (x) => x.name.toLocaleLowerCase() === p.name.toLocaleLowerCase()
                          ).length > 1
                            ? ` · Profile ${i + 1}`
                            : ''),
                        () => void choose(p.id)
                      )}
                    </View>
                  ))}
                  <Text style={styles.title}>New student</Text>
                  <TextInput
                    accessibilityLabel="First name (optional)"
                    placeholder="First name (optional)"
                    placeholderTextColor={card.olive}
                    value={name}
                    onChangeText={setName}
                    maxLength={40}
                    autoCapitalize="words"
                    autoCorrect={false}
                    style={styles.input}
                    editable={!busy}
                  />
                  {!!cleanFirstName(name) &&
                    button('Create my profile', () => void choose(null, name), true)}
                  {button('Skip — continue as Guest', () => void choose(null))}
                  <Text style={styles.note}>
                    Guest activity is shared by everyone who skips. To keep your own history, select
                    your saved profile next time.
                  </Text>
                  {hadChoice &&
                    button('Cancel', () => {
                      cancelProfileChoice();
                      onCancel();
                    })}
                </>
              )}
              {!!error && (
                <Text accessibilityRole="alert" style={styles.text}>
                  {error}
                </Text>
              )}
            </ScrollView>
          </View>
        </SlideCard>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: card.board, zIndex: 110 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 4, paddingTop: 18, gap: 14, paddingBottom: 20 },
  title: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 23,
    lineHeight: 29,
    color: card.ink,
    marginTop: 12,
  },
  text: { fontFamily: fonts.cardBody, fontSize: 17, color: card.ink },
  note: { fontFamily: fonts.cardBody, fontSize: 14, color: card.olive },
  button: {
    padding: 14,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 11,
    minHeight: 52,
    backgroundColor: card.peach,
  },
  primaryButton: { backgroundColor: card.gold },
  buttonText: { fontFamily: fonts.cardBodyBold, fontSize: 19, lineHeight: 24, color: card.ink },
  input: {
    padding: 14,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 11,
    fontFamily: fonts.cardBody,
    fontSize: 20,
    color: card.ink,
  },
});
