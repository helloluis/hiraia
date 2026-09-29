/** UI history belongs to the reading session, not an Android Activity. React Native
 * retains its JS runtime when Android recreates a window to apply a font-size change.
 * Keep one bounded feed history; changing child/grade discards the previous owner's UI.
 * This cache never marks cards read or writes curriculum progress.
 */
export function createReadingSession<T>() {
  type Snapshot = { pages: T[]; visibleKey?: string; reviewKey: number; searchDraft: string };
  let active: { owner: string; snapshot: Snapshot } | undefined;
  return {
    open(owner: string): Snapshot {
      if (active?.owner !== owner) active = { owner, snapshot: { pages: [], reviewKey: 0, searchDraft: '' } };
      return active.snapshot;
    },
  };
}
