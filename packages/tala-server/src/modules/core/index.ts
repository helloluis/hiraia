/**
 * Module: core — auth, account, config, sync, plan revisions; provides services.records, mailer, rateLimit.
 * OWNER: workstream A.
 */
import type { ClientConfig } from '@hiraia/tala-core';
import type { ExtendedModule } from '../../kernel/auth';
import { HttpError } from '../../kernel/types';
import type { Handler } from '../../kernel/types';
import * as auth from './auth-handlers';
import * as data from './data-handlers';
import * as google from './google-handlers';
import { coreMigrations } from './migrations';
import { coreState, initCoreState } from './state';
import type { CoreOptions } from './state';

export type { CoreOptions } from './state';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Liveness for the process supervisor and uptime checks: the process answers and its database can be read.
 * No auth, no write, nothing about any teacher. The kernel does not even look at a session for this route.
 */
const health: Handler<'system.health'> = (ctx) => {
  try {
    ctx.db.prepare('SELECT 1').get();
  } catch {
    throw new HttpError('unavailable', 'The service is not ready. Please try again in a moment.', {
      reason: 'database_unavailable',
    });
  }
  return {
    ok: true as const,
    version: coreState(ctx).version,
    environment: ctx.config.environment,
    time: ctx.now().toISOString(),
  };
};

const configGet: Handler<'config.get'> = (ctx): ClientConfig => {
  const c = ctx.config;
  const { mailMode } = coreState(ctx);
  return {
    environment: c.environment,
    // emailDelivery false = this server cannot send mail: clients hide "verify your email" and say plainly
    // that password reset by email is not available yet.
    features: { ...c.features, emailDelivery: mailMode === 'transport' || mailMode === 'outbox' },
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
  return {
    name: 'core',
    migrations: coreMigrations,
    handlers: {
      'system.health': health,
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
      'auth.google': google.googleSignIn,
      'auth.googleLink': google.googleLink,
      'auth.googleLinkRequest': google.googleLinkRequest,
      'auth.googleLinkConfirm': google.googleLinkConfirm,
      'auth.googleConnect': google.googleConnect,
      'auth.googleDisconnect': google.googleDisconnect,
      'auth.removePassword': google.removePassword,
      'account.merge': google.accountMerge,
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
      if (state.mailMode === 'off') {
        // Said once, loudly: sign-ups are trusted without proof of the mailbox while this is on.
        deps.log.warn('auth_auto_verify_on', { setting: 'TALA_AUTH_AUTO_VERIFY' });
      } else if (state.mailMode === 'unavailable') {
        deps.log.warn('mail_transport_missing', { setting: 'TALA_AUTH_AUTO_VERIFY' });
      }
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
