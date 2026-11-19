'use client';
/**
 * One slide, drawn as HTML from the shared display list (`layoutDeck` in @hiraia/tala-core/decks), at any size:
 * a thumbnail, the carousel, the editor canvas and full-screen presenting all use this one component, and the
 * PowerPoint export is written from the same list, so what a teacher sees is what the teacher downloads.
 *
 * The slide is always laid out at one fixed size (960 × 540 px, where one point is one pixel) and then scaled as a
 * whole to the space it is given. Words stay real text, but a thumbnail is an exact small picture of the big slide:
 * no rounding of tiny font sizes, and a phone's minimum font size or text boosting cannot break the layout.
 * Slide colours and fonts are the deck's own (Office-safe Cambria/Calibri with fitted fallbacks), not the app theme.
 */
import { memo, useInsertionEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DECK_COLORS, SLIDE_H, SLIDE_W, type EditField, type ImageItem, type ShapeItem, type SlideLayout, type TextItem } from '@hiraia/tala-core/decks';
import { cx } from '@/components/ui';
import { GlyphMark, WordMark } from './brand-marks';

/**
 * The deck's fonts are Cambria and Calibri. Where they are not installed (most phones, Macs without Office) the app's
 * own metric twins are used: 'Tala Slide Serif' (Caladea Bold) and 'Tala Slide Sans' (Carlito), bundled and declared
 * in globals.css, so lines break exactly where they break in PowerPoint. For the moment before those load, a system
 * font is used at a size that gives the same average letter width (ratios measured on the words of the built packs,
 * English and Filipino, against Carlito and Caladea Bold; Roboto's follow Arial's, which it matches closely).
 */
const HEAD_FONT = "Cambria, Caladea, 'Tala Slide Serif', 'TalaFit Fraunces', Georgia, 'Times New Roman', serif";
const BODY_FONT = "Calibri, Carlito, 'Tala Slide Sans', 'TalaFit Roboto', 'TalaFit Helvetica', 'TalaFit Inter', 'TalaFit Noto', 'TalaFit DejaVu', var(--font-body)";
const FIT = (family: string, weight: number, locals: string[], adjust: number) =>
  `@font-face{font-family:"${family}";font-weight:${weight};src:${locals.map((l) => `local("${l}")`).join(',')};size-adjust:${adjust}%}`;
const FONT_CSS = [
  '@font-face{font-family:"TalaFit Fraunces";font-weight:700;src:url(/fonts/fraunces-semibold.woff2) format("woff2");size-adjust:93.8%;font-display:swap}',
  FIT('TalaFit Roboto', 400, ['Roboto', 'Roboto Regular', 'Roboto-Regular'], 91),
  FIT('TalaFit Roboto', 700, ['Roboto Bold', 'Roboto-Bold'], 90),
  FIT('TalaFit Helvetica', 400, ['Helvetica Neue', 'HelveticaNeue', 'Helvetica', 'Arial', 'ArialMT', 'Liberation Sans'], 91),
  FIT('TalaFit Helvetica', 700, ['Helvetica Neue Bold', 'HelveticaNeue-Bold', 'Helvetica Bold', 'Helvetica-Bold', 'Arial Bold', 'Arial-BoldMT', 'Liberation Sans Bold'], 86.5),
  FIT('TalaFit Inter', 400, ['Inter', 'Inter Regular', 'Adwaita Sans', 'AdwaitaSans-Regular'], 93.4),
  FIT('TalaFit Inter', 700, ['Inter Bold', 'Inter-Bold', 'Adwaita Sans Bold', 'AdwaitaSans-Bold'], 90.5),
  FIT('TalaFit Noto', 400, ['Noto Sans', 'Noto Sans Regular', 'NotoSans-Regular'], 87),
  FIT('TalaFit Noto', 700, ['Noto Sans Bold', 'NotoSans-Bold'], 84),
  FIT('TalaFit DejaVu', 400, ['DejaVu Sans', 'DejaVuSans'], 80.4),
  FIT('TalaFit DejaVu', 700, ['DejaVu Sans Bold', 'DejaVuSans-Bold'], 72.8),
].join('');
/** Fixed one-line labels (kind chip, day number, draft badge): they grow rather than wrap if a fallback font is wider. */
const ONE_LINE = new Set(['kind label', 'day label', 'draft label']);
const MARGIN = 0.6;
/**
 * Office sets Calibri (and its twin Carlito) with a line of 1.22 em and its letters low in that line; a browser
 * centres them. Matching both keeps every line of body text where PowerPoint puts it (measured against the decks'
 * own previews). Cambria/Caladea titles need no correction.
 */
const BODY_LINE = 1.22;
const BODY_DROP = '0.11em';
const HEAD_LINE = 1.2;

/** The size every slide is laid out at before it is scaled to fit. */
const BASE_W = 960;
const BASE_H = (BASE_W * SLIDE_H) / SLIDE_W;
const PX_PER_INCH = BASE_W / SLIDE_W;
/** Inches on the slide → CSS length at the base size. */
const inch = (n: number) => `${+(n * PX_PER_INCH).toFixed(2)}px`;
/** Points (1/72 in) → CSS length at the base size. */
const pt = (n: number) => `${+((n * PX_PER_INCH) / 72).toFixed(2)}px`;

/* One ResizeObserver for every slide on the page (a deck shows dozens of thumbnails). */
const fitters = new WeakMap<Element, (width: number) => void>();
let resizeObserver: ResizeObserver | null = null;
function watchWidth(el: Element, fit: (width: number) => void): () => void {
  if (typeof ResizeObserver === 'undefined') {
    const onResize = () => fit((el as HTMLElement).offsetWidth);
    window.addEventListener('resize', onResize);
    // Nothing tells an old browser when a hidden slide first gets a width (a dialog opening): keep looking.
    const timer = setInterval(onResize, 250);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', onResize);
    };
  }
  resizeObserver ??= new ResizeObserver((entries) => {
    for (const e of entries) fitters.get(e.target)?.(e.contentRect.width);
  });
  fitters.set(el, fit);
  resizeObserver.observe(el);
  return () => {
    resizeObserver?.unobserve(el);
    fitters.delete(el);
  };
}

export const sameField = (a: EditField | null, b: EditField | null): boolean =>
  a === b || (!!a && !!b && a.type === b.type && (a.type !== 'choice' || a.index === (b as { index: number }).index));

export interface SlideEditing {
  /** The field being typed into right now, if any. */
  active: EditField | null;
  /** The text to put in the box when typing starts (lines joined by newlines). */
  valueOf: (field: EditField) => string;
  onStart: (field: EditField) => void;
  onCommit: (field: EditField, value: string) => void;
  onCancel: () => void;
  /** Words for empty boxes and for screen readers. */
  words: { addTitle: string; addText: string; changeTitle: string; changeText: string; changeChoice: (letter: string) => string };
  maxLength: (field: EditField) => number;
}

export interface SlideViewProps {
  layout: SlideLayout;
  /** 1-based number printed bottom right. */
  number: number;
  mediaUrl: (slug: string) => string;
  className?: string;
  /** Load drawings at once (the slide in view); thumbnails load lazily. */
  eager?: boolean;
  /** A picture of the slide inside a labelled control: hidden from screen readers. */
  decorative?: boolean;
  /** Spoken name when the slide is read as content ("Slide 7 of 53: …"). */
  label?: string;
  /** The teacher's own copy in the editor: the words can be clicked and changed. */
  editing?: SlideEditing;
}

function shapeStyle(shape: TextItem['shape'] | ShapeItem['shape']): CSSProperties {
  if (!shape) return {};
  return {
    background: shape.fill ? `#${shape.fill}` : undefined,
    border: shape.line ? `${pt(shape.line.width)} solid #${shape.line.color}` : undefined,
    borderRadius: shape.kind === 'ellipse' ? '50%' : inch(shape.radius),
    boxSizing: 'border-box',
  };
}

const boxStyle = (b: { x: number; y: number; w: number; h: number }): CSSProperties => ({ position: 'absolute', left: inch(b.x), top: inch(b.y), width: inch(b.w), height: inch(b.h) });

function listIndent(item: TextItem): number {
  const list = item.paragraphs.find((p) => p.list)?.list;
  return list === 'number' ? 30 : list === 'bullet' ? 26 : 0;
}

function Paragraphs({ item }: { item: TextItem }) {
  let n = 0;
  return (
    <div style={item.font === 'head' ? undefined : { transform: `translateY(${BODY_DROP})` }}>
      {item.paragraphs.map((p, i) => {
        const marker = p.list === 'bullet' ? '•' : p.list === 'number' ? `${++n}.` : null;
        const indent = p.list === 'number' ? 30 : p.list === 'bullet' ? 26 : 0;
        return (
          <p key={i} style={{ margin: 0, marginBottom: i < item.paragraphs.length - 1 ? pt(p.spaceAfter) : 0, paddingLeft: indent ? pt(indent) : undefined, position: 'relative' }}>
            {marker && (
              <span aria-hidden="true" style={{ position: 'absolute', left: 0, color: `#${DECK_COLORS.teal}` }}>
                {marker}
              </span>
            )}
            {p.runs.map((r, j) => (
              <span key={j} style={{ fontWeight: r.bold ? 700 : undefined, color: r.color ? `#${r.color}` : undefined }}>
                {r.text}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function textStyle(item: TextItem): CSSProperties {
  const oneLine = ONE_LINE.has(item.name);
  const chip = oneLine && Boolean(item.shape);
  const style: CSSProperties = {
    ...boxStyle(item),
    ...shapeStyle(item.shape),
    display: 'flex',
    flexDirection: 'column',
    justifyContent: item.valign === 'middle' ? 'center' : 'flex-start',
    paddingLeft: chip ? inch(0.16) : pt(item.margin[0]),
    paddingRight: chip ? inch(0.16) : pt(item.margin[1]),
    paddingBottom: pt(item.margin[2]),
    paddingTop: pt(item.margin[3]),
    fontFamily: item.font === 'head' ? HEAD_FONT : BODY_FONT,
    fontSize: pt(item.size),
    // The bundled serif exists in bold only (slide titles are always bold).
    fontWeight: item.bold || item.font === 'head' ? 700 : 400,
    lineHeight: item.font === 'head' ? HEAD_LINE : BODY_LINE,
    color: `#${item.color}`,
    textAlign: item.align,
    letterSpacing: item.spacing ? pt(item.spacing) : undefined,
    whiteSpace: oneLine ? 'nowrap' : 'pre-wrap',
    overflowWrap: 'break-word',
  };
  if (chip) {
    style.width = 'max-content';
    style.minWidth = inch(item.w);
  }
  return style;
}

/** The box a teacher is typing into: same place, font and size as the words it replaces. */
function FieldEditor({ item, dark, editing }: { item: TextItem; dark: boolean; editing: SlideEditing }) {
  const field = item.field!;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => editing.valueOf(field));
  const done = useRef(false);
  const single = field.type !== 'lines';
  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    grow();
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    // Only when the box opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(grow, [value]);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    editing.onCommit(field, value);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      editing.onCancel();
    } else if (e.key === 'Enter' && (single || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };
  const indent = field.type === 'lines' ? listIndent(item) : 0;
  const label = field.type === 'title' ? editing.words.changeTitle : field.type === 'lines' ? editing.words.changeText : editing.words.changeChoice('ABCD'[field.index] ?? '');
  return (
    <div style={textStyle(item)}>
      <textarea
        ref={ref}
        value={value}
        rows={1}
        aria-label={label}
        maxLength={editing.maxLength(field)}
        placeholder={field.type === 'title' ? editing.words.addTitle : field.type === 'lines' ? editing.words.addText : undefined}
        onChange={(e) => setValue(single ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        onPointerDown={(e) => e.stopPropagation()}
        spellCheck
        style={{
          display: 'block',
          width: '100%',
          transform: item.font === 'head' ? undefined : `translateY(${BODY_DROP})`,
          minHeight: single ? undefined : '100%',
          margin: 0,
          padding: 0,
          paddingLeft: indent ? pt(indent) : 0,
          border: 0,
          borderRadius: pt(4),
          outline: `${pt(2.5)} solid #${dark ? DECK_COLORS.yellow : DECK_COLORS.teal}`,
          outlineOffset: pt(5),
          background: dark ? 'rgb(255 255 255 / 0.08)' : 'rgb(255 255 255 / 0.78)',
          font: 'inherit',
          letterSpacing: 'inherit',
          lineHeight: 'inherit',
          color: 'inherit',
          textAlign: 'inherit',
          resize: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function TextBox({ item, dark, editing }: { item: TextItem; dark: boolean; editing?: SlideEditing }) {
  const editable = Boolean(editing && item.field);
  if (editable && sameField(editing!.active, item.field)) return <FieldEditor item={item} dark={dark} editing={editing!} />;
  const empty = item.paragraphs.every((p) => p.runs.every((r) => !r.text.trim()));
  if (!editable) {
    if (empty && !item.shape) return null;
    // The letter on a choice sits on top of the choice's box; a click on it belongs to the choice underneath.
    const badge = Boolean(editing) && item.name.startsWith('choice letter');
    return (
      <div style={badge ? { ...textStyle(item), pointerEvents: 'none' } : textStyle(item)} role={item.titlePlaceholder ? 'heading' : undefined} aria-level={item.titlePlaceholder ? 3 : undefined}>
        <Paragraphs item={item} />
      </div>
    );
  }
  const field = item.field!;
  const words = editing!.words;
  const label = field.type === 'title' ? words.changeTitle : field.type === 'lines' ? words.changeText : words.changeChoice('ABCD'[field.index] ?? '');
  const start = () => editing!.onStart(field);
  return (
    <div
      style={{ ...textStyle(item), cursor: 'text', outlineOffset: pt(5) }}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      data-slide-field={field.type === 'choice' ? `choice-${field.index}` : field.type}
      className={cx('rounded-sm outline-2 hover:outline-dashed', dark ? 'hover:outline-yellow' : 'hover:outline-talaTeal')}
      onClick={(e) => {
        e.stopPropagation();
        start();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          start();
        }
      }}
    >
      {empty ? <p style={{ margin: 0, opacity: 0.45, fontWeight: item.font === 'head' ? 700 : 400 }}>{field.type === 'title' ? words.addTitle : words.addText}</p> : <Paragraphs item={item} />}
    </div>
  );
}

function Picture({ item, mediaUrl, eager, dark }: { item: ImageItem; mediaUrl: (slug: string) => string; eager?: boolean; dark: boolean }) {
  const [failed, setFailed] = useState(false);
  if (item.source.kind === 'brand') {
    return (
      <div style={boxStyle(item)} role="img" aria-label={item.alt}>
        {item.source.mark === 'glyph' ? <GlyphMark color={`#${DECK_COLORS.yellow}`} /> : <WordMark color={`#${dark ? DECK_COLORS.cream : DECK_COLORS.teal}`} accent={`#${DECK_COLORS.yellow}`} />}
      </div>
    );
  }
  const slug = item.source.slug;
  return (
    <div style={{ ...boxStyle(item), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {failed ? (
        // The drawing could not be loaded: say what it shows instead of leaving a broken picture.
        <p style={{ margin: 0, padding: inch(0.2), fontFamily: BODY_FONT, fontSize: pt(13), lineHeight: 1.3, color: `#${DECK_COLORS.muted}`, textAlign: 'center', fontStyle: 'italic' }}>{item.alt}</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl(slug)}
          alt={item.alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          // The whole drawing, never cropped: the Hiraia mark sits in a strip along its bottom edge.
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      )}
    </div>
  );
}

const layoutJson = new WeakMap<SlideLayout, string>();
const jsonOf = (l: SlideLayout) => {
  let s = layoutJson.get(l);
  if (s === undefined) {
    s = JSON.stringify(l);
    layoutJson.set(l, s);
  }
  return s;
};

function SlideViewInner({ layout, number, mediaUrl, className, eager, decorative, label, editing }: SlideViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // Scale the fixed-size slide to the width it was given (set before the first paint, kept on resize). The scale is
  // written straight to the element: a resize must not re-render every thumbnail of a deck.
  useLayoutEffect(() => {
    const el = root.current;
    const c = canvas.current;
    if (!el || !c) return;
    // Until the slide has a width (inside a dialog that is still opening, a tab not shown yet) it stays hidden, so
    // the unscaled 960 px layout is never painted for a frame.
    const fit = (width: number) => {
      if (width <= 0) return;
      c.style.transform = `scale(${width / BASE_W})`;
      c.style.visibility = 'visible';
    };
    fit(el.offsetWidth);
    return watchWidth(el, fit);
  }, []);
  useInsertionEffect(() => {
    if (document.getElementById('tala-slide-fonts')) return;
    const style = document.createElement('style');
    style.id = 'tala-slide-fonts';
    style.textContent = FONT_CSS;
    document.head.appendChild(style);
  }, []);
  const dark = layout.master === 'dark';
  const small: CSSProperties = { position: 'absolute', top: inch(SLIDE_H - 0.48), height: inch(0.3), display: 'flex', alignItems: 'center', fontFamily: BODY_FONT, fontSize: pt(12), lineHeight: BODY_LINE, whiteSpace: 'nowrap' };
  return (
    <div
      ref={root}
      className={cx('relative w-full overflow-hidden select-none', className)}
      style={{ aspectRatio: `${SLIDE_W} / ${SLIDE_H}`, background: `#${layout.background}` }}
      role={decorative ? undefined : 'group'}
      aria-roledescription={decorative ? undefined : 'slide'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-slide-id={layout.id}
    >
      <div
        ref={canvas}
        style={{ position: 'absolute', left: 0, top: 0, width: BASE_W, height: BASE_H, transformOrigin: '0 0', visibility: 'hidden', fontFamily: BODY_FONT, WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%', textRendering: 'geometricPrecision' }}
      >
        {layout.items.map((item, i) =>
          item.type === 'text' ? (
            <TextBox key={`${item.name}-${i}`} item={item} dark={dark} editing={editing} />
          ) : item.type === 'shape' ? (
            <div key={`${item.name}-${i}`} style={{ ...boxStyle(item), ...shapeStyle(item.shape) }} />
          ) : (
            <Picture key={`${item.name}-${i}`} item={item} mediaUrl={mediaUrl} eager={eager} dark={dark} />
          )
        )}
        <div style={{ ...small, left: inch(MARGIN), width: inch(7), color: `#${layout.footer.color}` }}>
          <span style={{ transform: `translateY(${BODY_DROP})` }}>{layout.footer.text}</span>
        </div>
        <div style={{ ...small, left: inch(SLIDE_W - MARGIN - 0.8), width: inch(0.8), justifyContent: 'flex-end', color: `#${layout.numberColor}` }} aria-hidden="true">
          <span style={{ transform: `translateY(${BODY_DROP})` }}>{number}</span>
        </div>
      </div>
    </div>
  );
}

/** Re-drawn only when the slide itself changed (a deck is laid out again on every edit). */
export const SlideView = memo(
  SlideViewInner,
  (a, b) =>
    a.number === b.number &&
    a.eager === b.eager &&
    a.decorative === b.decorative &&
    a.label === b.label &&
    a.className === b.className &&
    a.mediaUrl === b.mediaUrl &&
    a.editing === b.editing &&
    (a.layout === b.layout || jsonOf(a.layout) === jsonOf(b.layout))
);
