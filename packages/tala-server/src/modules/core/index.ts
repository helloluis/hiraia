/**
 * Module: core — auth, account, config, sync, plan revisions; provides services.records, mailer, rateLimit.
 * OWNER: workstream A.
 */
import { API } from '@hiraia/tala-core';
import type { ClientConfig } from '@hiraia/tala-core';
import type { ExtendedModule } from '../../kernel/auth';
import type { Handler } from '../../kernel/types';
import * as auth from './auth-handlers';
import * as data from './data-handlers';
import { googleSignIn, pendingHandlers } from './google-handlers';
import { coreMigrations } from './migrations';
import { coreState, initCoreState } from './state';
import type { CoreOptions } from './state';

export type { CoreOptions } from './state';

const HOUR_MS = 60 * 60 * 1000;

const configGet: Handler<'config.get'> = (ctx): ClientConfig => {
  const c = ctx.config;
  return {
    environment: c.environment,
    features: { ...c.features },
    // After environment rules: the gateway never reports "cloud" for roster names in production (§12.4.1).
    rosterLlmRoute: ctx.services.llm.routeFor('roster.names'),
    limits: { ...c.limits },
    offline: { ...c.offline },
    resilience: { ...c.resilience },
    pacingDefaults: { ...c.pacingDefaults },
    moderationGuidelineVersion: c.moderation.guidelineVersion,
    minClientVersion: c.minClientVersion,
  };
};

/** Build a core module. Tests pass options (cheap password hashing, a mail transport); the registry uses the defaults. */
export function createCoreModule(options: CoreOptions = {}): ExtendedModule {
  // Handlers written ahead of the contract (pending-routes.ts) switch themselves on when a route with the
  // same name appears in the API table. Tests switch them on with `pendingRoutes`.
  const pending = Object.fromEntries(Object.entries(pendingHandlers()).filter(([name]) => options.pendingRoutes || name in API));
  return {
    name: 'core',
    migrations: coreMigrations,
    handlers: {
      ...(pending as ExtendedModule['handlers']),
      'config.get': configGet,
      'auth.register': auth.register,
      'auth.login': auth.login,
      'auth.logout': auth.logout,
      'auth.logoutAll': auth.logoutAll,
      'auth.me': auth.me,
      'auth.sessions': auth.sessions,
      'auth.revokeSession': auth.revokeSession,
      'auth.sendVerification': auth.sendVerification,
      'auth.verifyEmail': auth.verifyEmail,
      'auth.requestReset': auth.requestReset,
      'auth.reset': auth.reset,
      'auth.changePassword': auth.changePassword,
      'auth.google': googleSignIn,
      'account.export': data.accountExport,
      'account.delete': data.accountDelete,
      'sync.push': data.push,
      'sync.pull': data.pull,
      'plans.revisions': data.planRevisions,
      'plans.revision': data.planRevision,
    },
    services(base) {
      const state = initCoreState(base, options);
      return { records: state.records.service, mailer: state.mailer, rateLimit: state.limiter };
    },
    start(deps) {
      const state = coreState(deps.db);
      if (deps.config.features.googleSignIn && state.googleClientIds.length === 0) {
        deps.log.warn('google_sign_in_not_configured', { variable: 'GOOGLE_OAUTH_CLIENT_ID' });
      }
      const tidy = () => {
        try {
          state.accounts.prune();
          state.limiter.prune();
          state.throttle.prune();
          state.records.prune();
        } catch {
          deps.log.error('core_prune_failed');
        }
      };
      const timer = setInterval(tidy, HOUR_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
    kernel: {
      authenticator: (deps) => {
        const { accounts } = coreState(deps.db);
        return { authenticate: (token) => accounts.authenticate(token) };
      },
    },
  };
}

export const coreModule = createCoreModule();
