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
 * The trailing cues stay SAGOT:/ANSWER:/TUBAG: — `sanitizeCardAnswer` strips exactly those, so
 * a cue matching the new "fact card" framing would be echoed onto the card. 30 words keeps it
 * in the deck's own register (median printed card = 19 words) and inside ResponseCard's top
 * font tiers.
 */
export function buildCardPrompt({ query, facts, grade, language }: CardPromptInput): string {
  const context = facts.map((f) => `- ${f}`).join('\n');
  const byLang: Record<CardPromptLanguage, string> = {
    tagalog:
      `Sumulat ng ISANG maikling fact card para sa batang Grade ${grade}. Gamit LAMANG ang mga FACT sa ibaba, ` +
      `ilahad ang sagot sa TANONG sa 1-2 payak na pangungusap sa Tagalog, hindi hihigit sa 30 salita. ` +
      `Nakalimbag na kard ito, hindi usapan: walang pagbati, walang panimula, at walang tanong sa dulo — ` +
      `ang fact lang. HUWAG mag-imbento ng impormasyong wala sa mga FACT. ` +
      `Kung walang FACT na sumasagot sa TANONG, isulat na lang nang buo ang pinakamalapit na FACT — ` +
      `huwag pilitin ang koneksyon.` +
      `\n\nMGA FACT:\n${context}\n\nTANONG: ${query}\n\nSAGOT:`,
    english:
      `Write ONE short fact card for a Grade ${grade} child. Using ONLY the FACTS below, state the answer to ` +
      `the QUESTION in 1-2 plain English sentences, no more than 30 words. This is a printed card, not a ` +
      `conversation: no greeting, no preamble, no closing question — just the fact. Do NOT invent anything ` +
      `that is not in the FACTS. If no FACT answers the QUESTION, simply state the closest FACT in full — ` +
      `do not force a connection.` +
      `\n\nFACTS:\n${context}\n\nQUESTION: ${query}\n\nANSWER:`,
    cebuano:
      `Pagsulat og USA ka mubo nga fact card para sa batang Grade ${grade}. Gamit LANG ang mga FACT sa ubos, ` +
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
 * STOP SEQUENCE for a card. A card is ONE paragraph, so the first blank line ends it.
 *
 * Measured on the CPT'd Qwen3.5-2B (`Cryptopop/hiraia-sft-flagship-2b`, the shipping model):
 * with no stop it writes the correct card and then degenerates into repeated
 * "**Pansin:** … **Paliwanag:** …" until the token cap; with this stop it returns 36 tokens,
 * finish_reason 'stop', 20 words.
 *
 * It lives HERE, beside the prompt it terminates, because three callers have to send it and
 * they were not all sending it: the web route (`stop`), the gate (`stop`), and the phone
 * (llama.cpp has no per-request `stop` through QVAC — LocalEngine passes `CARD_STOP[0]` as the
 * load-time `reverse_prompt`). A copy that drifts on any one of them is a path the gate
 * certifies without testing.
 */
export const CARD_STOP: readonly string[] = ['\n\n'];

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
 * Clean a generated card: drop the model's own control markup, strip the trailing cue the
 * prompt ends on (the model sometimes echoes it), collapse whitespace, reject a stub, and cap
 * the length the response card is laid out for. Returns null when there is no printable card —
 * the caller then falls through to the honest gap shape rather than printing a fragment.
 *
 * TWO kinds of markup are removed, both MEASURED on the shipping model, both of which the app
 * would otherwise print as literal text (`ResponseCard` renders the string in a plain
 * `<Text>`; the chat surface's `RichText` was deleted with the rest of chat):
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
    .trim();
  t = t
    .replace(/^(sagot|answer|tubag)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 8) return null;
  if (t.length > CARD_MAX_CHARS) t = t.slice(0, CARD_MAX_CHARS - 3).trimEnd() + '…';
  return t;
}
