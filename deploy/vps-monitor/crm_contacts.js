/* Hiraia admin · CRM contact cards — browser client.
 *
 * crm_contacts.py inlines this file into /admin/crm, and crm_contacts.test.cjs evaluates the same
 * bytes in a vm sandbox: everything above `mount` is pure and DOM-free. CRM text is only ever
 * assigned with textContent, never parsed as HTML. Every time is shown in Asia/Manila.
 */
(/** @param {any} root where the client registers itself (window, or the test sandbox) */ function (root) {
  'use strict';

  /**
   * @typedef {{at: string, quality: string, basis: string, platform?: string|null, conversation_kind?: string|null}} FirstMessage
   * @typedef {{kind: string, last_seen: string|null, first_message?: FirstMessage|null}} Thread
   * @typedef {{platform: string, record: boolean, threads: Thread[]}} Channel
   * @typedef {{state: string, at: string|null, basis: string|null, source_approximate: boolean}} Activity
   * @typedef {{value: string, label: string|null, primary: boolean, source: string|null}} Point
   * @typedef {{id: number, name: string, aliases: string[], role: string|null, school: string|null,
   *   stage: string, notes: string|null, summary: string|null, next_action: string|null, dates: string[],
   *   summary_at: string|null, thread_count: number, extract_count: number, last_contact: string|null,
   *   first_seen: string|null, updated_at: string|null, activity: Activity, channels: Channel[],
   *   organization?: string|null, organization_source?: string|null, department?: string|null,
   *   department_source?: string|null, job_title?: string|null, job_title_source?: string|null,
   *   location?: string|null, location_source?: string|null, phones?: Point[], emails?: Point[],
   *   first_contact?: FirstMessage|null}} Contact
   * @typedef {{q: string, platforms: Set<string>, stages: Set<string>, sort: string}} FilterState
   */

  const TZ = 'Asia/Manila';
  const STAGES = ['intro', 'pilot', 'active', 'dormant', 'unknown'];
  /** @type {Record<string, string>} */
  const STAGE_LABELS = { intro: 'Intro', pilot: 'Pilot', active: 'Active', dormant: 'Dormant', unknown: 'Unknown' };
  /** @type {Record<string, string>} */
  const SORTS = { recent: 'Recent activity', quiet: 'Longest since contact', first: 'First contact (earliest)', name: 'Name (A–Z)' };
  /** @type {Record<string, string>} */
  const SOURCE_LABELS = { manual_note: 'manual note', google_contacts: 'Google Contacts', maintenance: 'CRM maintenance', 'mbp-harvestd': 'harvestd' };
  const KNOWN_PLATFORMS = ['messenger', 'viber', 'telegram'];
  /** @type {Record<string, string>} */
  const PLATFORM_LABELS = {
    messenger: 'Messenger', facebook: 'Facebook', viber: 'Viber', telegram: 'Telegram', whatsapp: 'WhatsApp',
    signal: 'Signal', sms: 'SMS', email: 'Email', instagram: 'Instagram', line: 'LINE', wechat: 'WeChat',
    slack: 'Slack', discord: 'Discord', phone: 'Phone',
  };
  /** @type {Record<string, string>} */
  const PLATFORM_TITLES = { messenger: 'Facebook Messenger' };
  const PLATFORM_ID = /^[a-z0-9][a-z0-9._-]{0,31}$/;
  const STALE_MS = 5 * 60 * 1000;
  /** Own keys only: a platform may legally be named e.g. "constructor". @param {object} obj @param {string} key */
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  // --------------------------------------------------------------------------------- labels
  /** @param {string} id */
  function platformLabel(id) {
    if (own(PLATFORM_LABELS, id)) return PLATFORM_LABELS[id];
    const words = String(id).split(/[._-]+/).filter(Boolean);
    return words.length ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : String(id);
  }

  /** @param {string} id */
  function platformTitle(id) { return own(PLATFORM_TITLES, id) ? PLATFORM_TITLES[id] : platformLabel(id); }

  /** @param {number} n @param {string} one @param {string} many */
  function plural(n, one, many) { return n === 1 ? one : `${n} ${many}`; }

  /** "Direct chat", "2 group chats", "Direct chat + group chat", or "No synced thread". @param {Channel} channel */
  function channelSummary(channel) {
    /** @type {Record<string, number>} */
    const kinds = { direct: 0, group: 0, conversation: 0 };
    for (const t of channel.threads || []) kinds[own(kinds, t.kind) ? t.kind : 'conversation'] += 1;
    const parts = [];
    if (kinds.direct) parts.push(plural(kinds.direct, 'direct chat', 'direct chats'));
    if (kinds.group) parts.push(plural(kinds.group, 'group chat', 'group chats'));
    if (kinds.conversation) parts.push(plural(kinds.conversation, 'conversation', 'conversations'));
    const text = parts.length ? parts.join(' + ') : 'no synced thread';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** Every channel on a card, e.g. ["Messenger · Direct chat", "Viber · Group chat"]. @param {Contact} contact */
  function channelLabels(contact) {
    return (contact.channels || []).map((ch) => `${platformLabel(ch.platform)} · ${channelSummary(ch)}`);
  }

  /** @param {Contact} contact */
  function countsText(contact) {
    const parts = [plural(contact.thread_count || 0, '1 thread', 'threads'), plural(contact.extract_count || 0, '1 extract', 'extracts')];
    const phones = (contact.phones || []).length;
    const emails = (contact.emails || []).length;
    if (phones) parts.push(plural(phones, '1 phone', 'phones'));
    if (emails) parts.push(plural(emails, '1 e-mail', 'e-mails'));
    return parts.join(' · ');
  }

  /** @param {string|null|undefined} source */
  function sourceLabel(source) { return source ? (own(SOURCE_LABELS, source) ? SOURCE_LABELS[source] : source) : ''; }

  /** "Instructional Leader · Department of Education (DepEd) · Some School", without repeats. @param {Contact} c */
  function affiliationLine(c) {
    /** @type {string[]} */
    const parts = [];
    for (const v of [c.job_title || c.role, c.organization, c.school]) {
      if (typeof v === 'string' && v.trim() && !parts.some((p) => p.toLowerCase() === v.trim().toLowerCase())) parts.push(v.trim());
    }
    return parts.join(' · ');
  }

  // ---------------------------------------------------------------------------------- search
  /** Case-, accent- and spacing-insensitive form: "Peñaflor" → "penaflor". @param {unknown} value */
  function fold(value) {
    return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** @type {WeakMap<object, string>} */
  const haystacks = new WeakMap();
  /** Searchable text; fields are joined by U+0001 so one term cannot straddle two fields. @param {Contact} c */
  function haystack(c) {
    let text = haystacks.get(c);
    if (text === undefined) {
      const first = c.first_contact && c.first_contact.at ? [formatDate(c.first_contact.at), MONTH_YEAR.format(Date.parse(c.first_contact.at))] : [];
      // E.164 digits, plus the national form of a Philippine number (+63 917… is also typed 0917…).
      const phones = (c.phones || []).flatMap((p) => [p.value, p.value.replace(/\D/g, ''), p.value.startsWith('+63') ? `0${p.value.slice(3)}` : '', p.label || '']);
      const emails = (c.emails || []).flatMap((e) => [e.value, e.label || '']);
      text = [c.name, ...(c.aliases || []), c.role, c.job_title, c.organization, c.department, c.school, c.location,
        c.notes, c.summary, c.next_action, ...(c.dates || []), ...phones, ...emails, ...first]
        .filter((v) => typeof v === 'string' && v).map(fold).join('\u0001');
      haystacks.set(c, text);
    }
    return text;
  }

  /** @param {string} query */
  function terms(query) { return fold(query || '').split(' ').filter(Boolean); }

  /** Every term must appear in some field (AND). @param {Contact} c @param {string} query */
  function matchesSearch(c, query) {
    const wanted = terms(query);
    if (!wanted.length) return true;
    const text = haystack(c);
    return wanted.every((t) => text.includes(t));
  }

  // --------------------------------------------------------------------------------- filters
  /** Platforms of every thread plus the record's own (the server lists each once). @param {Contact} c */
  function platformsOf(c) { return (c.channels || []).map((ch) => ch.platform); }

  /**
   * OR within a facet, AND across facets and search. `skip` ignores one facet (for its own counts).
   * @param {Contact} c @param {FilterState} state @param {string} [skip]
   */
  function matches(c, state, skip) {
    if (skip !== 'platform' && state.platforms.size && !platformsOf(c).some((p) => state.platforms.has(p))) return false;
    if (skip !== 'stage' && state.stages.size && !state.stages.has(c.stage)) return false;
    return matchesSearch(c, state.q);
  }

  /** @param {Contact[]} contacts @param {FilterState} state */
  function filterContacts(contacts, state) { return contacts.filter((c) => matches(c, state)); }

  /** Per-option counts given every *other* active filter. @param {Contact[]} contacts @param {FilterState} state */
  function facetCounts(contacts, state) {
    /** @type {Record<string, number>} */ const platform = Object.create(null);
    /** @type {Record<string, number>} */ const stage = Object.create(null);
    for (const c of contacts) {
      if (matches(c, state, 'platform')) for (const p of new Set(platformsOf(c))) platform[p] = (platform[p] || 0) + 1;
      if (matches(c, state, 'stage')) stage[c.stage] = (stage[c.stage] || 0) + 1;
    }
    return { platform, stage };
  }

  /** Platforms present in the data (plus any selected), Messenger/Viber/Telegram first. @param {Contact[]} contacts @param {FilterState} state */
  function platformOptions(contacts, state) {
    const all = new Set(state.platforms);
    for (const c of contacts) for (const p of platformsOf(c)) all.add(p);
    const rank = (/** @type {string} */ p) => (KNOWN_PLATFORMS.includes(p) ? KNOWN_PLATFORMS.indexOf(p) : KNOWN_PLATFORMS.length);
    return [...all].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  /** @param {FilterState} state */
  function isFiltered(state) { return Boolean(state.q.trim() || state.platforms.size || state.stages.size); }

  /** Removable pills for the active-filter row. @param {FilterState} state */
  function activeFilters(state) {
    const out = [];
    if (state.q.trim()) out.push({ type: 'q', value: state.q.trim(), label: `“${state.q.trim()}”` });
    for (const p of [...state.platforms].sort()) out.push({ type: 'platform', value: p, label: platformLabel(p) });
    for (const s of STAGES) if (state.stages.has(s)) out.push({ type: 'stage', value: s, label: STAGE_LABELS[s] });
    return out;
  }

  // ------------------------------------------------------------------------------------ sort
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  /** @param {Contact} a @param {Contact} b */
  function byName(a, b) { return collator.compare(a.name, b.name) || a.id - b.id; }
  /** @param {Contact} c */
  function timeOf(c) {
    const at = c.activity && c.activity.at ? Date.parse(c.activity.at) : NaN;
    return Number.isFinite(at) ? at : null;
  }
  /** Never-contacted records (nothing synced beyond the record) always come last. @param {Contact} c */
  function tier(c) { return c.activity && c.activity.state !== 'none' ? 0 : 1; }
  /** @param {Contact} a @param {Contact} b @param {number} direction -1 newest first, 1 oldest first */
  function byTime(a, b, direction) {
    const ta = timeOf(a); const tb = timeOf(b);
    if (ta === tb) return 0;
    if (ta === null) return 1;                       // undated after dated, in either direction
    if (tb === null) return -1;
    return direction * (ta - tb);
  }
  /** At an equal instant an exact contact time outranks an approximate one. @param {Contact} a @param {Contact} b */
  function exactFirst(a, b) {
    return (a.activity && a.activity.state === 'exact' ? 0 : 1) - (b.activity && b.activity.state === 'exact' ? 0 : 1);
  }
  /** @param {Contact} c */
  function firstTime(c) {
    const at = c.first_contact && c.first_contact.at ? Date.parse(c.first_contact.at) : NaN;
    return Number.isFinite(at) ? at : null;
  }
  /** Earliest first contact first; contacts without one (no message evidence) last, by name. @param {Contact} a @param {Contact} b */
  function byFirstContact(a, b) {
    const ta = firstTime(a); const tb = firstTime(b);
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ta - tb;
    }
    const q = (/** @type {Contact} */ c) => (c.first_contact && c.first_contact.quality === 'exact' ? 0 : 1);
    return q(a) - q(b) || byName(a, b);
  }
  /** @type {Record<string, (a: Contact, b: Contact) => number>} */
  const COMPARATORS = {
    recent: (a, b) => tier(a) - tier(b) || byTime(a, b, -1) || exactFirst(a, b) || byName(a, b),
    quiet: (a, b) => tier(a) - tier(b) || byTime(a, b, 1) || exactFirst(a, b) || byName(a, b),
    first: byFirstContact,
    name: byName,
  };
  /** @param {Contact[]} contacts @param {string} sort */
  function sortContacts(contacts, sort) { return contacts.slice().sort(own(COMPARATORS, sort) ? COMPARATORS[sort] : COMPARATORS.recent); }

  // ------------------------------------------------------------------------------ Manila time
  const PARTS = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' });
  const DATE_TIME = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const SHORT_DATE_TIME = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const DATE = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
  const SHORT_DATE = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  const CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long', year: 'numeric' });

  /** @param {number} ms */
  function manilaDay(ms) {
    /** @type {Record<string, string>} */ const p = {};
    for (const part of PARTS.formatToParts(ms)) p[part.type] = part.value;
    return { year: Number(p.year), index: Math.round(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86400000) };
  }
  /** "Nov 3, 2026, 12:07 PM". @param {string} iso */
  function formatDateTime(iso) { return DATE_TIME.format(Date.parse(iso)); }
  /** "Nov 3, 2026". @param {string} iso */
  function formatDate(iso) { return DATE.format(Date.parse(iso)); }
  /** Date (and time) without the year when it is this Manila year. @param {string} iso @param {number} nowMs @param {boolean} withTime */
  function formatShort(iso, nowMs, withTime) {
    const ms = Date.parse(iso);
    const same = manilaDay(ms).year === manilaDay(nowMs).year;
    if (withTime) return same ? SHORT_DATE_TIME.format(ms) : DATE_TIME.format(ms);
    return same ? SHORT_DATE.format(ms) : DATE.format(ms);
  }
  /** Calendar-day distance in Manila: "Today", "Yesterday", "3 days ago", … (null for a future day). @param {string} iso @param {number} nowMs */
  function relativeDay(iso, nowMs) {
    const days = manilaDay(nowMs).index - manilaDay(Date.parse(iso)).index;
    if (days < 0) return null;
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 31) return plural(Math.floor(days / 7), '1 week ago', 'weeks ago');
    if (days < 365) return plural(Math.max(1, Math.floor(days / 30.44)), '1 month ago', 'months ago');
    return plural(Math.max(1, Math.floor(days / 365.25)), 'Over a year ago', 'years ago');
  }

  /**
   * What the card's corner says about recency. Exact times show date and minute; approximate
   * ones carry "≈" and never a clock time; nothing synced says so plainly.
   * @param {Contact} c @param {number} nowMs
   */
  function activityView(c, nowMs) {
    const a = c.activity || { state: 'none', at: null, basis: null, source_approximate: false };
    if (a.state === 'exact' && a.at) {
      const rel = relativeDay(a.at, nowMs);
      return {
        tone: 'exact', approximate: false,
        primary: rel || formatShort(a.at, nowMs, false),
        secondary: rel === 'Today' ? CLOCK.format(Date.parse(a.at)) : formatShort(a.at, nowMs, true),
        title: `Last contact ${formatDateTime(a.at)} (Manila time)`,
      };
    }
    if (a.state === 'approximate') {
      const quality = a.source_approximate ? 'Time approximate' : 'Time not recorded';
      if (!a.at) return { tone: 'approximate', approximate: true, primary: quality, secondary: '', title: 'The CRM has no exact message time for this contact.' };
      return {
        tone: 'approximate', approximate: true,
        primary: `≈ ${relativeDay(a.at, nowMs) || formatShort(a.at, nowMs, false)}`,
        secondary: `${quality} · synced ${formatShort(a.at, nowMs, false)}`,
        title: `The CRM has no exact message time for this contact. ≈ is when it last received a summary: ${formatDateTime(a.at)} (Manila time).`,
      };
    }
    return { tone: 'none', approximate: false, primary: 'No contact recorded', secondary: '', title: 'No conversation with this person has been synced to the CRM.' };
  }

  /** @type {Record<string, string>} */
  const BASIS_NOTES = {
    message_timestamp: 'the message’s own timestamp',
    relative_label: 'a weekday or time label, read against when it was captured',
    first_observed: 'no timestamp in the source, so when the message was first observed (an upper bound)',
  };
  // Captures only see what was on screen, so the earliest recorded message can postdate the real first contact.
  const ON_RECORD = 'earliest message on record';
  const EARLIER = 'Earlier messages may predate the capture.';
  /** "by" for an observation-time upper bound, "≈" for any other approximate time. @param {string|null|undefined} basis */
  function approxMark(basis) { return basis === 'first_observed' ? 'by' : '≈'; }
  /**
   * "First contact": the earliest recorded message. Exact shows the date; approximate shows "≈", or "by"
   * for an observation-time upper bound, and never a clock time. No message evidence returns null.
   * @param {Contact} c
   */
  function firstContactView(c) {
    const f = c.first_contact;
    if (!f || !f.at || !Number.isFinite(Date.parse(f.at))) return null;
    const date = formatDate(f.at);
    const where = f.platform ? `${platformLabel(f.platform)}${f.conversation_kind === 'group' ? ' group' : ''}` : '';
    const basis = own(BASIS_NOTES, f.basis) ? BASIS_NOTES[f.basis] : 'an approximate time';
    if (f.quality === 'exact') {
      return { value: date, approximate: false, where, detail: `${formatDateTime(f.at)} · ${basis} · ${ON_RECORD}`,
        title: `Earliest recorded message: ${formatDateTime(f.at)} (Manila time)${where ? ` on ${where}` : ''}. ${EARLIER}` };
    }
    const value = `${approxMark(f.basis)} ${date}`;
    return { value, approximate: true, where, detail: `${value} · approximate: ${basis} · ${ON_RECORD}`,
      title: `Approximate first contact${where ? ` on ${where}` : ''}: ${basis}. ${EARLIER}` };
  }

  // ---------------------------------------------------------------------------- view states
  /** @type {Record<string, string>} */
  const ERRORS = {
    crm_not_configured: 'The CRM connection is not configured on this server yet (no read key).',
    crm_misconfigured: 'The CRM address configured on this server is not valid.',
    crm_auth_failed: 'The CRM rejected this server’s read key. Check the hiraia-admin key.',
    crm_rate_limited: 'The CRM is limiting requests right now.',
    crm_unavailable: 'The CRM API did not respond.',
    crm_bad_response: 'The CRM returned a response this page does not understand.',
    crm_outdated: 'The CRM API is older than 1.2 and cannot list contact details, first contact or conversation channels. Deploy the CRM update first.',
    network: 'Could not reach the admin server. Check your connection.',
  };
  /** @param {{code: string, retryAfter?: number|null}} error */
  function errorMessage(error) {
    const text = own(ERRORS, error.code) ? ERRORS[error.code] : 'The admin server could not load contacts.';
    return error.retryAfter ? `${text} Try again in ${error.retryAfter} s.` : text;
  }

  /**
   * Which body to show. Data, once loaded, stays visible through later refresh failures.
   * @param {{loading: boolean, error: object|null, contacts: Contact[]|null, visible: Contact[]}} s
   */
  function viewState(s) {
    if (!s.contacts) return s.error && !s.loading ? 'error' : 'loading';
    if (!s.contacts.length) return 'empty';
    return s.visible.length ? 'results' : 'no-match';
  }

  /** "48 contacts", "1 contact", "12 of 48 contacts". @param {number} shown @param {number} all */
  function resultSummary(shown, all) {
    const noun = all === 1 ? 'contact' : 'contacts';
    return shown === all ? `${all.toLocaleString('en-US')} ${noun}` : `${shown.toLocaleString('en-US')} of ${all.toLocaleString('en-US')} ${noun}`;
  }

  /** @param {FilterState} state */
  function noMatchText(state) {
    const parts = [];
    if (state.q.trim()) parts.push(`matching “${state.q.trim()}”`);
    if (state.platforms.size) parts.push(`on ${[...state.platforms].sort().map(platformLabel).join(' or ')}`);
    if (state.stages.size) parts.push(`in ${STAGES.filter((s) => state.stages.has(s)).map((s) => STAGE_LABELS[s]).join(' or ')}`);
    return `No contacts ${parts.join(' ')}.`;
  }

  // ------------------------------------------------------------------------------- URL state
  /** @param {string} search @returns {FilterState} */
  function parseState(search) {
    const p = new URLSearchParams(search || '');
    const list = (/** @type {string} */ key) => (p.get(key) || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const sort = p.get('sort') || 'recent';
    return {
      q: (p.get('q') || '').slice(0, 200),
      platforms: new Set(list('platform').filter((x) => PLATFORM_ID.test(x))),
      stages: new Set(list('stage').filter((x) => STAGES.includes(x))),
      sort: Object.prototype.hasOwnProperty.call(SORTS, sort) ? sort : 'recent',
    };
  }
  /** Defaults are omitted, so an unfiltered view has a clean URL. @param {FilterState} state */
  function serializeState(state) {
    const p = new URLSearchParams();
    if (state.q.trim()) p.set('q', state.q.trim());
    if (state.platforms.size) p.set('platform', [...state.platforms].sort().join(','));
    if (state.stages.size) p.set('stage', STAGES.filter((s) => state.stages.has(s)).join(','));
    if (state.sort !== 'recent') p.set('sort', state.sort);
    return p.toString();
  }

  // ------------------------------------------------------------------------------------- DOM
  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** Small original glyphs, tinted per platform by CSS (currentColor). @type {Record<string, string[]>} */
  const GLYPHS = {
    messenger: ['M8 1.6C4.4 1.6 1.6 4.2 1.6 7.5c0 1.8.8 3.4 2.2 4.5v2.4l2.2-1.2c.6.2 1.3.3 2 .3 3.6 0 6.4-2.6 6.4-6S11.6 1.6 8 1.6z', 'M4.4 9.4 7 6.6l1.5 1.5 3-1.6-2.6 2.8L7.4 7.8z'],
    viber: ['M8 1.5c3.6 0 6.4 2.4 6.4 5.6 0 3.2-2.8 5.6-6.4 5.6h-.6L4.6 14.6v-2.4C2.8 11.1 1.6 9.2 1.6 7.1 1.6 3.9 4.4 1.5 8 1.5z', 'M6 4.6c.3 0 .5.2.6.5l.4 1c.1.3 0 .5-.2.7l-.3.3c.3.7.9 1.3 1.6 1.6l.3-.3c.2-.2.5-.3.7-.2l1 .4c.3.1.5.3.5.6v.6c0 .4-.4.8-.8.8C7.1 10.4 5 8.3 4.8 5.6c0-.4.3-.8.8-.9z'],
    telegram: ['M14.6 2.1 1.7 7.1c-.5.2-.5.9 0 1.1l3.2 1.1 1.2 3.7c.1.4.6.5.9.2l1.8-1.6 3.1 2.3c.4.3.9.1 1-.4l2.3-10.6c.1-.5-.4-.9-.9-.7zM6.3 9.3l5.5-4.3-4.3 5-.2 1.9z'],
    other: ['M2.5 3.5h11a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H7.2L4.4 14v-2.3H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z'],
  };
  /** @param {string} platform */
  function platformClass(platform) { return KNOWN_PLATFORMS.includes(platform) ? platform : 'other'; }

  /** @param {Document} doc @param {string} platform */
  function glyph(doc, platform) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'crm-glyph');
    for (const d of GLYPHS[platformClass(platform)] || GLYPHS.other) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  /** @param {Document} doc */
  function maker(doc) {
    /** @param {string} tag @param {string|null} [cls] @param {string|null} [text] */
    return (tag, cls, text) => {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined && text !== null) node.textContent = text;
      return node;
    };
  }

  /**
   * "first message Sep 21", "first message ≈ Sep 21" or "first message by Sep 21" for one thread; '' without evidence.
   * @param {FirstMessage|null|undefined} fm @param {number} nowMs
   */
  function firstMessageText(fm, nowMs) {
    if (!fm || !fm.at || !Number.isFinite(Date.parse(fm.at))) return '';
    return `first message ${fm.quality === 'exact' ? '' : `${approxMark(fm.basis)} `}${formatShort(fm.at, nowMs, false)}`;
  }

  /** @param {Thread} t @param {number} nowMs */
  function threadWhen(t, nowMs) { return t.last_seen ? `last message ${formatShort(t.last_seen, nowMs, true)}` : 'no exact message time'; }

  /** @param {Contact} c @param {number} nowMs @param {Document} doc */
  function detailBody(c, nowMs, doc) {
    const el = maker(doc);
    const list = el('dl', 'crm-facts');
    /** @param {string} term @param {string|Node} value */
    const row = (term, value) => {
      const wrap = el('div');
      const dd = el('dd');
      dd.append(value);
      wrap.append(el('dt', null, term), dd);
      list.append(wrap);
    };
    const a = c.activity;
    if (a.state === 'exact' && a.at) {
      row('Last contact', `${formatDateTime(a.at)}${a.basis === 'thread' ? ' · from a thread newer than the contact record' : ''}`);
    } else if (a.state === 'approximate') {
      row('Last contact', a.source_approximate
        ? 'Approximate: the source had no absolute message timestamp, so the CRM stores none.'
        : 'Not recorded by the CRM.');
    } else {
      row('Last contact', 'No conversation synced.');
    }
    const first = firstContactView(c);
    row('First contact', first ? `${first.detail}${first.where ? ` · ${first.where}` : ''}` : 'Not available: no message evidence is linked to this contact.');
    if (c.summary_at) row('Latest summary', `Synced ${formatDateTime(c.summary_at)}`);
    /** @param {string|null|undefined} value @param {string|null|undefined} source */
    const sourced = (value, source) => `${value}${source ? ` · from ${sourceLabel(source)}` : ''}`;
    if (c.job_title) row('Job title', sourced(c.job_title, c.job_title_source));
    if (c.role && c.job_title && fold(c.role) !== fold(c.job_title)) row('Pipeline role', c.role);
    if (c.organization) row('Organization', sourced(c.organization, c.organization_source));
    if (c.department) row('Department', sourced(c.department, c.department_source));
    if (c.location) row('Location', sourced(c.location, c.location_source));
    for (const [term, items, scheme] of /** @type {[string, Point[], string][]} */ ([['Phone', c.phones || [], 'tel:'], ['E-mail', c.emails || [], 'mailto:']])) {
      if (!items.length) continue;
      const points = el('ul', 'crm-thread-list');
      for (const p of items) {
        const li = el('li');
        const link = el('a', 'crm-point', p.value);
        link.setAttribute('href', `${scheme}${p.value}`);
        const extra = [p.label, p.primary ? 'primary' : '', p.source ? `from ${sourceLabel(p.source)}` : ''].filter(Boolean).join(' · ');
        li.append(link, el('span', 'crm-point-meta', extra ? ` · ${extra}` : ''));
        points.append(li);
      }
      row(items.length === 1 ? term : `${term}s`, points);
    }
    const threads = el('ul', 'crm-thread-list');
    for (const ch of c.channels) {
      if (!ch.threads.length) {
        threads.append(el('li', null, `${platformTitle(ch.platform)} · contact record only, no synced thread`));
        continue;
      }
      for (const t of ch.threads) {
        const kind = t.kind === 'direct' ? 'direct chat' : t.kind === 'group' ? 'group chat' : 'conversation';
        const firstText = firstMessageText(t.first_message, nowMs);
        threads.append(el('li', null, `${platformTitle(ch.platform)} · ${kind}${firstText ? ` · ${firstText}` : ''} · ${threadWhen(t, nowMs)}`));
      }
    }
    row('Channels', c.channels.length ? threads : 'None recorded');
    if (c.dates && c.dates.length) row('Dates mentioned', c.dates.join(' · '));
    if (c.notes && c.summary && fold(c.notes) !== fold(c.summary)) row('Contact notes', el('span', 'crm-prewrap', c.notes));
    if (c.first_seen) row('First seen', formatDateTime(c.first_seen));
    row('Record', `CRM #${c.id}${c.updated_at ? ` · updated ${formatDateTime(c.updated_at)}` : ''}`);
    return list;
  }

  /** @param {Contact} c @param {number} nowMs @param {Document} doc */
  function buildCard(c, nowMs, doc) {
    const el = maker(doc);
    const card = el('article', 'crm-card');
    card.dataset.stage = c.stage;
    card.setAttribute('aria-labelledby', `crm-name-${c.id}`);

    const head = el('div', 'crm-card-head');
    const view = activityView(c, nowMs);
    const when = el('div', `crm-when crm-when-${view.tone}`);
    when.title = view.title;
    const main = el(c.activity.at ? 'time' : 'span', 'crm-when-main', view.primary);
    if (c.activity.at) main.setAttribute('datetime', c.activity.at);
    when.append(main);
    if (view.secondary) when.append(el('span', 'crm-when-sub', view.secondary));
    head.append(el('span', `crm-stage crm-stage-${c.stage}`, own(STAGE_LABELS, c.stage) ? STAGE_LABELS[c.stage] : 'Unknown'), when);

    const name = el('h2', 'crm-name', c.name);
    name.id = `crm-name-${c.id}`;
    card.append(head, name);
    if (c.aliases.length) card.append(el('p', 'crm-aka', `Also ${c.aliases.join(' · ')}`));
    const org = affiliationLine(c);
    card.append(el('p', org ? 'crm-org' : 'crm-org crm-missing', org || 'No role, organization or school recorded'));
    const first = firstContactView(c);
    if (first) {
      const line = el('p', `crm-first${first.approximate ? ' crm-first-approx' : ''}`);
      line.title = first.title;
      line.append(el('span', 'crm-first-label', 'First contact'), el('span', 'crm-first-value', first.value));
      if (first.where) line.append(el('span', 'crm-first-where', ` · ${first.where}`));
      card.append(line);
    }

    const channels = el('ul', 'crm-channels');
    channels.setAttribute('aria-label', 'Where you talk');
    for (const ch of c.channels) {
      const item = el('li', `crm-channel crm-ch-${platformClass(ch.platform)}`);
      item.title = `${platformTitle(ch.platform)}: ${channelSummary(ch).toLowerCase()}${ch.record ? ' (platform of the CRM record)' : ''}`;
      item.append(glyph(doc, ch.platform), el('strong', null, platformLabel(ch.platform)), el('span', null, channelSummary(ch)));
      channels.append(item);
    }
    if (!c.channels.length) channels.append(el('li', 'crm-channel crm-ch-other', 'No channel recorded'));
    card.append(channels);

    if (c.next_action) {
      const next = el('p', 'crm-next');
      next.append(el('span', 'crm-next-label', 'Next'), el('span', null, c.next_action));
      card.append(next);
    }
    const summary = c.summary || c.notes;
    card.append(el('p', summary ? 'crm-summary' : 'crm-summary crm-missing', summary || 'No classified summary yet.'));

    const details = /** @type {HTMLDetailsElement} */ (el('details', 'crm-details'));
    const toggle = el('summary');
    toggle.append(el('span', 'crm-counts', countsText(c)), el('span', 'crm-sr', ', '), el('span', 'crm-more', 'Details'));
    details.append(toggle, detailBody(c, nowMs, doc));
    details.addEventListener('toggle', () => card.classList.toggle('is-open', details.open));
    card.append(details);
    return card;
  }

  /** @param {Document} doc */
  function skeletons(doc) {
    const el = maker(doc);
    return Array.from({ length: 6 }, () => {
      const card = el('div', 'crm-card crm-skel');
      card.setAttribute('aria-hidden', 'true');
      for (const w of ['28%', '64%', '48%', '80%', '92%']) {
        const bar = el('span', 'crm-skel-bar');
        bar.style.width = w;
        card.append(bar);
      }
      return card;
    });
  }

  /** @param {EventTarget|null} target */
  function isTyping(target) {
    const t = /** @type {HTMLElement|null} */ (target);
    return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
  }

  /** Wire the page. Expects the markup in crm_contacts.html. @param {HTMLElement} rootEl */
  function mount(rootEl) {
    const doc = rootEl.ownerDocument;
    const win = /** @type {Window} */ (doc.defaultView);
    const el = maker(doc);
    const config = JSON.parse(rootEl.getAttribute('data-config') || '{}');
    const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
    const q = /** @type {HTMLInputElement} */ ($('crm-q'));
    const clearQ = $('crm-clear-q');
    const sortSel = /** @type {HTMLSelectElement} */ ($('crm-sort'));
    const refreshBtn = /** @type {HTMLButtonElement} */ ($('crm-refresh'));
    const platformsEl = $('crm-platforms');
    const stagesEl = $('crm-stages');
    const countEl = $('crm-count');
    const activeEl = $('crm-active');
    const resetBtn = $('crm-reset');
    const bannerEl = $('crm-banner');
    const gridEl = $('crm-grid');
    const emptyEl = $('crm-empty');
    const updatedEl = $('crm-updated');

    let state = parseState(win.location.search);
    /** @type {Contact[]|null} */ let contacts = null;
    let total = 0;
    let truncated = false;
    let fetchedAt = 0;
    /** @type {{code: string, retryAfter?: number|null}|null} */ let error = null;
    let loading = false;
    let generation = 0;
    let urlTimer = 0;
    let platformKey = '';
    /** @type {Map<number, HTMLElement>} */ let cards = new Map();

    for (const [value, label] of Object.entries(SORTS)) {
      const option = el('option', null, label);
      option.setAttribute('value', value);
      sortSel.append(option);
    }
    sortSel.value = state.sort;
    q.value = state.q;
    const narrow = win.matchMedia('(max-width: 560px)');
    const placeholder = () => { q.placeholder = narrow.matches ? 'Search contacts…' : 'Search name, school, organization, role, contact details…'; };
    placeholder();
    narrow.addEventListener('change', placeholder);

    /** @param {string} facet @param {string} value @param {string} label @param {string} [platform] */
    function chip(facet, value, label, platform) {
      const button = el('button', `crm-chip${platform ? ` crm-ch-${platformClass(platform)}` : ` crm-chip-stage crm-stage-${value}`}`);
      button.setAttribute('type', 'button');
      button.dataset.facet = facet;
      button.dataset.value = value;
      if (platform) {
        button.append(glyph(doc, platform));
        button.title = platformTitle(platform);
      }
      button.append(el('span', 'crm-chip-label', label), el('span', 'crm-chip-count', '0'));
      button.addEventListener('click', () => {
        const set = facet === 'platform' ? state.platforms : state.stages;
        if (set.has(value)) set.delete(value); else set.add(value);
        update();
      });
      return button;
    }
    for (const s of STAGES) stagesEl.append(chip('stage', s, STAGE_LABELS[s]));

    function syncChips() {
      const options = platformOptions(contacts || [], state);
      const key = `${contacts ? 'data' : loading ? 'loading' : 'none'}:${options.join(',')}`;
      if (key !== platformKey) {           // rebuild only when the option set changes (keeps focus)
        platformKey = key;
        platformsEl.replaceChildren(...(options.length ? options.map((p) => chip('platform', p, platformLabel(p), p))
          : contacts ? [] : [el('span', 'crm-facet-note', loading ? 'Loading…' : 'Unavailable')]));
        /** @type {HTMLElement} */ (platformsEl.parentElement).hidden = Boolean(contacts) && !options.length;
      }
      const counts = facetCounts(contacts || [], state);
      for (const button of /** @type {NodeListOf<HTMLElement>} */ (rootEl.querySelectorAll('.crm-chip'))) {
        const facet = button.dataset.facet || '';
        const value = button.dataset.value || '';
        const on = (facet === 'platform' ? state.platforms : state.stages).has(value);
        const n = contacts ? (facet === 'platform' ? counts.platform : counts.stage)[value] || 0 : null;
        button.setAttribute('aria-pressed', String(on));
        button.classList.toggle('is-zero', n === 0 && !on);
        const count = /** @type {HTMLElement} */ (button.querySelector('.crm-chip-count'));
        count.textContent = n === null ? '' : String(n);
        button.setAttribute('aria-label', `${button.title || (own(STAGE_LABELS, value) ? STAGE_LABELS[value] : value)}${n === null ? '' : `, ${n}`}`);
      }
    }

    function syncUrl() {
      win.clearTimeout(urlTimer);
      urlTimer = win.setTimeout(() => {
        const qs = serializeState(state);
        try { win.history.replaceState(win.history.state, '', win.location.pathname + (qs ? `?${qs}` : '')); } catch (_) { /* rate-limited by the browser; harmless */ }
      }, 250);
    }

    function renderActive() {
      const pills = activeFilters(state).map((f) => {
        const pill = el('span', 'crm-pill');
        const remove = el('button', 'crm-pill-x', '×');
        remove.setAttribute('type', 'button');
        remove.setAttribute('aria-label', `Remove filter ${f.label}`);
        remove.addEventListener('click', () => {
          if (f.type === 'q') { state.q = ''; q.value = ''; } else (f.type === 'platform' ? state.platforms : state.stages).delete(f.value);
          update();
          q.focus();
        });
        pill.append(el('span', null, f.label), remove);
        return pill;
      });
      activeEl.replaceChildren(...pills);
      resetBtn.hidden = !isFiltered(state);
      clearQ.hidden = !state.q;
    }

    function renderBanner() {
      const lines = [];
      if (error && contacts) lines.push(`Could not refresh: ${errorMessage(error)} Showing contacts loaded at ${CLOCK.format(fetchedAt)}.`);
      if (truncated && contacts) lines.push(`Loaded ${contacts.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} contacts. Refresh to load the rest.`);
      bannerEl.textContent = lines.join(' ');
      bannerEl.hidden = !lines.length;
    }

    /** @param {string} view */
    function renderEmpty(view) {
      const title = view === 'empty' ? 'No contacts yet' : view === 'no-match' ? 'No contacts match' : 'Could not load contacts';
      const text = view === 'empty'
        ? 'Contacts appear here once harvestd on your Mac syncs reviewed summaries to the CRM.'
        : view === 'no-match' ? noMatchText(state) : errorMessage(/** @type {{code: string}} */ (error));
      const children = [el('h2', null, title), el('p', null, text)];
      if (view !== 'empty') {
        const button = el('button', 'refresh', view === 'no-match' ? 'Clear filters' : 'Try again');
        button.setAttribute('type', 'button');
        button.addEventListener('click', view === 'no-match' ? reset : () => { void load(); });
        children.push(button);
      }
      emptyEl.replaceChildren(...children);
    }

    function render() {
      const now = Date.now();
      const visible = contacts ? sortContacts(filterContacts(contacts, state), state.sort) : [];
      const view = viewState({ loading, error, contacts, visible });
      syncChips();
      renderActive();
      renderBanner();
      if (!contacts) countEl.textContent = view === 'error' ? 'Contacts unavailable' : 'Loading contacts…';
      else countEl.textContent = `${resultSummary(visible.length, contacts.length)}${loading ? ' · refreshing…' : ''}`;
      updatedEl.textContent = fetchedAt ? `Updated ${CLOCK.format(fetchedAt)} Manila time.` : '';
      gridEl.setAttribute('aria-busy', String(loading));
      emptyEl.hidden = view === 'results' || view === 'loading';
      if (view === 'loading') gridEl.replaceChildren(...skeletons(doc));
      else if (view === 'results') {
        gridEl.replaceChildren(...visible.map((c) => {
          let card = cards.get(c.id);
          if (!card) { card = buildCard(c, now, doc); cards.set(c.id, card); }
          return card;
        }));
      } else {
        gridEl.replaceChildren();
        renderEmpty(view);
      }
    }

    function update() { syncUrl(); render(); }
    function reset() {
      state = { q: '', platforms: new Set(), stages: new Set(), sort: state.sort };
      q.value = '';
      update();
      q.focus();
    }

    async function load() {
      const turn = ++generation;
      loading = true;
      refreshBtn.disabled = true;
      render();
      try {
        const response = await win.fetch(config.endpoint, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (response.status === 401) { win.location.href = `${config.mount}/login`; return; }
        /** @type {any} */ let body = null;
        try { body = await response.json(); } catch (_) { body = null; }
        if (turn !== generation) return;
        if (response.ok && body && body.ok === true && Array.isArray(body.contacts)) {
          contacts = body.contacts;
          total = typeof body.total === 'number' ? body.total : body.contacts.length;
          truncated = Boolean(body.truncated);
          fetchedAt = Date.now();
          error = null;
          cards = new Map();                 // relative times are recomputed from fresh data
        } else {
          error = { code: (body && body.error) || 'admin_unavailable', retryAfter: body && body.retry_after };
        }
      } catch (_) {
        if (turn === generation) error = { code: 'network' };
      } finally {
        if (turn === generation) {
          loading = false;
          refreshBtn.disabled = false;
          render();
        }
      }
    }

    q.addEventListener('input', () => { state.q = q.value; update(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; state.q = ''; update(); }
    });
    clearQ.addEventListener('click', () => { q.value = ''; state.q = ''; update(); q.focus(); });
    sortSel.addEventListener('change', () => { state.sort = sortSel.value; update(); });
    refreshBtn.addEventListener('click', () => { void load(); });
    resetBtn.addEventListener('click', reset);
    doc.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) { e.preventDefault(); q.focus(); q.select(); }
    });
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible' && fetchedAt && Date.now() - fetchedAt > STALE_MS && !loading) void load();
    });
    void load();
  }

  root.HiraiaCrm = {
    STAGES, SORTS, platformLabel, platformTitle, channelSummary, channelLabels, countsText, fold, matchesSearch,
    platformsOf, filterContacts, facetCounts, platformOptions, isFiltered, activeFilters, sortContacts,
    formatDateTime, formatDate, formatShort, relativeDay, activityView, firstContactView, firstMessageText, affiliationLine, sourceLabel,
    errorMessage, viewState, resultSummary,
    noMatchText, parseState, serializeState, mount,
  };
}(globalThis));
