import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useScreenReader() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(value => {
      if (active) setEnabled(value);
    }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => { active = false; listener.remove(); };
  }, []);
  return enabled;
}
