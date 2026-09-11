'use client';

import { useEffect } from 'react';

/** One anonymous page-session ping per browser tab load. Geo is filled server-side. */
export function WebSessionPing() {
  useEffect(() => {
    void fetch('/api/metrics/web-session', { method: 'POST', keepalive: true }).catch(() => {
      /* analytics only */
    });
  }, []);
  return null;
}
