/**
 * Why a write to this device failed (pure). 27 Nov 2026: with the device's storage full the editor said "Saved" and
 * the edit was gone after a reload; now the change stays pending and the status line says why it was not saved.
 */
export type SaveError = 'storage_full' | 'write_failed';

export function saveErrorOf(err: unknown): SaveError {
  const name = (err as { name?: string } | null)?.name ?? '';
  const msg = String((err as { message?: string } | null)?.message ?? '');
  return name === 'QuotaExceededError' || /quota|storage.*full|disk.*full/i.test(msg)
    ? 'storage_full'
    : 'write_failed';
}
