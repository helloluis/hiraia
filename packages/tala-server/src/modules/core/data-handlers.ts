/**
 * Sync, plan revisions, and the teacher's own data: export and account deletion (PRD §10.4–10.5, AUTH-6, PRIV-6).
 * OWNER: workstream A.
 *
 * Every handler here works only on `ctx.user.id`. There is no parameter through which another
 * teacher's id could be supplied.
 */
import { clearedSessionCookie, effectsOf, runAccountDeletedHooks } from '../../kernel/auth';
import { HttpError, requireUser } from '../../kernel/types';
import type { Handler } from '../../kernel/types';
import { tooMany } from './rate-limit';
import { coreState } from './state';

const HOUR = 3600;

export const push: Handler<'sync.push'> = (ctx, { body }) => {
  const user = requireUser(ctx);
  if (!ctx.services.rateLimit.take(`sync-push:user:${user.id}`, 300, 60)) tooMany(30);
  const results = coreState(ctx).records.applyBatch(
    {
      ownerId: user.id,
      sessionId: user.sessionId,
      deviceId: body.deviceId,
      displayName: user.displayName,
    },
    body.mutations
  );
  return { results };
};

export const pull: Handler<'sync.pull'> = (ctx, { query }) => {
  const user = requireUser(ctx);
  if (!ctx.services.rateLimit.take(`sync-pull:user:${user.id}`, 600, 60)) tooMany(30);
  return coreState(ctx).records.pull(user.id, query);
};

export const planRevisions: Handler<'plans.revisions'> = (ctx, { params }) => {
  const user = requireUser(ctx);
  return { revisions: coreState(ctx).revisions.list(user.id, params.planId) };
};

export const planRevision: Handler<'plans.revision'> = (ctx, { params }) => {
  const user = requireUser(ctx);
  const number = /^\d{1,9}$/.test(params.revision) ? Number(params.revision) : Number.NaN;
  const found = Number.isNaN(number)
    ? null
    : coreState(ctx).revisions.get(user.id, params.planId, number);
  // Another teacher's plan, a plan that never existed and a revision that never existed all look the same.
  if (!found) throw new HttpError('not_found', 'We could not find that earlier version.');
  return found;
};

export const accountExport: Handler<'account.export'> = (ctx) => {
  const user = requireUser(ctx);
  const { accounts, records } = coreState(ctx);
  const row = accounts.userById(user.id);
  if (!row) throw new HttpError('unauthenticated', 'Please sign in again.');
  if (!ctx.services.rateLimit.take(`export:user:${user.id}`, 20, HOUR)) tooMany();
  return {
    exportedAt: ctx.now().toISOString(),
    user: accounts.toUser(row),
    records: records.exportAll(user.id),
  };
};

export const accountDelete: Handler<'account.delete'> = async (ctx, { body }) => {
  const user = requireUser(ctx);
  const { accounts, hasher, records } = coreState(ctx);
  const row = accounts.userById(user.id);
  if (!row) throw new HttpError('unauthenticated', 'Please sign in again.');
  if (!ctx.services.rateLimit.take(`account-delete:user:${user.id}`, 10, HOUR)) tooMany();
  // An account with a password must give it: a borrowed, still-signed-in phone is not enough to delete everything.
  if (row.password_hash) {
    const ok =
      body.password !== undefined && (await hasher.verify(row.password_hash, body.password));
    if (!ok)
      throw new HttpError(
        'forbidden',
        'The password is not right, so the account was not deleted.',
        { reason: 'wrong_password' }
      );
  }

  const remove = ctx.db.transaction((): string[] => {
    // Other modules clear their own tables first (generation jobs, roster drafts, community posts).
    const modules = runAccountDeletedHooks(ctx.db, user.id);
    records.purgeOwner(user.id);
    accounts.deleteUser(row);
    return modules;
  });
  const cleaned = remove.immediate();
  effectsOf(ctx).cookies.push(clearedSessionCookie(ctx.config));
  ctx.log.info('account_deleted', { modules: cleaned.length });
  return { ok: true as const };
};
