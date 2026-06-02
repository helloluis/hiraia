/**
 * @hiraia/images — Drawing DSL types.
 *
 * This module defines the JSON contract that the LLM produces to request
 * a hand-drawn SVG illustration. The renderer pipeline consumes this JSON
 * and emits a finished SVG string.
 *
 * Design goals:
 * - Simple enough for a 1.7B parameter LLM to generate reliably
 * - Expressive enough for DepEd K-12 Science diagrams
 * - Render in <100ms on a low-end phone
 * - Produces XKCD-style hand-drawn SVG output
 */

// ─── Geometry ────────────────────────────────────────────────────────────────

export type Point = [number, number];

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

/**
 * Per-element style overrides. All fields are optional and fall back to
 * scene-level defaults so the LLM can omit anything it doesn't care about.
 */
export interface ElementStyle {
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  fill?: string;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'start' | 'middle' | 'end';
}

// ─── Primitive Elements ──────────────────────────────────────────────────────

export interface CircleElement {
  type: 'circle';
  id?: string;
  cx: number;
  cy: number;
  r: number;
  style?: ElementStyle;
}

export interface RectElement {
  type: 'rect';
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
  style?: ElementStyle;
}

export interface EllipseElement {
  type: 'ellipse';
  id?: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  style?: ElementStyle;
}

export interface LineElement {
  type: 'line';
  id?: string;
  from: Point;
  to: Point;
  style?: ElementStyle;
}

export interface ArrowElement {
  type: 'arrow';
  id?: string;
  from: Point;
  to: Point;
  double?: boolean;
  style?: ElementStyle;
}

export interface TextElement {
  type: 'text';
  id?: string;
  x: number;
  y: number;
  content: string;
  anchor?: 'start' | 'middle' | 'end';
  baseline?: 'top' | 'middle' | 'bottom';
  style?: ElementStyle;
}

export interface PathElement {
  type: 'path';
  id?: string;
  d: string;
  style?: ElementStyle;
}

export interface ArcElement {
  type: 'arc';
  id?: string;
  cx: number;
  cy: number;
  r: number;
  startAngle: number;
  endAngle: number;
  style?: ElementStyle;
}

/**
 * An organic/blob shape — generates an irregular closed outline using
 * polar coordinates with controlled randomness. Useful for leaves,
 * clouds, cells, planets, and other non-geometric shapes.
 *
 * Instead of manually specifying 12-20 path nodes, the LLM can just
 * provide a center, radius, node count, and irregularity factor.
 */
export interface BlobElement {
  type: 'blob';
  id?: string;
  cx: number;
  cy: number;
  /** Base radius of the blob. */
  r: number;
  /** Number of control points around the perimeter (default 12, range 6-20). */
  nodes?: number;
  /** How irregular the shape is: 0 = perfect circle, 1 = very wobbly (default 0.3). */
  irregularity?: number;
  /** Seed for deterministic shape generation (default: derived from scene seed). */
  seed?: number;
  style?: ElementStyle;
}

export interface GroupElement {
  type: 'group';
  id?: string;
  children: Element[];
  style?: ElementStyle;
}

// ─── Figure Composites ───────────────────────────────────────────────────────
//
// Figures are high-level templates the LLM can pick for common science
// concepts. Each figure has a fixed, simple parameter set — the renderer
// composes primitive elements internally.

export interface AtomFigure {
  type: 'figure:atom';
  id?: string;
  x: number;
  y: number;
  scale?: number;
  protons: number;
  neutrons: number;
  shells: number[];
  label?: string;
  style?: ElementStyle;
}

export interface StickFigureFigure {
  type: 'figure:stick';
  id?: string;
  x: number;
  y: number;
  scale?: number;
  pose?: 'standing' | 'waving' | 'pointing' | 'sitting';
  label?: string;
  style?: ElementStyle;
}

export interface CellFigure {
  type: 'figure:cell';
  id?: string;
  x: number;
  y: number;
  scale?: number;
  kind?: 'animal' | 'plant';
  parts?: ('nucleus' | 'membrane' | 'wall' | 'mitochondria' | 'chloroplast' | 'vacuole')[];
  style?: ElementStyle;
}

export interface SolarSystemFigure {
  type: 'figure:solar';
  id?: string;
  x: number;
  y: number;
  scale?: number;
  bodies?: string[];
  style?: ElementStyle;
}

export interface FoodChainFigure {
  type: 'figure:foodchain';
  id?: string;
  x: number;
  y: number;
  scale?: number;
  links: { from: string; to: string }[];
  style?: ElementStyle;
}

export interface CycleFigure {
  type: 'figure:cycle';
  id?: string;
  x: number;
  y: number;
  scale?: number;
  stages: string[];
  style?: ElementStyle;
}

// ─── Asset & Compose Elements ─────────────────────────────────────────────────

/**
 * Embed a curated SVG asset from the asset library.
 * The renderer looks up the asset by ID and embeds it as an inline SVG group.
 */
export interface AssetElement {
  type: 'asset';
  id?: string;
  /** Asset ID from the library (e.g. "cell-animal", "battery"). */
  assetId: string;
  /** Position to place the asset at (top-left corner of its bounding box). */
  x: number;
  y: number;
  /** Scale factor (default 1). */
  scale?: number;
  /** Optional style overrides applied as a wrapping group. */
  style?: ElementStyle;
}

/**
 * Compose multiple assets and primitives into a single diagram.
 * This is the RAG-recommended layout — the LLM specifies which assets to use
 * and how to arrange them, and the renderer handles embedding.
 */
export interface ComposeElement {
  type: 'compose';
  id?: string;
  /** Assets to embed, with positions. */
  assets: { assetId: string; x: number; y: number; scale?: number }[];
  /** Additional primitive elements (labels, arrows, etc.) drawn on top. */
  overlays?: Element[];
  style?: ElementStyle;
}

// ─── Unions ──────────────────────────────────────────────────────────────────

export type Element =
  | CircleElement
  | RectElement
  | EllipseElement
  | LineElement
  | ArrowElement
  | TextElement
  | PathElement
  | ArcElement
  | GroupElement
  | BlobElement
  | AssetElement
  | ComposeElement
  | AtomFigure
  | StickFigureFigure
  | CellFigure
  | SolarSystemFigure
  | FoodChainFigure
  | CycleFigure;

// ─── Scene (top-level) ───────────────────────────────────────────────────────

export interface SceneStyle {
  background?: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontFamily?: string;
  roughness?: number;
}

export interface Scene {
  version: 1;
  width: number;
  height: number;
  title?: string;
  caption?: string;
  style?: SceneStyle;
  elements: Element[];
}

// ─── Render Output ───────────────────────────────────────────────────────────

export interface RenderResult {
  svg: string;
  renderTimeMs: number;
  elementCount: number;
  warnings: string[];
}
