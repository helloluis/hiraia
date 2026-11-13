/**
 * Transactional email: address verification and password reset (PRD AUTH-1, AUTH-3, AUTH-7).
 * OWNER: workstream A.
 *
 * Local and staging do not send anything: the message is written to `core_mail_outbox`, and one log
 * line records that it was queued. That log line carries the template and the outbox id only. The
 * address, the link and the token never reach a log.
 *
 * Production needs a real transport (provider not chosen yet). Until one is passed in, sending fails
 * closed: nothing is stored, because the outbox would hold working sign-in links in plain text.
 *
 * Links put the token in the URL FRAGMENT (`/reset-password#token=…`). A fragment is never sent to a
 * web server, so the token cannot end up in an access log or a Referer header. The web page reads it
 * and posts it to the API.
 */
import { MAIL_LINK_PATHS } from '@hiraia/tala-core';
import type { Id, Lang } from '@hiraia/tala-core';
import type { Db } from '../../kernel/db';
import type { Logger, Mailer, TalaServerConfig } from '../../kernel/types';

export type MailTemplate = 'verify_email' | 'password_reset' | 'link_google';

export interface RenderedMail {
  to: string;
  template: MailTemplate;
  lang: Lang;
  subject: string;
  body: string;
}

/** Delivers one message. Must not log the body. */
export type MailTransport = (mail: RenderedMail) => Promise<void>;

/** Paths on the web app that receive emailed links (from the contract). The token travels in the fragment. */
const LINK_PATH: Record<MailTemplate, string> = {
  verify_email: MAIL_LINK_PATHS.verifyEmail,
  password_reset: MAIL_LINK_PATHS.resetPassword,
  link_google: MAIL_LINK_PATHS.linkGoogle,
};

export function mailLink(config: TalaServerConfig, template: MailTemplate, token: string): string {
  return `${config.publicOrigin}${LINK_PATH[template]}#token=${encodeURIComponent(token)}`;
}

type TemplateText = { subject: string; body: (v: Record<string, string>) => string };

/**
 * Filipino text here is a first draft and has NOT been reviewed by a fluent teacher (PRD §14.3 requires
 * that review before release). Keep the wording plain; no jargon.
 */
const TEMPLATES: Record<MailTemplate, Record<Lang, TemplateText>> = {
  verify_email: {
    en: {
      subject: 'Confirm your email for Tala',
      body: (v) =>
        `Hello ${v.displayName ?? ''},\n\n` +
        `Please confirm that this is your email address by opening this link:\n\n${v.link ?? ''}\n\n` +
        `The link works for 48 hours and only once. If you did not create a Tala account, you can ignore this message.\n\n` +
        `Tala, by Hiraia`,
    },
    fil: {
      subject: 'Kumpirmahin ang iyong email para sa Tala',
      body: (v) =>
        `Kumusta ${v.displayName ?? ''},\n\n` +
        `Pakikumpirma na sa iyo ang email address na ito sa pagbukas ng link na ito:\n\n${v.link ?? ''}\n\n` +
        `Gagana ang link sa loob ng 48 oras at isang beses lang. Kung hindi ikaw ang gumawa ng Tala account, huwag mo na lang pansinin ang mensaheng ito.\n\n` +
        `Tala, mula sa Hiraia`,
    },
  },
  password_reset: {
    en: {
      subject: 'Reset your Tala password',
      body: (v) =>
        `Hello ${v.displayName ?? ''},\n\n` +
        `To choose a new password, open this link:\n\n${v.link ?? ''}\n\n` +
        `The link works for 30 minutes and only once. If you did not ask for this, you can ignore this message. Your password stays the same.\n\n` +
        `Tala, by Hiraia`,
    },
    fil: {
      subject: 'Palitan ang iyong password sa Tala',
      body: (v) =>
        `Kumusta ${v.displayName ?? ''},\n\n` +
        `Para pumili ng bagong password, buksan ang link na ito:\n\n${v.link ?? ''}\n\n` +
        `Gagana ang link sa loob ng 30 minuto at isang beses lang. Kung hindi ikaw ang humiling nito, huwag mo na lang pansinin ang mensaheng ito. Hindi magbabago ang iyong password.\n\n` +
        `Tala, mula sa Hiraia`,
    },
  },
  link_google: {
    en: {
      subject: 'Connect Google to your Tala account',
      body: (v) =>
        `Hello ${v.displayName ?? ''},\n\n` +
        `Someone asked to connect the Google account ${v.googleEmail ?? ''} to your Tala account, so that you can sign in with Google. ` +
        `If this was you, open this link:\n\n${v.link ?? ''}\n\n` +
        `The link works for 30 minutes and only once. If this was not you, you can ignore this message. Nothing will change.\n\n` +
        `Tala, by Hiraia`,
    },
    fil: {
      subject: 'Ikonekta ang Google sa iyong Tala account',
      body: (v) =>
        `Kumusta ${v.displayName ?? ''},\n\n` +
        `May humiling na ikonekta ang Google account na ${v.googleEmail ?? ''} sa iyong Tala account, para makapag-sign in ka gamit ang Google. ` +
        `Kung ikaw ito, buksan ang link na ito:\n\n${v.link ?? ''}\n\n` +
        `Gagana ang link sa loob ng 30 minuto at isang beses lang. Kung hindi ikaw ito, huwag mo na lang pansinin ang mensaheng ito. Walang magbabago.\n\n` +
        `Tala, mula sa Hiraia`,
    },
  },
};

export function renderMail(msg: {
  to: string;
  template: MailTemplate;
  lang: Lang;
  vars: Record<string, string>;
}): RenderedMail {
  const text = TEMPLATES[msg.template][msg.lang];
  return {
    to: msg.to,
    template: msg.template,
    lang: msg.lang,
    subject: text.subject,
    body: text.body(msg.vars),
  };
}

export interface OutboxMail extends RenderedMail {
  id: string;
  vars: Record<string, string>;
  createdAt: string;
}

export function createMailer(deps: {
  db: Db;
  config: TalaServerConfig;
  now: () => Date;
  newId: () => Id;
  log: Logger;
  transport?: MailTransport;
}): Mailer {
  const { db, config, now, newId, log, transport } = deps;
  const insert = db.prepare(
    'INSERT INTO core_mail_outbox (id, to_email, template, lang, subject, body, vars, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  return {
    async send(msg) {
      const mail = renderMail(msg);
      if (transport) {
        await transport(mail);
        log.info('mail_sent', { template: mail.template, lang: mail.lang });
        return;
      }
      if (config.environment === 'production') {
        log.error('mail_not_sent_no_transport', { template: mail.template, lang: mail.lang });
        throw new Error('No mail transport is configured.');
      }
      const id = newId();
      insert.run(
        id,
        mail.to,
        mail.template,
        mail.lang,
        mail.subject,
        mail.body,
        JSON.stringify(msg.vars),
        now().toISOString()
      );
      log.info('mail_queued_in_outbox', { template: mail.template, lang: mail.lang, outboxId: id });
    },
  };
}

/** Read the dev outbox, newest first. For tests and the local outbox tool only. */
export function readOutbox(db: Db, limit = 50): OutboxMail[] {
  const rows = db
    .prepare('SELECT * FROM core_mail_outbox ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(limit) as Array<{
    id: string;
    to_email: string;
    template: MailTemplate;
    lang: Lang;
    subject: string;
    body: string;
    vars: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    to: r.to_email,
    template: r.template,
    lang: r.lang,
    subject: r.subject,
    body: r.body,
    vars: JSON.parse(r.vars) as Record<string, string>,
    createdAt: r.created_at,
  }));
}
