import type { Engine } from './types';
export function createNativeEngine(): Engine {
  const unavailable = async (): Promise<never> => {
    throw Error('localAiUnsupported');
  };
  return {
    start: unavailable,
    complete: unavailable,
    cancel: async () => {},
    close: async () => {},
  };
}
