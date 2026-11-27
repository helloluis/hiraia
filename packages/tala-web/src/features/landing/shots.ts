/**
 * The product captures on the homepage (public/screens/home, written by scripts/home-capture.mjs): their pixel sizes,
 * so the page can reserve each picture's box before it loads. showcase.test.ts checks these against the files'
 * manifest, and that every file exists in both languages, both layouts and both formats.
 */
export const SHOTS = {
  planner: { wide: [1320, 1431], phone: [712, 1280] },
  slides: { wide: [1860, 1198], phone: [780, 1400] },
} as const;
export type ShotName = keyof typeof SHOTS;
/** From this width the wide capture is shown; below it, the phone one. */
export const WIDE_SHOT_FROM = 600;
