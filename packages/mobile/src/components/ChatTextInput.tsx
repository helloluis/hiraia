import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface ChatTextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  placeholder?: string;
}

export function ChatTextInput({ value, onChangeText, onSend, placeholder }: ChatTextInputProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.attachButton}>
          <Text style={styles.attachIcon}>+</Text>
        </TouchableOpacity>

        <RNTextInput
          style={[styles.input, isExpanded && styles.inputExpanded]}
          value={value}
          onChangeText={(text: string) => {
            onChangeText(text);
            setIsExpanded(text.split('\n').length > 1);
          }}
          placeholder={placeholder}
          placeholderTextColor="#6B6B6B"
          multiline
          maxLength={2000}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.sendButton, !value.trim() && styles.sendButtonDisabled]}
          onPress={onSend}
          disabled={!value.trim()}
        >
          <Text style={[styles.sendIcon, !value.trim() && styles.sendIconDisabled]}>➤</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#ECECEC',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F7F7F8',
    borderRadius: 24,
    padding: 8,
  },
  attachButton: {
    padding: 8,
  },
  attachIcon: {
    fontSize: 24,
    color: '#6B6B6B',
  },
  input: {
    flex: 1,
    fontSize: 15,
    maxHeight: 120, // ~5 lines
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  inputExpanded: {
    minHeight: 60,
  },
  sendButton: {
    padding: 8,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendIcon: {
    fontSize: 20,
    color: '#2563EB',
  },
  sendIconDisabled: {
    color: '#6B6B6B',
  },
});
