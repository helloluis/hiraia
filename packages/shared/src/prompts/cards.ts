/**
 * The DYNAMIC CARD prompt — the one instruction that turns retrieved facts into a printed
 * card for a kid's typed feed query.
 *
 * It lives here, not in an engine, because two engines run it now and they must be the SAME
 * prompt: the phone's on-device path (LocalEngine.answerQuery → QVAC completion) and the web
 * demo's server path (app/api/demo/card → the VPS llama-server). A card that reads one way on
 * hiraia.org and another way in the APK is not a demo of the app, and the wording below is
 * calibrated (see the notes on the deleted hedge), so a divergent copy would silently lose
 * that calibration.
 *
 * The three OUTCOMES around this prompt (fact card / in-domain gap / off-domain) are decided
 * before it is ever built — by retrieval plus `isOffDomain` (rag/RagStore.ts). Both gap
 * shapes are model-FREE: nothing is generated, so nothing can be hallucinated. This module is
 * only reached on the grounded outcome.
 */

/** Languages the card prompt is written in (the app's three). */
export type CardPromptLanguage = 'tagalog' | 'english' | 'cebuano';

export interface CardPromptInput {
  /** The child's typed query, verbatim. */
  query: string;
  /** Retrieved grounding fact texts, best first (typically 3-4). */
  facts: readonly string[];
  /** Student's grade — the card is pitched at it. */
  grade: number;
  language: string;
}

/**
 * Build the one-shot instruction for a grounded fact card.
 *
 * The old templates ended with "kung hindi masagot ng mga fact ang tanong, sabihin mong hindi
 * mo pa alam" (and its en/ceb twins). That HEDGE is deleted deliberately, not by oversight: a
 * 1,188-probe routing benchmark measured 64% of Tagalog replies OPENING with "hindi ko alam"
 * on terms the model then went on to explain correctly, and this wording is the prime suspect.
 * What is printed here is a card, and a card does not say it doesn't know.
 *
 * What replaces it is NOT nothing. The caller's early returns prove only that grounding
 * EXISTS, which is not the same as grounding that ANSWERS: "nba finals" clears every one of
 * them (the bank has "final", so it is not lexically empty, and it scores .630) and arrives
 * here with four shark facts. With no permitted third option the model can only fabricate a
 * link or print a shark fact as though it answered a basketball question. So the escape is
 * card-shaped instead of conversation-shaped: print the nearest fact WHOLE, don't force the
 * connection. It states something true either way, which is what a printed card must do.
 *
 * What the model writes is a PRINTED CARD, not a conversation turn: state the fact and stop.
 * The trailing cues stay SAGOT:/ANSWER:/TUBAG: — `sanitizeCardAnswer` strips exactly those
 * (tolerating one parenthetical), so a cue matching the new "fact card" framing would be
 * echoed onto the card. The ENGLISH cue alone carries "(in English)": measured on the
 * shipping 2B (2026-09-01), the model answered the English water-cycle probe in Tagalog in
 * ~1 of 4 draws without it and 0 of 8 with it, while Tagalog/Cebuano cards never drifted —
 * so only the drifting language pays the extra cue tokens. 30 words keeps the card in the
 * deck's own register (median printed card = 19 words) and inside ResponseCard's top font
 * tiers; the ceiling is ENFORCED by `sanitizeCardAnswer`'s sentence trim, not by this
 * instruction (see CARD_MAX_WORDS for the measurement). A stronger length instruction
 * ("ISANG pangungusap", "25 salita", the cap repeated inside the cue) was tried and
 * REVERTED: with the trim in place it bought no length — the trim already holds every draw
 * at ≤30 — and it COST content, biasing the model into dropping exactly the details
 * per-case assertions need (Galileo off the Jupiter card, the meanings off the flag-colours
 * card). Measured A/B on the gate, 2026-09-01: original wording + trim 17/21, shortened
 * wording + trim 13/21.
 */
/**
 * The grade's REGISTER instruction, by band — one short sentence, or nothing.
 *
 * Without it the grade was a bare number the model ignored: measured on the gate
 * (grade-register-photosynthesis, 2026-09-02), the Grade-3 and Grade-10 cards came back
 * IDENTICAL, so the user-visible grade setting was inert. The middle band (4-6) is
 * deliberately EMPTY: it keeps the prompt byte-identical to the calibrated wording every
 * other measurement was made on (the app defaults to Grade 5), so only the edges of the
 * range — where the register actually has to move — pay the extra tokens.
 */
function registerClause(grade: number, language: CardPromptLanguage): string {
  if (grade <= 3) {
    return {
      tagalog:
        'Gumamit LAMANG ng maiikli at pang-araw-araw na salita na alam ng maliit na bata; ' +
        'huwag gumamit ng teknikal na terminong pang-agham, at huwag itong isulat bilang ' +
        'pormal na depinisyon. ',
      english:
        'Use only short, everyday words a young child knows; do not use technical science ' +
        'terms, and do not write it as a formal definition. ',
      cebuano:
        'Gamita LANG ang mugbo ug inadlaw-adlaw nga mga pulong nga masabtan sa gamay nga bata; ' +
        'ayaw gamita ang teknikal nga mga termino, ug ayaw kini isulata isip pormal nga depinisyon. ',
    }[language];
  }
  if (grade >= 7) {
    return {
      tagalog:
        'Isulat ito bilang pormal na depinisyon na nagsisimula sa pangalan ng paksa ' +
        '("Ang … ay …"), gamit ang eksaktong mga terminong pang-agham, at ISAMA ang isang ' +
        'karagdagang teknikal na detalye mula sa mga FACT (hal. eksaktong pangalan o proseso). ',
      english:
        'Write it as a formal definition of the topic ("The … is …"), use the precise ' +
        'scientific terms, and INCLUDE one extra technical detail from the FACTS ' +
        '(e.g. an exact name or process). ',
      cebuano:
        'Isulat kini isip pormal nga depinisyon sa topiko ("Ang … mao ang …"), gamita ang ' +
        'tukma nga mga terminong pang-agham, ug ILAKIP ang usa ka dugang teknikal nga detalye ' +
        'gikan sa mga FACT (pananglitan usa ka eksaktong ngalan o proseso). ',
    }[language];
  }
  return '';
}

export function buildCardPrompt({ query, facts, grade, language }: CardPromptInput): string {
  const context = facts.map((f) => `- ${f}`).join('\n');
  const byLang: Record<CardPromptLanguage, string> = {
    tagalog:
      `Sumulat ng ISANG maikling fact card para sa batang Grade ${grade}. ` +
      registerClause(grade, 'tagalog') +
      `Gamit LAMANG ang mga FACT sa ibaba, ` +
      `ilahad ang sagot sa TANONG sa 1-2 payak na pangungusap sa Tagalog, hindi hihigit sa 30 salita. ` +
      `Nakalimbag na kard ito, hindi usapan: walang pagbati, walang panimula, at walang tanong sa dulo — ` +
      `ang fact lang. HUWAG mag-imbento ng impormasyong wala sa mga FACT. ` +
      `Kung walang FACT na sumasagot sa TANONG, isulat na lang nang buo ang pinakamalapit na FACT — ` +
      `huwag pilitin ang koneksyon.` +
      `\n\nMGA FACT:\n${context}\n\nTANONG: ${query}\n\nSAGOT:`,
    english:
      `Write ONE short fact card for a Grade ${grade} child. ` +
      registerClause(grade, 'english') +
      `Using ONLY the FACTS below, state the answer to ` +
      `the QUESTION in 1-2 plain English sentences, no more than 30 words. This is a printed card, not a ` +
      `conversation: no greeting, no preamble, no closing question — just the fact. Do NOT invent anything ` +
      `that is not in the FACTS. If no FACT answers the QUESTION, simply state the closest FACT in full — ` +
      `do not force a connection.` +
      `\n\nFACTS:\n${context}\n\nQUESTION: ${query}\n\nANSWER (in English):`,
    cebuano:
      `Pagsulat og USA ka mubo nga fact card para sa batang Grade ${grade}. ` +
      registerClause(grade, 'cebuano') +
      `Gamit LANG ang mga FACT sa ubos, ` +
      `ipahayag ang tubag sa PANGUTANA sa 1-2 yano nga tudling-pulong sa Binisaya, dili molapas sa 30 ka pulong. ` +
      `Giimprinta nga kard kini, dili panag-istorya: ayaw pagkumusta, ayaw pagpasiuna, ug ayaw pangutan-a ang ` +
      `bata sa katapusan — ang fact lang. AYAW pag-imbento og impormasyon nga wala sa mga FACT. ` +
      `Kung walay FACT nga motubag sa PANGUTANA, isulat na lang ang labing duol nga FACT sa tibuok — ` +
      `ayaw pugsa ang koneksyon.` +
      `\n\nMGA FACT:\n${context}\n\nPANGUTANA: ${query}\n\nTUBAG:`,
  };
  return byLang[language as CardPromptLanguage] ?? byLang.tagalog;
}

/** Temperature for the card generation: low, so the card stays faithful to the retrieved facts. */
export const CARD_TEMP = 0.3;

/**
 * STOP SEQUENCES for a card. A card is ONE LINE of prose, so the first newline ends it.
 *
 * Measured on the CPT'd Qwen3.5-2B (`Cryptopop/hiraia-sft-flagship-2b`, the shipping model) by
 * dumping the RAW generation behind every red gate case (2026-09-01): the card itself is
 * always a single line, and every degeneration class begins right after the FIRST `\n` —
 * "card.\n```\n```…" (fence runaway to the token cap), "card.\n**Bonus:** the card again…"
 * (paragraph loop), "card.\n[image: …]" (retired-SFT habit), "card.\n</think>" (reasoning
 * bleed). The old stop was `'\n\n'`, and none of those ever emit a blank line, so it never
 * fired — which is exactly why the gate still measured fence runaways to finish_reason
 * 'length' and [image:] residue with the stop in place.
 *
 * `'\n'` ends the card at the boundary where the card ends and the junk begins. The remaining
 * entries catch the same habits arriving INLINE (measured: "… the oxygen we breathe.
 * </think>" on one line). Every entry was checked against the authored deck (cards.db:
 * 46,421 cards × 3 languages, plus all 50,279 facts): none contains a newline-free backtick,
 * `[image:` or think tag, so no legitimate card text can be truncated by these. `'**'` is
 * deliberately NOT a stop — inline bold shows up MID-sentence ("Ang **photosynthesis**
 * mao…"), so stopping there would cut a good card to a stub; `sanitizeCardAnswer` unwraps it
 * instead.
 *
 * It lives HERE, beside the prompt it terminates, because three callers have to send it and
 * they were not all sending it: the web route (per-request `stop`), the gate (per-request
 * `stop`), and the phone (QVAC has no per-request stop — LocalEngine sets the same array once
 * at load time as the SDK's `stop_sequences`). A copy that drifts on any one of them is a
 * path the gate certifies without testing.
 */
export const CARD_STOP: readonly string[] = ['\n', '</think>', '[image:', '```'];

/**
 * Generation ceiling for a card, in tokens. A RUNAWAY BACKSTOP, not the length control — the
 * prompt's word ceiling and CARD_STOP are the controls; this only bounds what a failure can
 * cost (phone decode is ~7 t/s on the SD685, so every wasted token is ~150 ms of veil).
 *
 * Sized by MEASUREMENT, twice (gate draws, 2026-09-01). Worst observed ratio is 2.33
 * tokens/word, so 160 reaches ~68 words before binding. A tighter 96 was tried first and
 * REJECTED: once the sanitizer's sentence trim exists, a verbose-but-well-formed draw (the
 * model's ~50-word Cebuano cards, ~110-130 tokens) is a card the trim SAVES — under a 96 cap
 * those same draws died at finish_reason 'length' instead of ending at 'stop' (measured:
 * ceb-skyblue/ceb-volcano/ceb-water-cycle went red on generation health at 96 and green at
 * 160). Every true runaway class now ends on CARD_STOP long before any cap, so 160 binds on
 * nothing but a genuinely degenerate draw, which SHOULD read as a defect.
 * Shared for the same reason as CARD_STOP: the web route and the gate must bound the SAME
 * request, and the literal 160 they each carried was a copy the other could drift from.
 */
export const CARD_MAX_TOKENS = 160;

/**
 * REASONING BUDGET for a card: 0 = the reasoning channel is OFF.
 *
 * The shipping model is a THINKING model. Left on, it strands the answer in
 * `reasoning_content` and returns an EMPTY `content`, so every card reads as a generation
 * failure and falls through to the gap card. Servers take this as
 * `chat_template_kwargs: { enable_thinking: false }`; QVAC takes the same decision as the
 * numeric `reasoning_budget` (`-1` = on, `0` = off) in `generationParams`. Same switch, two
 * transports — named once so neither transport can quietly stop flipping it.
 */
export const CARD_REASONING_BUDGET = 0;

/** Hard ceiling on a printed card, in characters (ResponseCard's last font tier). */
export const CARD_MAX_CHARS = 320;

/**
 * Ceiling on a printed card, in words — the deck's own register (median printed card = 19
 * words) and the number the card gate asserts. The prompt REQUESTS this length; the
 * sanitizer's sentence trim (below) ENFORCES it, because the instruction number couples only
 * weakly to the drawn length on the shipping 2B — measured (50-draw A/B on the gate's red
 * cases, 2026-09-01): telling it 25 instead of 30 moved the over-ceiling rate just 76%→58%,
 * and every stronger phrasing traded away content instead (see buildCardPrompt's note).
 */
export const CARD_MAX_WORDS = 30;

/**
 * Clean a generated card: drop the model's own control markup, strip the trailing cue the
 * prompt ends on (the model sometimes echoes it), collapse whitespace, reject a stub, and cap
 * the length the response card is laid out for. Returns null when there is no printable card —
 * the caller then falls through to the honest gap shape rather than printing a fragment.
 *
 * THREE kinds of markup are removed, all MEASURED on the shipping model, all of which the app
 * would otherwise print as literal text (`ResponseCard` renders the string in a plain
 * `<Text>`; the chat surface's `RichText` was deleted with the rest of chat) — reasoning
 * tags, image tags, and inline markdown (bold/backticks, unwrapped in place):
 *
 *  1. REASONING TAGS. Even with the reasoning channel disabled the model leaks a bare
 *     `</think>` at the end of an otherwise-correct card ("… the oxygen we breathe.
 *     </think>"). A complete `<think>…</think>` block is reasoning and is dropped whole; an
 *     unterminated `<think>` swallows the rest (it ran to the token cap); a lone `</think>` is
 *     just a stray tag, so the prose around it is KEPT and only the tag goes.
 *  2. IMAGE TAGS. The model still emits `[image: …]` (a habit of the retired chat SFT). The
 *     illustration is retrieval's job on the card path — the picture is resolved from the
 *     GROUNDED FACT THE CARD STATES (LocalEngine.resolveFactImage / web server/images.ts,
 *     selected by `attributeCardToFact`), and nothing
 *     anywhere resolves the tag — so on the card it is junk, and printing it would put a
 *     stray bracket in a child's sentence.
 *
 *     THE FIX FOR THE EMISSION IS TRAINING-SIDE, NOT HERE AND NOT IN THE PROMPT: drop the
 *     image-tag rows from the SFT mix and the habit goes with them. This strip stays either
 *     way — it is the product's defence, and it costs one regex — but it is a bandage over a
 *     dataset, and telling the prompt "do not emit [image:]" would spend tokens teaching the
 *     model a token it should never have been taught.
 *
 * Sanitising them here is the PRODUCT's defence, and it deliberately hides nothing from the
 * gate: `rawGenerationDefects` (finetuning/eval/cardshape.mts) asserts on the RAW `content`,
 * before this runs, so the model regressing into either habit is still a red gate.
 */
export function sanitizeCardAnswer(raw: string): string | null {
  let t = (raw ?? '').trim();
  if (!t) return null;
  t = t
    // reasoning channel — complete block, then an unterminated one, then a stray closer
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<think>[\s\S]*$/i, ' ')
    .replace(/<\/think>/gi, ' ')
    // image control token (closed, then one truncated by the token cap)
    .replace(/\[image:[^\]]*\]/gi, ' ')
    .replace(/\[image:[^\]]*$/i, ' ')
    // markdown the app would print literally (ResponseCard renders a plain <Text>). Bold is
    // UNWRAPPED, not stopped on, because it arrives mid-sentence ("Ang **photosynthesis**
    // mao…") — a `'**'` stop sequence would cut that card to the stub "Ang ". The pair form
    // first so its text survives, then any orphan marker; same for inline code ticks. Fence
    // RUNS can no longer arrive (CARD_STOP), but stripping them stays as the product's
    // defence in depth.
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*\*/g, ' ')
    .replace(/```+/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/`/g, ' ')
    .trim();
  t = t
    .replace(/^(sagot|answer|tubag)\s*(\([^)]*\))?\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 8) return null;
  t = trimToWordCeiling(t);
  if (t.length > CARD_MAX_CHARS) t = t.slice(0, CARD_MAX_CHARS - 3).trimEnd() + '…';
  return t;
}

/**
 * Enforce CARD_MAX_WORDS by dropping trailing WHOLE sentences — never a mid-thought cut.
 *
 * This is the length ceiling's actual enforcement, and it lives in the product, not the
 * prompt, on a measurement: the shipping 2B's drawn length couples only weakly to the
 * instruction (see CARD_MAX_WORDS), and its long cards are always "the right card + extra
 * elaboration sentences" — "Volcanoes erupt because of pressure from magma and gas deep
 * underground. As magma rises, … . Like a shaken soda bottle …" — where the FIRST sentence is
 * the definition and carries the answer. Dropping the elaboration returns the card to the
 * deck's register; it is the gentle sibling of the CARD_MAX_CHARS cut below, which slices
 * mid-word and prints "…".
 *
 * A single sentence that alone exceeds the ceiling is returned whole: cutting inside a
 * sentence is exactly the mid-thought fragment a printed card must never show, so an
 * over-long single-sentence card stays over-long (and the gate stays red on it — this trim
 * makes no defect invisible that a child would still see).
 *
 * Deliberately Hermes-safe: no lookbehind, no unicode property escapes (the phone runs this).
 */
const countWords = (s: string) => s.split(/\s+/).filter((w) => /[a-z0-9ñáéíóúü]/i.test(w)).length;

/**
 * Cut a run-on sentence at the LAST clause boundary that fits the ceiling — never at a bare
 * comma: comma lists are integral content ("liwanag ng araw, tubig, at carbon dioxide" is the
 * answer itself, not elaboration). Boundaries are em-dash/semicolon/colon, plus a comma ONLY
 * when a coordinating conjunction follows ("…forms clouds (condensation), and when clouds get
 * heavy…"). Returns '' when no boundary yields a head of 8..CARD_MAX_WORDS words.
 */
function clauseBoundaryHead(sentence: string): string {
  const boundary =
    /\s+[—–]\s+|;\s+|:\s+|,\s+(?=(?:and|at|ug|but|pero|apan|while|habang|samtang|so|kaya|kaya't|busa|ngunit|subalit|unya|dahil|because|tungod)\s)/g;
  let head = '';
  for (let m = boundary.exec(sentence); m; m = boundary.exec(sentence)) {
    const h = sentence.slice(0, m.index);
    if (countWords(h) >= 8 && countWords(h) <= CARD_MAX_WORDS) head = h;
  }
  if (!head) return '';
  return /[.!?]$/.test(head) ? head : `${head.replace(/[,\s]+$/, '')}.`;
}

function trimToWordCeiling(text: string): string {
  if (countWords(text) <= CARD_MAX_WORDS) return text;
  // Split AFTER terminal punctuation (+ closing quotes/parens) that is followed by a space.
  // The capture keeps the terminator; the lookahead spares decimals ("2.5") and initialisms.
  const parts = text.split(/([.!?]+["'”’)]*)(?=\s|$)/);
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const sent = (parts[i] + (parts[i + 1] ?? '')).trim();
    if (sent) sentences.push(sent);
  }
  // Keep the largest contiguous WINDOW of sentences that fits the ceiling — not always the
  // prefix. Usually they coincide (definition first, elaboration after), but on "list, then
  // meaning" cards the ANSWER is the tail: "Ang watawat ay may apat na kulay: asul, pula,
  // puti, at ginto. Ang pula ay sumisimbolo sa katapangan…" — keeping the 15-word lead-in
  // and dropping the 25-word meanings would print a card that answers nothing (measured on
  // the gate's ph-flag-colors case). The largest fitting window is the one that preserves
  // the most of what the model said; ties go to the earliest.
  // "> keptWords + 3", not ">": near-ties go to the EARLIEST window. A later window must be
  // clearly larger to win, because the earliest sentence is usually the definition — measured:
  // without the slack, "In the water cycle, the sun's heat evaporates… The vapor rises… When
  // clouds get heavy…" trimmed to the antecedent-less "The vapor rises…" (24 words) over the
  // definition window (21 words), while the flag card's meanings tail (25 words vs a 15-word
  // colour list) still clears the slack and wins as it should.
  let kept = '';
  let keptWords = 0;
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i; j < sentences.length; j++) {
      const win = sentences.slice(i, j + 1).join(' ');
      const w = countWords(win);
      if (w > CARD_MAX_WORDS) break;
      if (w > keptWords + 3) {
        keptWords = w;
        kept = win;
      }
    }
  }
  // A fitting window can only CONTAIN the first sentence when that sentence itself fits.
  // When it does NOT — the model's 31+-word single-sentence answer followed by a short
  // elaboration ("Ang mga bulkan ay pumuputok dahil sa … [32 words]. Parang inalog na bote
  // ng soda ang pagsabog nito.") — every window the loop above can keep is a TAIL with its
  // antecedent dropped: the soda-bottle analogy with no volcano, a card that answers
  // nothing. So try the clause-boundary cut (below) on the ANSWER sentence too, and prefer
  // that head unless the tail window is clearly larger — the same +3 slack that already
  // arbitrates the flag card's meanings tail over its colour-list lead-in.
  const first = sentences[0] ?? '';
  if (kept && first && countWords(first) > CARD_MAX_WORDS) {
    const head = clauseBoundaryHead(first);
    if (head && keptWords <= countWords(head) + 3) kept = head;
  }
  // NO window fits — a run-on enumeration: "Ang water cycle ay ang pag-ikot ng tubig: ang
  // araw ay …, ang singaw ay …, at …". The head before the colon/em-dash/semicolon is the
  // complete definition, so cut at the LAST clause boundary that fits (clauseBoundaryHead).
  if (!kept) {
    kept = sentences[0] ?? text;
    const head = clauseBoundaryHead(kept);
    if (head) kept = head;
  }
  // Never trim to a stub — below 4 words the result is not a card (the caller's stub floor
  // and the gate's own "a stub, not a card" rule agree), so prefer the over-long original.
  return countWords(kept) >= 4 ? kept : text;
}
