/**
 * Tala shared contracts — primitives.
 * OWNER: orchestrator. Workers do not edit files under src/contracts/; ask for a change instead.
 */
import { z } from 'zod';

/** Client-generated identifier (UUID v4 or ULID; fixed ids such as 'profile' are also valid). Records are created offline, so ids never come from the server. */
export const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/);
export type Id = z.infer<typeof Id>;

/** Calendar date in the school's local time, `YYYY-MM-DD`. Never a timestamp. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type IsoDate = z.infer<typeof IsoDate>;

export const IsoDateTime = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Interface and content languages supported in V1.0 (PRD §14.3). */
export const Lang = z.enum(['fil', 'en']);
export type Lang = z.infer<typeof Lang>;

export const Localized = z.object({ fil: z.string(), en: z.string() });
export type Localized = z.infer<typeof Localized>;

export const GradeLevel = z.enum(['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
export type GradeLevel = z.infer<typeof GradeLevel>;

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const Weekday = z.number().int().min(1).max(7);

/** Hard product limits that are part of the contract (PRD decisions 13, §12.2). */
export const LIMITS = {
  maxGradeGroupsPerClass: 4,
  maxRosterRows: 500,
  maxRosterFileBytes: 5 * 1024 * 1024,
  pageSize: 20,
  maxCommunityResults: 200,
  maxApiResponseBytes: 100 * 1024,
} as const;

/** Uniform error body for every non-2xx API response. `message` is plain language and safe to show. */
export const ApiError = z.object({
  error: z.object({
    code: z.enum([
      'unauthenticated',
      'forbidden',
      'not_found',
      'invalid_input',
      'conflict',
      'locked',
      'rate_limited',
      'quota_exceeded',
      'unavailable',
      'not_implemented',
      'internal',
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
export type ApiErrorCode = ApiError['error']['code'];

export const Page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item).max(LIMITS.pageSize), nextCursor: z.string().nullable() });

/**
 * Boolean in a query string. `z.coerce.boolean()` treats the string 'false' as true, so never use it for queries.
 * Clients may pass a real boolean; on the wire it is 'true' / 'false' (also accepts '1' / '0').
 */
export const QueryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const Ok = z.object({ ok: z.literal(true) });
