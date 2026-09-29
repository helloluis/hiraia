import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { createElement, type ReactNode } from 'react';
import { Platform, View, type NativeSyntheticEvent, type ViewProps } from 'react-native';

type ReaderInputProps = ViewProps & {
  children?: ReactNode;
  enabled?: boolean;
  blockDescendantFocus?: boolean;
  onNavigate?: (event: NativeSyntheticEvent<{ direction: number }>) => void;
};

const AndroidReaderInput = Platform.OS === 'android'
  ? requireNativeViewManager<ReaderInputProps>('HiraiaReaderInput') : null;
const inputModule = Platform.OS === 'android'
  ? requireNativeModule<{ dismissKeyboardAfterBlur: () => Promise<void> }>('HiraiaReaderInput') : null;

/** Native Tab focus can leave an Android IME open after RN has forgotten its editor. */
export function dismissKeyboardAfterBlur() {
  void inputModule?.dismissKeyboardAfterBlur().catch(error => {
    console.warn('[reader-input] Could not dismiss keyboard after blur', error);
  });
}

export function ReaderInput({ enabled = false, blockDescendantFocus = false, onNavigate, ...props }: ReaderInputProps) {
  return AndroidReaderInput
    ? createElement(AndroidReaderInput, { ...props, enabled, blockDescendantFocus, onNavigate })
    : createElement(View, props);
}
