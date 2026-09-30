import { useEffect, useState } from 'react';
import { desktop } from '../../desktop/bridge';
export function useScreenReader() {
  const [enabled, setEnabled] = useState(() => desktop().info.screenReader);
  useEffect(() => desktop().subscribe('accessibility', setEnabled), []);
  return enabled;
}
