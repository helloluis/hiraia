/**
 * Data contracts for the Hiraia daily-factoid feature.
 *
 * Pure JSDoc typedefs (no runtime code) so both the .mjs runtime here and any
 * TypeScript consumer (web/mobile) share one vocabulary. Mirrors the trilingual
 * shape used by image captions in `packages/images/assets/<subject>/<id>.json`.
 */

/**
 * Trilingual text. `tl` (Tagalog) is the primary authoring language — it's the
 * one the "Alam mo ba na…?" format is written for. `en`/`ceb` are optional; the
 * composer falls back per the reader's language (see compose.mjs).
 * @typedef {{ tl: string, en?: string|null, ceb?: string|null }} Trilingual
 */

/**
 * One curated, verified factoid, anchored to exactly one image asset.
 *
 * The displayed message is assembled as:
 *   "<lead> <hook>? <body>"
 * e.g. "Alam mo ba na ang mga bubuyog ay may reyna? Kaya niyang mangitlog…"
 * The `hook` is the clause AFTER "Alam mo ba na " and BEFORE the "?"; the `body`
 * is the follow-up explanation. Keeping them separate lets us swap the lead per
 * language ("Did you know that…", "Nahibaw-an ba nimo nga…") without re-authoring.
 *
 * @typedef {Object} Factoid
 * @property {string}   id          Unique factoid id, e.g. "bee-bubuyog--queen-eggs".
 * @property {string}   imageId     Asset id in packages/images/index.json (the anchor).
 * @property {string}   subject     biology | chemistry | physics | earth-science | general.
 * @property {Trilingual} hook      The "[factoid]" clause (no leading "Alam mo ba na", no "?").
 * @property {Trilingual} body      The follow-up explanation sentence(s).
 * @property {number[]}  [grades]   DepEd grade bands this suits (3–10). Empty = all.
 * @property {string[]}  [tags]     Free tags for filtering/analytics.
 * @property {string}    [source]   Provenance / reference note checked during verification.
 * @property {boolean}   verified   Gate flag — runtime only ever serves verified:true.
 * @property {string}    [verifiedBy] Who/what cleared it ("human" | model id).
 * @property {string}    [verifiedAt] ISO timestamp of verification.
 */

/**
 * The on-disk bank file (bank/factoids.json).
 * @typedef {Object} FactoidBankFile
 * @property {number}    version
 * @property {string}    builtAt
 * @property {number}    count
 * @property {Factoid[]} factoids
 */

/**
 * Which daily slot a message belongs to. Morning = 07:00, evening = 20:00.
 * @typedef {'morning'|'evening'} Slot
 */

/**
 * The resolved image that accompanies a factoid (image-anchored, so this is a
 * direct lookup by `imageId`, not a search).
 * @typedef {Object} ResolvedImage
 * @property {string}   imageId
 * @property {string}   subject
 * @property {string}   name
 * @property {string|null} svgPath   Absolute path to the existing SVG asset, if present.
 * @property {string|null} pngPath   Absolute path to the rendered PNG, if present.
 * @property {Trilingual} caption    Asset caption (for the on-screen label / alt text).
 * @property {Trilingual} parts      Asset part labels.
 * @property {boolean}  found        False if the imageId is not in the index.
 */

/**
 * The fully composed message ready to hand to a delivery channel.
 * @typedef {Object} FactoidMessage
 * @property {string}    factoidId
 * @property {Slot}      slot
 * @property {('tagalog'|'english'|'cebuano')} language
 * @property {string}    text        The composed "Alam mo ba na…?" message.
 * @property {ResolvedImage} image   The anchor image (image.found may be false).
 * @property {string}    [iso]       ISO (UTC) timestamp the message was composed for.
 * @property {string}    [timeZone]  IANA zone the slot was evaluated in (e.g. "Asia/Manila").
 */

export {}; // module marker; this file is types-only
