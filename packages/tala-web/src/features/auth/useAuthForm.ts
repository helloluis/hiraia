'use client';
import { useCallback, useRef, useState } from 'react';
import { TalaApiError } from '@hiraia/tala-core/contracts';
import { useT, type StringKey } from '@/i18n';
import { withRetry, AbortedError } from '@/data/retry';
import { errorKey } from '@/data/errors';

/** Shared submit/retry/cancel/error plumbing for the auth forms (RES-3, RES-4, RES-9). */
export function useAuthForm() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const cancel = useCallback(() => ctrl.current?.abort(), []);

  const run = useCallback(
    async (fn: (signal: AbortSignal) => Promise<void>, messages: Partial<Record<'unauthenticated' | 'conflict' | 'invalid_input' | 'rate_limited', StringKey>> = {}) => {
      setBusy(true);
      setError(null);
      const c = new AbortController();
      ctrl.current = c;
      try {
        await withRetry(() => fn(c.signal), { signal: c.signal, max: 3 });
        return true;
      } catch (err) {
        if (err instanceof AbortedError) return false;
        if (err instanceof TalaApiError) {
          const reason = (err.details as { reason?: string } | undefined)?.reason;
          const key = messages[err.code as keyof typeof messages];
          if (key && !reason) setError(t(key));
          else if (err.code === 'network' || err.code === 'timeout' || err.code === 'unavailable') setError(t('auth.failed'));
          else setError(t(errorKey(err)));
        } else setError(t('error.generic'));
        return false;
      } finally {
        setBusy(false);
        ctrl.current = null;
      }
    },
    [t],
  );

  return { busy, error, setError, run, cancel };
}

export function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
