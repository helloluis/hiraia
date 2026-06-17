import { useEffect, useState } from 'react';
import {
  Keyboard,
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '../theme';

/** Resting bottom padding of the input bar; the nav-bar inset is added on top of this. */
const BASE_BOTTOM_PAD = 2;

interface ChatTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder?: string;
  /** Disable input + send while the model is still loading (progress bar moving). */
  disabled?: boolean;
}

export function ChatTextInput({ value, onChangeText, onSend, placeholder, disabled = false }: ChatTextInputProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canSend = !disabled && !!value.trim();

  // Lift the input bar above the Android system navigation bar. With edge-to-edge,
  // app content draws UNDER the 3-button nav bar; insets.bottom IS that bar's height
  // (≈0 with gesture nav), so it doubles as the "is there a nav bar down there?"
  // detector. Only apply it when the keyboard is HIDDEN — once the keyboard is up it
  // covers the nav bar, and adding the inset then would leave a dead gap above the keys.
  const insets = useSafeAreaInsets();
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const bottomPad = keyboardUp ? BASE_BOTTOM_PAD : Math.max(insets.bottom, BASE_BOTTOM_PAD);

  return (
    <View style={[styles.container, { paddingBottom: bottomPad }]}>
      <View style={[styles.inputContainer, disabled && styles.inputContainerDisabled]}>
        <TouchableOpacity style={styles.attachButton} disabled={disabled}>
          <Text style={[styles.attachIcon, disabled && styles.dimmed]}>+</Text>
        </TouchableOpacity>

        <RNTextInput
          style={[styles.input, isExpanded && styles.inputExpanded]}
          value={value}
          onChangeText={(text: string) => {
            onChangeText(text);
            setIsExpanded(text.split('\n').length > 1);
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          editable={!disabled}
          multiline
          maxLength={2000}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          onPress={onSend}
          disabled={!canSend}
        >
          <Text style={[styles.sendIcon, !canSend && styles.sendIconDisabled]}>➤</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: BASE_BOTTOM_PAD, // minimal at rest; nav-bar inset added dynamically above
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  inputContainerDisabled: {
    backgroundColor: colors.bubble, // muted fill while the model loads
    opacity: 0.6,
  },
  dimmed: {
    opacity: 0.5,
  },
  attachButton: {
    padding: 8,
  },
  attachIcon: {
    fontSize: 24,
    color: colors.inkMuted,
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.ink,
    maxHeight: 120, // ~5 lines
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  inputExpanded: {
    minHeight: 60,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23, // fully round — soft, friendly CTA that fits the hand-drawn UI
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  sendButtonDisabled: {
    backgroundColor: colors.hairline,
  },
  sendIcon: {
    fontSize: 22,
    color: colors.white,
    marginLeft: 2, // optically center the triangle glyph in the circle
  },
  sendIconDisabled: {
    color: colors.inkMuted,
  },
});
