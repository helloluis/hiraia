'use client';
/**
 * Editorial building blocks for the reading pages (library, packs, This Week): a page should read like a well laid
 * out magazine, where size says importance — small-caps kicker, serif headline, a larger lead, then calm body text —
 * and where pictures, icons and white space do the separating instead of boxes inside boxes.
 * Colours are theme tokens only (tints are a token at reduced opacity).
 */
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { BigIdeaBulb, Icon, type IconName } from './icons';
import { cx } from './ui';

export type Tint = 'plain' | 'yellow' | 'sage' | 'teal' | 'brick' | 'forest';
const TINT: Record<Tint, string> = {
  plain: 'bg-white',
  yellow: 'bg-yellow/20',
  sage: 'bg-sage/20',
  teal: 'bg-talaTeal/10',
  brick: 'bg-brick/10',
  forest: 'bg-forest text-cream',
};
const TINT_ICON: Record<Tint, string> = {
  plain: 'bg-cream text-forest',
  yellow: 'bg-yellow/40 text-forest',
  sage: 'bg-sage/40 text-forest',
  teal: 'bg-talaTeal/15 text-talaTeal',
  brick: 'bg-brick/15 text-brick',
  forest: 'bg-cream/15 text-yellow',
};

/** Small-caps label above a headline: says what kind of thing follows. */
export function Kicker({ icon, children, className }: { icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <p className={cx('kicker flex items-center gap-1.5 text-talaTeal', className)}>
      {icon && <Icon name={icon} size={15} strokeWidth={2.1} />}
      <span>{children}</span>
    </p>
  );
}

/** An icon on a soft round tint: the one visual anchor of a block. */
export function IconBadge({ name, tint = 'teal', size = 40 }: { name: IconName; tint?: Tint; size?: number }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full', TINT_ICON[tint])} style={{ width: size, height: size }}>
      <Icon name={name} size={Math.round(size * 0.52)} />
    </span>
  );
}

/** Section heading with its icon; the rule above separates sections without boxing them. */
export function SectionHead({
  icon,
  title,
  kicker,
  aside,
  id,
  tint = 'teal',
  rule = true,
}: {
  icon?: IconName;
  title: ReactNode;
  kicker?: ReactNode;
  aside?: ReactNode;
  id?: string;
  tint?: Tint;
  rule?: boolean;
}) {
  return (
    <div className={cx('flex items-center gap-3', rule && 'border-t border-hairline pt-6')}>
      {icon && <IconBadge name={icon} tint={tint} />}
      <div className="min-w-0 flex-1">
        {kicker && <p className="kicker text-forestMuted">{kicker}</p>}
        <h2 id={id} className="text-headline break-words">
          {title}
        </h2>
      </div>
      {aside}
    </div>
  );
}

/** A tinted block for one idea that must stand out from the body text. */
export function Callout({
  tint = 'teal',
  icon,
  title,
  children,
  className,
}: {
  tint?: Tint;
  icon?: IconName;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const iconTone = tint === 'brick' ? 'text-brick' : tint === 'forest' ? 'text-yellow' : 'text-talaTeal';
  // A note with an icon but no heading: the icon sits beside the words, not on a line of its own.
  if (icon && !title)
    return (
      <div className={cx('flex gap-3 rounded-lg px-4 py-4 wide:px-5', TINT[tint], className)}>
        <Icon name={icon} size={20} strokeWidth={2} className={cx('mt-0.5', iconTone)} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  return (
    <div className={cx('rounded-lg px-4 py-4 wide:px-5', TINT[tint], className)}>
      {(icon || title) && (
        <p className="mb-1.5 flex items-center gap-2 font-semibold">
          {icon && <Icon name={icon} size={18} strokeWidth={2} className={iconTone} />}
          <span>{title}</span>
        </p>
      )}
      {children}
    </div>
  );
}

/** The week's Big Idea: the one sentence to remember, set large, with the lightbulb. */
export function BigIdea({ label, idea, children }: { label: string; idea: string; children?: ReactNode }) {
  return (
    <section aria-label={label} className="relative overflow-hidden rounded-xl bg-yellow/20 px-5 py-6 wide:px-8 wide:py-8">
      <div className="flex flex-col gap-4 wide:flex-row wide:items-start wide:gap-6">
        <BigIdeaBulb size={72} className="wide:mt-1" />
        <div className="min-w-0">
          <p className="kicker text-forest">{label}</p>
          <p className="mt-2 font-display text-quote text-forest break-words">{idea}</p>
          {children && <div className="reading mt-3 max-w-measure text-forest">{children}</div>}
        </div>
      </div>
    </section>
  );
}

/** Collapsible section (native <details>: keyboard and screen-reader behaviour for free). */
export function Disclosure({
  summary,
  hint,
  icon,
  children,
  defaultOpen,
  className,
  onToggle,
  open,
}: {
  summary: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  /** Controlled use: pass `open` and handle `onToggle`. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  return (
    <details
      className={cx('disclosure group', className)}
      open={open ?? defaultOpen}
      onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}
    >
      <summary className="flex min-h-touch items-center gap-3 rounded py-2">
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold break-words">{summary}</span>
          {hint && <span className="block text-small text-forestMuted break-words">{hint}</span>}
        </span>
        <Icon name="chevronDown" size={20} className="disclosure-chevron text-forestMuted" />
      </summary>
      <div className="pb-3 pt-1">{children}</div>
    </details>
  );
}

/** A few choices as one control (language, original / my copy, tabs). Radio-group semantics. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  className,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: IconName; disabled?: boolean; title?: string }>;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex max-w-full rounded-full bg-forest/10 p-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 rounded-full font-medium disabled:opacity-45 disabled:cursor-not-allowed',
              size === 'sm' ? 'min-h-[2.5rem] px-3 text-small' : 'min-h-[2.75rem] px-4 text-body',
              on ? 'bg-white text-forest shadow-card' : 'text-forest/80 hover:text-forest'
            )}
          >
            {o.icon && <Icon name={o.icon} size={size === 'sm' ? 16 : 18} />}
            <span className="whitespace-nowrap">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Underlined tabs for the big sections of a page (Lessons, Slides, Teacher guide). */
export function TabBar<T extends string>({
  label,
  value,
  tabs,
  onChange,
  idBase,
}: {
  label: string;
  value: T;
  tabs: Array<{ value: T; label: string; icon: IconName; count?: ReactNode }>;
  onChange: (v: T) => void;
  idBase: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="strip flex gap-1 border-b border-hairline">
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            id={`${idBase}-tab-${t.value}`}
            aria-selected={on}
            aria-controls={`${idBase}-panel-${t.value}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = tabs.findIndex((x) => x.value === value);
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
              onChange(next.value);
              requestAnimationFrame(() => document.getElementById(`${idBase}-tab-${next.value}`)?.focus());
            }}
            className={cx(
              '-mb-px inline-flex min-h-touch shrink-0 items-center gap-2 border-b-[3px] px-3 text-body wide:px-4',
              on ? 'border-talaTeal font-semibold text-forest' : 'border-transparent text-forestMuted hover:text-forest'
            )}
          >
            <Icon name={t.icon} size={20} className={on ? 'text-talaTeal' : undefined} />
            <span className="whitespace-nowrap">{t.label}</span>
            {t.count !== undefined && <span className="rounded-full bg-forest/10 px-2 text-small font-medium">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Honest status of a pack or a copy, always an icon and words (never colour alone). */
export function StatusChip({ tone, icon, children }: { tone: 'ready' | 'draft' | 'fix' | 'quiet' | 'mine'; icon?: IconName; children: ReactNode }) {
  const cls = {
    ready: 'bg-sage/35 text-forest',
    draft: 'bg-yellow/35 text-forest',
    fix: 'bg-brick/10 text-brick',
    quiet: 'bg-forest/10 text-forestMuted',
    mine: 'bg-talaTeal/15 text-talaTeal',
  }[tone];
  const fallback: IconName = tone === 'ready' ? 'checkCircle' : tone === 'fix' ? 'alert' : tone === 'mine' ? 'pencil' : tone === 'draft' ? 'info' : 'clock';
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-small font-medium leading-none', cls)}>
      <Icon name={icon ?? fallback} size={14} strokeWidth={2.1} />
      <span className="whitespace-nowrap">{children}</span>
    </span>
  );
}

/** Icon-and-words facts in a row (time, slides, language…). */
export function Facts({ items, className }: { items: Array<{ icon: IconName; text: ReactNode } | null | false>; className?: string }) {
  return (
    <ul className={cx('flex flex-wrap gap-x-4 gap-y-1.5 text-small text-forestMuted', className)}>
      {items.filter(Boolean).map((it, i) => (
        <li key={i} className="inline-flex items-center gap-1.5">
          <Icon name={(it as { icon: IconName }).icon} size={16} />
          <span>{(it as { text: ReactNode }).text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A Hiraia drawing on its white plate (the drawing keeps its Hiraia mark; nothing is cropped). */
export function Plate({ src, alt, className, eager }: { src: string; alt: string; className?: string; eager?: boolean }) {
  return (
    <span className={cx('flex items-center justify-center overflow-hidden rounded-lg border border-hairline bg-white p-3', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" className="max-h-full max-w-full object-contain" />
    </span>
  );
}

/** A link that reads as a sentence with an arrow: the quiet way to move on. */
export function ArrowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cx('group inline-flex min-h-touch items-center gap-1.5 font-medium text-talaTeal underline-offset-4 hover:underline', className)}>
      <span>{children}</span>
      <Icon name="arrowRight" size={18} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** A stable id for aria wiring. */
export function useDomId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}
