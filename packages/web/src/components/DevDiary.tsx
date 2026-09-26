'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import styles from './DevDiary.module.css';

type DiaryImage = { src: string; alt: string; caption: string };
type DiaryEvent = { date: string; day: string; caption: string; images: DiaryImage[] };

const events: DiaryEvent[] = [
  {
    date: '2026-09-04', day: '04', caption: 'Hiraia.org website launches',
    images: [{
      src: '/dev-diary/website-launch.jpg',
      alt: 'BitPinas feature graphic showing Hiraia and its creator speaking into a microphone',
      caption: 'Hiraia featured by BitPinas: an offline AI tutor for budget smartphones.',
    }],
  },
  {
    date: '2026-09-25', day: '25',
    caption: 'First pilot class launched in Calapacuan Elementary School, Zambales',
    images: [
      {
        src: '/dev-diary/calapacuan-launch.jpg',
        alt: 'A speaker presenting Hiraia to a seated audience at Calapacuan Elementary School',
        caption: 'Introducing Hiraia at Calapacuan Elementary School, Zambales.',
      },
      {
        src: '/dev-diary/calapacuan-demo.jpg',
        alt: 'A Hiraia phone demonstration with a group following along on their own phones',
        caption: 'A hands-on Hiraia demonstration during the pilot launch.',
      },
    ],
  },
];

type Point = { x: number; y: number };
type View = Point & { scale: number };
const initialView: View = { x: 0, y: 0, scale: 1 };

function PhotoLightbox({ photo, onClose }: { photo: DiaryImage; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const figure = useRef<HTMLElement>(null);
  const caption = useRef<HTMLElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const current = useRef(initialView);
  const [view, setView] = useState(initialView);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(1);
  const [fit, setFit] = useState({ width: 0, height: 0 });

  // Size the image window to its natural ratio so the caption sits immediately below it,
  // including portrait photos on wide screens and landscape photos on tall phones.
  useEffect(() => {
    const measure = () => {
      const area = figure.current!;
      const availableHeight = Math.max(1, area.clientHeight - caption.current!.offsetHeight - 14);
      const width = Math.min(area.clientWidth, availableHeight * ratio);
      setFit({ width, height: width / ratio });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(figure.current!);
    observer.observe(caption.current!);
    measure();
    return () => observer.disconnect();
  }, [ratio]);

  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    element.querySelector<HTMLButtonElement>('[aria-label="Close photograph"]')?.focus();
    document.body.style.overflow = 'hidden';
    const observer = new ResizeObserver(() => {
      pointers.current.clear();
      current.current = initialView;
      setView(initialView);
    });
    observer.observe(viewport.current!);
    return () => {
      observer.disconnect();
      element.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus({ preventScroll: true });
    };
  }, []);

  // Clamp against the fitted image, not its original dimensions or the viewport alone.
  function update(next: View) {
    const stage = viewport.current;
    const picture = image.current;
    const scale = Math.max(1, Math.min(5, next.scale));
    const maxX = stage && picture ? Math.max(0, (picture.clientWidth * scale - stage.clientWidth) / 2) : 0;
    const maxY = stage && picture ? Math.max(0, (picture.clientHeight * scale - stage.clientHeight) / 2) : 0;
    const bounded = {
      scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
    current.current = bounded;
    setView(bounded);
  }

  function point(e: PointerEvent<HTMLDivElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const before = Array.from(pointers.current.values());
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, point(e));
    const after = Array.from(pointers.current.values());
    const v = current.current;
    if (before.length === 2) {
      const midpoint = (p: Point[]) => ({ x: (p[0]!.x + p[1]!.x) / 2, y: (p[0]!.y + p[1]!.y) / 2 });
      const distance = (p: Point[]) => Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y);
      const oldMid = midpoint(before);
      const newMid = midpoint(after);
      const scale = Math.max(1, Math.min(5, v.scale * distance(after) / Math.max(1, distance(before))));
      const ratio = scale / v.scale;
      update({ scale, x: newMid.x - (oldMid.x - v.x) * ratio, y: newMid.y - (oldMid.y - v.y) * ratio });
    } else if (before.length === 1 && v.scale > 1) {
      update({ ...v, x: v.x + after[0]!.x - before[0]!.x, y: v.y + after[0]!.y - before[0]!.y });
    }
  }

  return (
    <dialog ref={dialog} className={styles.lightbox} aria-label="Dev Diary photograph"
      aria-describedby="diary-photo-caption" onCancel={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.lightboxPanel}>
        <div className={styles.toolbar}>
          <span className={styles.lightboxLabel}>Dev Diary</span>
          <button type="button" aria-label="Zoom out" disabled={view.scale === 1 || failed}
            onClick={() => update({ ...current.current, scale: current.current.scale - 0.5 })}>−</button>
          <button type="button" className={styles.zoomReset} aria-label="Reset image zoom"
            onClick={() => update(initialView)}>{Math.round(view.scale * 100)}%</button>
          <button type="button" aria-label="Zoom in" disabled={view.scale === 5 || failed}
            onClick={() => update({ ...current.current, scale: current.current.scale + 0.5 })}>+</button>
          <button type="button" autoFocus aria-label="Close photograph" onClick={onClose}>×</button>
        </div>
        <figure ref={figure} className={styles.figure}>
          <div ref={viewport} className={styles.imageViewport} tabIndex={0}
            aria-label="Photograph. Pinch to zoom, then drag to move. Arrow keys move a zoomed image."
            style={{ width: fit.width, height: fit.height, cursor: view.scale > 1 ? 'grab' : 'zoom-in' }}
            onPointerDown={(e) => {
              if ((e.pointerType === 'mouse' && e.button !== 0) || pointers.current.size >= 2) return;
              pointers.current.set(e.pointerId, point(e));
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={move}
            onPointerUp={(e) => pointers.current.delete(e.pointerId)}
            onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
            onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}
            onDoubleClick={() => update({ ...initialView, scale: current.current.scale > 1 ? 1 : 2 })}
            onKeyDown={(e) => {
              const delta: Record<string, Point> = {
                ArrowLeft: { x: 48, y: 0 }, ArrowRight: { x: -48, y: 0 },
                ArrowUp: { x: 0, y: 48 }, ArrowDown: { x: 0, y: -48 },
              };
              const movement = delta[e.key];
              if (movement) {
                e.preventDefault();
                update({ ...current.current, x: current.current.x + movement.x, y: current.current.y + movement.y });
              }
            }}>
            {failed ? <p>Image could not load. Close and reopen to try again.</p> : (
              // Keep the original file and aspect ratio; the sepia treatment is thumbnail-only.
              // eslint-disable-next-line @next/next/no-img-element
              <img ref={image} src={photo.src} alt={photo.alt} draggable={false}
                onLoad={(e) => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
                onError={() => setFailed(true)}
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
            )}
          </div>
          <figcaption ref={caption} id="diary-photo-caption" className={styles.photoCaption}>{photo.caption}</figcaption>
        </figure>
        <p className={styles.zoomHint}>Pinch or use + to zoom · Drag to explore · Double-tap to reset</p>
      </div>
    </dialog>
  );
}

export function DevDiary() {
  const track = useRef<HTMLOListElement>(null);
  const [photo, setPhoto] = useState<DiaryImage | null>(null);
  const [position, setPosition] = useState({ atStart: true, atEnd: false });

  useEffect(() => {
    const element = track.current!;
    const measure = () => setPosition({
      atStart: element.scrollLeft < 2,
      atEnd: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2,
    });
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { element.removeEventListener('scroll', measure); observer.disconnect(); };
  }, []);

  function scroll(direction: number) {
    const element = track.current!;
    const item = element.firstElementChild as HTMLElement;
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    element.scrollBy({ left: direction * (item.offsetWidth + gap),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }

  return (
    <section id="dev-diary" aria-labelledby="dev-diary-title" className={styles.diary}>
      <div className={styles.inner}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>Notes from the field · 2026</p>
            <h2 id="dev-diary-title">Dev Diary</h2>
          </div>
          <div className={styles.navigation} aria-label="Timeline navigation">
            <button type="button" aria-label="Earlier events" aria-controls="diary-timeline"
              disabled={position.atStart} onClick={() => scroll(-1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M19 12H5m6-6-6 6 6 6" />
              </svg>
            </button>
            <button type="button" aria-label="Later events" aria-controls="diary-timeline"
              disabled={position.atEnd} onClick={() => scroll(1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 12h14m-6-6 6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
        <ol id="diary-timeline" ref={track} className={styles.timeline} tabIndex={0} aria-label="Hiraia milestones">
          {events.map((event) => (
            <li key={event.date} className={styles.event}>
              <time dateTime={event.date} className={styles.date}>
                <span>September</span><span className={styles.day}>{event.day}</span>
              </time>
              <div className={styles.eventBody}>
                <h3>{event.caption}</h3>
                <div className={styles.photos}>
                  {event.images.map((item) => (
                    <figure key={item.src}>
                      <button type="button" className={styles.thumbnail} onClick={() => setPhoto(item)}
                        aria-label={`View full-color image: ${item.caption}`} aria-haspopup="dialog">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.src} alt={item.alt} loading="lazy" decoding="async" width={800} height={600} />
                        <span className={styles.expand} aria-hidden="true">↗</span>
                      </button>
                      <figcaption className={styles.thumbnailCaption}>{item.caption}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      {photo && <PhotoLightbox photo={photo} onClose={() => setPhoto(null)} />}
    </section>
  );
}
