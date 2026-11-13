/**
 * Kernel default services. A module's `services()` replaces the ones it owns; these stand in when no
 * module does (for example a test server with only one module loaded).
 * OWNER: workstream A.
 */
import { HttpError } from './types';
import type {
  BaseDeps,
  CurriculumService,
  LlmGateway,
  Mailer,
  RateLimiter,
  RecordStore,
  Services,
} from './types';

/** No model module loaded: every call says so and every feature routes to 'off'. */
export const disabledLlm: LlmGateway = {
  async complete() {
    return { ok: false, reason: 'disabled', message: 'AI help is not available right now.' };
  },
  routeFor() {
    return 'off';
  },
};

/** No curriculum module loaded: nothing is known, so callers fall back to typed objectives (CUR-10). */
export const emptyCurriculum: CurriculumService = {
  getCompetencies() {
    return [];
  },
  versionFor() {
    return null;
  },
};

function missingRecords(): never {
  throw new HttpError(
    'unavailable',
    'Saving is not available right now. Please try again in a moment.',
    { reason: 'records_service_missing' }
  );
}

const noRecords: RecordStore = {
  get: missingRecords,
  list: missingRecords,
  put: missingRecords,
  remove: missingRecords,
  planSnapshot: missingRecords,
  checkTallies: missingRecords,
};

/** Fixed-window counter held in memory. The core module replaces it with a durable one. */
export function createMemoryRateLimiter(now: () => Date): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(key, limit, windowSeconds) {
      const t = now().getTime();
      const w = windows.get(key);
      if (!w || t >= w.start + windowSeconds * 1000 || t < w.start) {
        if (limit < 1) return false;
        windows.set(key, { start: t, count: 1 });
        if (windows.size > 50_000) {
          for (const [k, v] of windows) if (t >= v.start + 86_400_000) windows.delete(k);
        }
        return true;
      }
      if (w.count >= limit) return false;
      w.count += 1;
      return true;
    },
  };
}

export function createDefaultServices(base: BaseDeps): Services {
  const mailer: Mailer = {
    async send(msg) {
      // No address and no variables: they would put a person's email and a sign-in link in the log.
      base.log.warn('mail_dropped_no_mailer', { template: msg.template, lang: msg.lang });
    },
  };
  return {
    records: noRecords,
    mailer,
    rateLimit: createMemoryRateLimiter(base.now),
    llm: disabledLlm,
    curriculum: emptyCurriculum,
  };
}
