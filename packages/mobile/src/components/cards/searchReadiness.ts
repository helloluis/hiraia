/**
 * The search field AS the readiness bar — the feed-side views of engineStore's ONE
 * composed readiness number (see the STAGE WEIGHTS block in store/engineStore.ts).
 *
 * Four views, one number: the field's surface opacity, the crawl bar's width, the
 * crawl bar's colour, and the status-message pool. Everything here is a pure
 * function of (readiness, stage) so the views can never disagree.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import { useEngineStore, type ReadyStage } from '../../store/engineStore';
import { card, cardAlpha } from '../../theme';

// ============================================================================
// FIELD SURFACE — stepped opacity with a measured text-colour crossover.
// ============================================================================
// The field is cream stock (card.stock) painted over the dark board (card.board).
// At partial alpha the blend is a MID-luminance green-grey, and the band between
// ~0.38 and ~0.60 alpha is a measured dead zone: NO palette colour reaches the
// 4.5:1 AA ratio for 15 px text on it (best at 0.45 alpha: plate 3.76, ink 3.26).
// So the ramp is STEPPED and deliberately skips that band, with the text colour
// crossing from plate-white (legible on the dark low-alpha blend) to forest ink
// (legible on the light high-alpha blend). Measured contrast per step (WCAG,
// stock-over-board blend, verified 2026-09-01):
//
//   alpha 0.30 → plate 5.61:1   (start of load: the "~30% opaque" ghost)
//   alpha 0.35 → plate 4.89:1
//   alpha 0.62 → ink   4.88:1   (the crossover — the field visibly "fills in")
//   alpha 0.78 → ink   6.84:1
//   alpha 1.00 → olive 4.79:1   (the live field's normal placeholder)
//
// Steps rather than a lerp on purpose: a continuous alpha ramp would have to
// cross the illegible dead band, and the discrete jumps read as the field
// printing itself in — deliberate, like everything else on the board.
const SURFACE_STEPS: Array<{ upTo: number; alpha: number; text: string }> = [
  { upTo: 0.25, alpha: 0.3, text: card.plate },
  { upTo: 0.5, alpha: 0.35, text: card.plate },
  { upTo: 0.75, alpha: 0.62, text: card.ink },
  { upTo: 1, alpha: 0.78, text: card.ink },
];

export interface FieldSurface {
  /** Background for the field container (stock at the step's alpha). */
  backgroundColor: string;
  /** The only text colour measured ≥4.5:1 on that background. */
  textColor: string;
}

/** The field surface for a readiness value. `live` (engine ready) → full stock. */
export function fieldSurface(readiness: number, live: boolean): FieldSurface {
  if (live) return { backgroundColor: card.stock, textColor: card.ink };
  const step = SURFACE_STEPS.find((s) => readiness < s.upTo) ?? { alpha: 0.78, text: card.ink };
  return { backgroundColor: cardAlpha(card.stock, step.alpha), textColor: step.text };
}

// ============================================================================
// BAR COLOUR — a stepped red→orange→yellow→green walk through palette anchors.
// ============================================================================
// Stepped, not a continuous lerp, for two load-bearing reasons:
//   1. The mid-century direction is a TEN-colour palette and nothing else
//      (theme.ts); a lerp between distant hues spends most of its life in muddy
//      off-palette in-betweens (oxblood→gold passes through brown).
//   2. On a 4 px strip a lerp is imperceptible anyway; four crisp colour changes
//      read as deliberate print registration marks and each one is a visible
//      "we moved a stage" signal.
// Two anchors are 50/50 blends of ADJACENT palette entries because the raw entry
// fails non-text contrast (3:1) on the board (#20342C), measured 2026-09-01:
//   • red:   raw accent #7A2E22 is 1.41:1 on the board — invisible. The
//     accent↔peach midpoint (#B16F57, still the warm oxblood/mat family the
//     palette owns) measures 3.31:1.
//   • near-green: raw olive #5B6B52 is 2.31:1; the olive↔sage midpoint
//     (#748560) measures 3.29:1.
//   • peach 6.91:1, gold 5.67:1, sage 4.55:1 pass as-is.
// Hue order stays monotonic red(≈16°)→peach(≈25°)→gold(≈41°)→green(≈90°).
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) =>
    Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

const BAR_RED = mixHex(card.accent, card.peach, 0.5); // #B16F57 — 3.31:1 on board
const BAR_GREEN_NEAR = mixHex(card.olive, card.sage, 0.5); // #748560 — 3.29:1 on board

/** Bar colour for a readiness value: quartile steps, sage only at full green. */
export function barColor(readiness: number): string {
  if (readiness >= 1) return card.sage;
  if (readiness >= 0.75) return BAR_GREEN_NEAR;
  if (readiness >= 0.5) return card.gold;
  if (readiness >= 0.25) return card.peach;
  return BAR_RED;
}

// ============================================================================
// STATUS MESSAGES — stage-truthful first, evergreen fillers, ~10 s rotation.
// ============================================================================
/** Stages whose underlying number is REAL bytes/percent (never a time estimate) —
 *  the only stages where offering "{pct}% done" is telling the truth. */
const REAL_SIGNAL_STAGES: ReadyStage[] = ['download', 'load'];

// NO entries for 'semantic' or 'done' ON PURPOSE. This hook only runs while a load
// is in flight (enabled = warming && !engineReady in CardFeedScreen), and readyStage
// can only be 'semantic'/'done' AFTER isReady — by which point the field is the live
// TextInput and its placeholder is the real searchPlaceholder BY DESIGN: the
// invitation to type outranks a status line about a retrieval-precision upgrade,
// and the crawling bar alone carries the LaBSE story to green.
const STAGE_KEY: Partial<Record<ReadyStage, 'connect' | 'download' | 'verify' | 'load' | 'cpuRetry' | 'warm'>> = {
  connect: 'connect',
  download: 'download',
  verify: 'verify',
  load: 'load',
  'cpu-retry': 'cpuRetry',
  warm: 'warm',
};

const ROTATE_MS = 10_000;

/**
 * The status line for the warming search field. Rules:
 *   • a stage CHANGE immediately shows a stage-truthful message (the effect re-runs
 *     on `stage`, so the child is never told about work that already finished);
 *   • every ~10 s it rotates within {stage messages + evergreen + "{pct}% done"},
 *     never repeating the line it just showed;
 *   • "{pct}% done" is offered only in stages backed by a real signal, and the
 *     percent is the composed readiness number AT SELECTION TIME (a message keeps
 *     its number for its 10 s life — the typewriter types each line exactly once).
 * Returns '' while `enabled` is false.
 */
export function useReadinessMessage(enabled: boolean, stage: ReadyStage, language: Language): string {
  const [msg, setMsg] = useState('');
  const lastRef = useRef('');

  const pick = useCallback(
    (stageTruthful: boolean) => {
      const t = uiStrings(language).cards.loading;
      const key = STAGE_KEY[stage];
      const stageMsgs = key ? t[key] : [];
      let pool: string[];
      if (stageTruthful && stageMsgs.length > 0) {
        pool = stageMsgs;
      } else {
        pool = [...stageMsgs, ...t.evergreen];
        if (REAL_SIGNAL_STAGES.includes(stage)) {
          const pct = Math.round(useEngineStore.getState().readiness * 100);
          pool.push(t.pctDone.replace('{pct}', String(pct)));
        }
      }
      const fresh = pool.filter((m) => m !== lastRef.current);
      const from = fresh.length > 0 ? fresh : pool;
      const choice = from[Math.floor(Math.random() * from.length)] ?? '';
      lastRef.current = choice;
      setMsg(choice);
    },
    [stage, language]
  );

  useEffect(() => {
    if (!enabled) {
      setMsg('');
      lastRef.current = '';
      return;
    }
    // Stage changed (or the rotation is starting): stage-truthful line, right now.
    pick(true);
    const iv = setInterval(() => pick(false), ROTATE_MS);
    return () => clearInterval(iv);
  }, [enabled, pick]);

  return msg;
}
