import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Follow the system setting while a resizable window stays mounted.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled && v) setReduce(true);
      })
      .catch(() => {
        /* treat an unqueryable platform as motion-ok */
      });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      cancelled = true;
      listener.remove();
    };
  }, []);
  return reduce;
}
