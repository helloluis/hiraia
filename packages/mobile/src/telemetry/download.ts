import { errorCategory, newId, track } from './index';
/** Call only for a real transfer attempt; cache hits use asset_available instead. */
export function beginDownload(
  asset: string,
  assetKind: 'model' | 'images' | 'vectors' | 'adapter',
  expectedBytes: number,
  offset = 0,
  attempt = 1
) {
  const props = {
    asset,
    asset_kind: assetKind,
    expected_bytes: expectedBytes,
    offset,
    attempt,
    attempt_id: newId(),
  };
  const started = Date.now();
  track('download_started', props);
  if (offset > 0) track('download_resumed', props);
  let ended = false;
  return {
    installed(bytes: number) {
      if (ended) return;
      ended = true;
      track('download_installed', {
        ...props,
        bytes,
        duration_ms: Math.max(0, Date.now() - started),
      });
    },
    failed(error: unknown) {
      if (ended) return;
      ended = true;
      const category = errorCategory(error);
      track(category === 'cancelled' ? 'download_cancelled' : 'download_failed', {
        ...props,
        error: category,
        duration_ms: Math.max(0, Date.now() - started),
      });
    },
  };
}
