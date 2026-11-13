/**
 * Module: community — artifacts, versions, lineage, search, copy, report, LLM moderation (PRD §11).
 * OWNER: workstream G. See README.md in this folder.
 */
import type { BaseDeps, Ctx, ServerModule } from '../../kernel/types';
import { HttpError, requireUser } from '../../kernel/types';
import { copyArtifact } from './copy';
import { communityMigrations } from './migrations';
import { searchArtifacts } from './search';
import { deleteAccountData, postArtifact, recheckPending, removeArtifact, reportArtifact, requireCommunity } from './service';
import type { CommunityDeps } from './service';
import { getArtifact, getVersion, toDetail } from './store';

export interface CommunityModuleOptions {
  /** How often the background pass rechecks pending posts and report checks. 0 disables the timer. */
  recheckIntervalMs?: number;
}

export const DEFAULT_RECHECK_INTERVAL_MS = 5 * 60_000;

function deps(ctx: Ctx): CommunityDeps {
  requireCommunity(ctx.config);
  return { db: ctx.db, services: ctx.services, config: ctx.config, now: ctx.now, newId: ctx.newId, log: ctx.log };
}

export function createCommunityModule(options: CommunityModuleOptions = {}): ServerModule {
  const interval = options.recheckIntervalMs ?? DEFAULT_RECHECK_INTERVAL_MS;
  const onAccountDeleted = (base: BaseDeps, userId: string) => deleteAccountData(base.db, userId);
  const module: ServerModule & { kernel: { onAccountDeleted: typeof onAccountDeleted } } = {
    name: 'community',
    migrations: communityMigrations,
    onAccountDeleted,
    // The kernel currently reads the hook from `kernel` (worker A); the contract puts it on the module.
    // Both are set; the clean-up is idempotent, so running it twice is harmless.
    kernel: { onAccountDeleted },
    handlers: {
      'community.search': (ctx, { query }) => searchArtifacts(deps(ctx), requireUser(ctx).id, query),

      'community.get': (ctx, { params, query }) => {
        const d = deps(ctx);
        const user = requireUser(ctx);
        const a = getArtifact(d.db, params.artifactId);
        const mine = a?.author_id === user.id;
        if (!a || a.status === 'removed' || (a.status !== 'visible' && !mine)) {
          throw new HttpError('not_found', 'This community lesson is no longer available.', { reason: 'artifact_unavailable' });
        }
        // Older versions stay reachable (§11.2): others see allowed versions only; the author sees all.
        const v = getVersion(d.db, query.versionId ?? a.current_version_id);
        if (!v || v.artifact_id !== a.id || (v.status !== 'allowed' && !mine)) {
          throw new HttpError('not_found', 'That version of the lesson is not available.', { reason: 'version_unavailable' });
        }
        return toDetail(d.db, a, v, user.id);
      },

      'community.post': (ctx, { body }) => postArtifact(deps(ctx), requireUser(ctx), body),

      'community.copy': (ctx, { params, body }) => copyArtifact(deps(ctx), requireUser(ctx), params.artifactId, body),

      'community.remove': (ctx, { params }) => removeArtifact(deps(ctx), requireUser(ctx), params.artifactId),

      'community.report': (ctx, { params, body }) => reportArtifact(deps(ctx), requireUser(ctx), params.artifactId, body),
    },
    start: (base) => {
      if (!interval || !base.config.features.community) return () => {};
      let running = false;
      const d: CommunityDeps = { db: base.db, services: base.services, config: base.config, now: base.now, newId: base.newId, log: base.log };
      const timer = setInterval(() => {
        if (running) return;
        running = true;
        recheckPending(d)
          .then((r) => {
            if (r.versions || r.reports) base.log.info('community.recheck', { versions: r.versions, reports: r.reports });
          })
          .catch((e: unknown) => base.log.error('community.recheck_failed', { error: e instanceof Error ? e.name : 'unknown' }))
          .finally(() => {
            running = false;
          });
      }, interval);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
  return module;
}

export const communityModule: ServerModule = createCommunityModule();

export { deleteAccountData, recheckPending, staffRestore, staffTakedown } from './service';
export { runModeration } from './moderate';
