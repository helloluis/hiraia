import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * One cheap read of the platform's reduce-motion flag at mount. No subscription: the feed's
 * decorative motion (the cycling die/calendar button) simply picks up a changed system
 * setting on the next mount. Mirrors the hook QuestionPage keeps privately for its
 * celebration pops; exported here so the shell can share it without reaching into a page.
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
    return () => {
      cancelled = true;
    };
  }, []);
  return reduce;
}
