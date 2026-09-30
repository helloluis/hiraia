import type { RefObject } from 'react';
export type RailRef = RefObject<{ getScrollableNode(): unknown } | null>;
export type RailGestures = { begin(): void; end(offset: number): void };
/** Android supplies native drag/momentum events directly to FlatList. */
export function useRailGestures(_ref: RailRef, _enabled: boolean, _height: number, _handlers: RailGestures): void {}
