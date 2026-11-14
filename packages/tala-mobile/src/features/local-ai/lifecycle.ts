import { MODEL } from './model';
export type ModelState = 'absent' | 'paused' | 'downloading' | 'verifying' | 'ready' | 'failed';
export type Transfer = { run(): Promise<{ status: number }>; pause(): Promise<void> };
export interface ModelFiles {
  size(partial: boolean): Promise<number>;
  sha256(partial: boolean): Promise<string>;
  install(): Promise<void>;
  remove(partial: boolean): Promise<void>;
  free(): Promise<number>;
  wifi(): Promise<boolean>;
  transfer(offset: number, progress: (bytes: number) => void, allowMobile: boolean): Transfer;
  path(): string;
}
export function modelLifecycle(files: ModelFiles) {
  let state: ModelState = 'absent',
    bytes = 0,
    error: string | null = null;
  let active: Transfer | null = null,
    busy = false,
    interrupted = false;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const fn of listeners) fn();
  };
  async function verify(partial: boolean) {
    state = 'verifying';
    publish();
    if (
      (await files.size(partial)) !== MODEL.bytes ||
      (await files.sha256(partial)) !== MODEL.sha256
    )
      throw Error('localAiChecksum');
  }
  return {
    snapshot: () => ({ state, bytes, error }),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async init() {
      if (busy) return;
      bytes = await files.size(true);
      state = (await files.size(false)) === MODEL.bytes ? 'ready' : bytes ? 'paused' : 'absent';
      publish();
    },
    async download(consent: { optIn: boolean; allowMobile: boolean }) {
      if (!consent.optIn) throw Error('localAiConsent');
      if (busy) throw Error('localAiBusy');
      if (!consent.allowMobile && !(await files.wifi())) throw Error('localAiWifi');
      busy = true;
      interrupted = false;
      error = null;
      try {
        let offset = await files.size(true);
        if (offset > MODEL.bytes) {
          await files.remove(true);
          offset = 0;
        }
        if ((await files.free()) < MODEL.bytes - offset + 50 * 1048576)
          throw Error('localAiStorage');
        if (offset < MODEL.bytes) {
          state = 'downloading';
          bytes = offset;
          publish();
          active = files.transfer(
            offset,
            (n) => {
              bytes = n;
              publish();
            },
            consent.allowMobile
          );
          const response = await active.run();
          if (interrupted) return;
          if (response.status !== (offset ? 206 : 200)) {
            await files.remove(true);
            throw Error('localAiResume');
          }
        }
        await verify(true);
        await files.install();
        state = 'ready';
        bytes = MODEL.bytes;
      } catch (cause) {
        if (interrupted) {
          state = 'paused';
        } else {
          error =
            cause instanceof Error && cause.message.startsWith('localAi')
              ? cause.message
              : 'localAiDownloadFailed';
          state = 'failed';
          if (error === 'localAiChecksum') await files.remove(true);
        }
        throw Error(error ?? 'localAiCancelled');
      } finally {
        active = null;
        busy = false;
        publish();
      }
    },
    async pause() {
      if (!active) return;
      interrupted = true;
      await active.pause();
      state = 'paused';
      publish();
    },
    async verifiedPath() {
      if (busy) throw Error('localAiBusy');
      busy = true;
      try {
        await verify(false);
        state = 'ready';
        publish();
        return files.path();
      } catch (e) {
        state = 'failed';
        error = 'localAiChecksum';
        publish();
        throw e;
      } finally {
        busy = false;
      }
    },
    async remove() {
      if (busy) throw Error('localAiBusy');
      await files.remove(true);
      await files.remove(false);
      state = 'absent';
      bytes = 0;
      error = null;
      publish();
    },
  };
}
