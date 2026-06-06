import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, fonts } from '../theme';

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

  return (
    <View style={styles.container}>
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
    paddingTop: 8,
    paddingBottom: 6, // tightened from 12 — reclaim vertical space for the chat thread
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
