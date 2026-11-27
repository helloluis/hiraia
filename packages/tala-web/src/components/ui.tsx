'use client';
/**
 * The design system: a handful of plain components on the Hiraia tokens. No UI kit (PRD §18.3).
 * Button, Field, ListRow, Sheet, Banner, Placeholder, PageHeader, EmptyState, Badge, Toast.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import Link from 'next/link';
import { useT } from '@/i18n';
import { HiraiaGlyph } from './Brand';
import { Icon, type IconName } from './icons';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Button ---------- */

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'ai';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-talaTeal text-white border-talaTeal hover:brightness-95',
  secondary: 'bg-white text-forest border-forest hover:bg-cream',
  quiet: 'bg-transparent text-talaTealText border-transparent underline-offset-2 hover:underline',
  danger: 'bg-white text-brick border-brick hover:bg-cream',
  /** AI actions (draft, rewrite): one obvious style everywhere — strong teal outline, sparkle, white fill. */
  ai: 'bg-white text-talaTealText border-2 border-talaTeal font-semibold hover:bg-talaTeal/10',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', full, busy, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 min-h-touch px-4 py-2 rounded border text-body font-medium',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        VARIANT[variant],
        full && 'w-full',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  variant = 'secondary',
  full,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  full?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex items-center justify-center gap-2 min-h-touch px-4 py-2 rounded border text-body font-medium',
        VARIANT[variant],
        full && 'w-full',
        className
      )}
    >
      {children}
    </Link>
  );
}

/* ---------- Field ---------- */

interface FieldBase {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
}
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  id,
}: FieldBase & {
  children: (id: string, describedBy: string | undefined) => ReactNode;
  id?: string;
}) {
  const { t } = useT();
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fid} className="font-medium">
        {label}
        {optional && <span className="font-normal text-forestMuted"> {t('common.optional')}</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-small text-forestMuted">
          {hint}
        </p>
      )}
      {children(fid, describedBy)}
      {error && (
        <p id={errId} role="alert" className="flex items-start gap-1.5 text-small text-brick">
          <Icon name="alert" size={16} strokeWidth={2} className="mt-0.5" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

const inputCls =
  'w-full min-h-touch rounded border border-hairline bg-white px-3 py-2 text-body text-forest placeholder:text-forestMuted aria-[invalid=true]:border-brick';

export function TextInput({
  label,
  hint,
  error,
  optional,
  className,
  ...rest
}: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {(id, describedBy) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(inputCls, className)}
          {...rest}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  optional,
  className,
  ...rest
}: FieldBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {(id, describedBy) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(inputCls, 'min-h-[6rem]', className)}
          {...rest}
        />
      )}
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  optional,
  className,
  children,
  ...rest
}: FieldBase & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-describedby={describedBy}
          className={cx(inputCls, className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 min-h-touch cursor-pointer">
      <input
        type="checkbox"
        className="h-6 w-6 accent-talaTeal"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 min-h-touch py-2 text-left"
    >
      <span className="min-w-0 flex-1 break-words">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-small text-forestMuted">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-block h-7 w-12 shrink-0 rounded-full border transition-none',
          checked ? 'bg-talaTeal border-talaTeal' : 'bg-white border-hairline'
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-6 w-6 rounded-full bg-white border border-hairline',
            checked ? 'right-0.5' : 'left-0.5'
          )}
        />
      </span>
    </button>
  );
}

/** Segmented single choice as large buttons (used instead of radios for 48 dp targets). */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium mb-1">{label}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={cx(
            'flex items-start gap-3 min-h-touch rounded border bg-white px-3 py-2 cursor-pointer',
            value === o.value ? 'border-talaTeal ring-2 ring-talaTeal' : 'border-hairline'
          )}
        >
          <input
            type="radio"
            name={label}
            className="mt-1.5 h-5 w-5 accent-talaTeal"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>
            <span className="block">{o.label}</span>
            {o.hint && <span className="block text-small text-forestMuted">{o.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/* ---------- ListRow ---------- */

export function ListRow({
  title,
  subtitle,
  trailing,
  href,
  onClick,
  leading,
  current,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  leading?: ReactNode;
  current?: boolean;
}) {
  const inner = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block break-words [overflow-wrap:anywhere]">{title}</span>
        {subtitle && (
          <span className="block text-small text-forestMuted break-words">{subtitle}</span>
        )}
      </span>
      {trailing && <span className="shrink-0 text-small">{trailing}</span>}
    </>
  );
  const cls = cx(
    'flex w-full items-center gap-3 min-h-touch px-4 py-3 text-left bg-white border-b border-hairline last:border-b-0',
    (href || onClick) && 'hover:bg-cream',
    current && 'border-l-4 border-l-talaTeal'
  );
  if (href) {
    return (
      <Link href={href} className={cls} aria-current={current ? 'true' : undefined}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded border border-hairline bg-white overflow-hidden', className)}>
      {children}
    </div>
  );
}

/* ---------- Badge ---------- */

export type Tone = 'neutral' | 'teal' | 'sage' | 'brick' | 'gold';
const TONE: Record<Tone, string> = {
  neutral: 'bg-cream text-forest border-hairline',
  teal: 'bg-talaTeal text-white border-talaTeal',
  sage: 'bg-sage text-forest border-sage',
  brick: 'bg-brick text-white border-brick',
  gold: 'bg-yellow text-forest border-yellow',
};
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-block rounded-sm border px-2 py-0.5 text-small whitespace-nowrap',
        TONE[tone]
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Banner ---------- */

const BANNER: Record<'info' | 'warn' | 'error' | 'success', string> = {
  info: 'bg-white border-talaTeal',
  warn: 'bg-white border-yellow',
  error: 'bg-white border-brick text-brick',
  success: 'bg-white border-sage',
};
const BANNER_ICON: Record<'info' | 'warn' | 'error' | 'success', IconName> = { info: 'info', warn: 'alert', error: 'alert', success: 'checkCircle' };
export function Banner({
  kind = 'info',
  children,
  action,
}: {
  kind?: keyof typeof BANNER;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex flex-wrap items-center gap-3 rounded border-l-4 border px-3 py-2',
        BANNER[kind]
      )}
    >
      <Icon name={BANNER_ICON[kind]} size={20} />
      <span className="flex-1 basis-48 min-w-0 break-words">{children}</span>
      {action}
    </div>
  );
}

/* ---------- Placeholder rows (RES-2) ---------- */

export function Placeholder({ rows = 3, label }: { rows?: number; label?: string }) {
  const { t } = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label ?? t('common.loading')}
      className="flex flex-col gap-2"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="placeholder h-12" />
      ))}
    </div>
  );
}

/* ---------- Page header: one title, at most one primary action ---------- */

export function PageHeader({
  title,
  action,
  back,
  subtitle,
}: {
  title: ReactNode;
  action?: ReactNode;
  back?: { href: string; label: string };
  subtitle?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2 mb-4">
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 min-h-touch font-medium text-talaTealText self-start"
        >
          <Icon name="arrowLeft" size={18} />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* The title takes the free width and wraps; the actions move below it when the row is too narrow. */}
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-display break-words [overflow-wrap:anywhere] min-w-0">{title}</h1>
          {subtitle && <p className="text-forestMuted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

export function SectionTitle({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mt-6 mb-2">
      <h2 className="text-title">{children}</h2>
      {trailing}
    </div>
  );
}

/* ---------- Empty state: one sentence, one action (SIMPLE-10) ---------- */

/** `art`: a drawing from /public/art instead of the glyph (`board` for "no class yet", `shelf` for "nothing here"). */
export function EmptyState({
  children,
  action,
  art,
  heading,
}: {
  children: ReactNode;
  action?: ReactNode;
  art?: 'board' | 'shelf';
  heading?: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="rounded-[1.25rem] border border-hairline bg-white px-5 py-8 text-center flex flex-col items-center gap-4">
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={art === 'board' ? '/art/class-board.webp' : '/art/empty-shelf.webp'}
          alt=""
          width={320}
          height={320}
          loading="lazy"
          className="h-36 w-36 object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="relative inline-flex h-20 w-20 items-center justify-center rounded-full bg-cream"
        >
          <span className="absolute -left-2 top-3 h-3 w-3 rounded-full bg-yellow" />
          <span className="absolute right-0 -bottom-1 h-4 w-4 rounded-sm rotate-12 bg-sage" />
          <HiraiaGlyph size={40} title="" />
        </span>
      )}
      <p className="font-display text-title">{heading ?? t('empty.heading')}</p>
      <p className="max-w-[28rem] text-forestMuted">{children}</p>
      {action}
    </div>
  );
}

/* ---------- Sheet (dialog). Bottom sheet on phones, centred on wide screens. ---------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useT();
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside its content) cancels.
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby={open ? titleId : undefined}
      className="m-0 w-full max-w-full bg-white text-forest rounded-t p-0 fixed bottom-0 top-auto translate-x-0 wide:bottom-auto wide:top-1/2 wide:left-1/2 wide:-translate-x-1/2 wide:-translate-y-1/2 wide:max-w-[36rem] wide:rounded backdrop:bg-forest/50 max-h-[90dvh] overflow-y-auto"
    >
      {open && (
        <div className="p-4 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-title">
              {title}
            </h2>
            <Button variant="quiet" onClick={onClose} aria-label={t('common.close')}>
              <Icon name="x" size={22} />
            </Button>
          </div>
          <div className="flex flex-col gap-3">{children}</div>
          {actions && (
            <div className="flex flex-col-reverse wide:flex-row wide:justify-end gap-2 pt-2">
              {actions}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

/* ---------- Toast with optional Undo (SIMPLE-11) ---------- */

export function Toast({
  message,
  onUndo,
  onDone,
}: {
  message: string | null;
  onUndo?: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDone, onUndo ? 8000 : 4000);
    return () => clearTimeout(id);
  }, [message, onDone, onUndo]);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed bottom-20 wide:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded bg-forest text-cream px-4 py-3 shadow max-w-[calc(100vw-2rem)]"
    >
      <span>{message}</span>
      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          className="min-h-touch px-2 font-medium text-yellow underline"
        >
          {t('common.undo')}
        </button>
      )}
    </div>
  );
}

/** A wait longer than a second shows what is happening and a Cancel (RES-3). */
export function Waiting({ label, onCancel }: { label: string; onCancel?: () => void }) {
  const { t } = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded border border-hairline bg-white px-3 py-2"
    >
      <span className="placeholder h-5 w-5 rounded-full" aria-hidden="true" />
      <span className="flex-1">{label}</span>
      {onCancel && (
        <Button variant="quiet" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      )}
    </div>
  );
}

/** Sparkle mark for AI actions. */
export function Sparkle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2zm7 11l.9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM5 14l.7 2 2 .7-2 .7L5 19.5l-.7-2.1-2-.7 2-.7L5 14z" />
    </svg>
  );
}

/** Bold reorder arrow: 44 px target, thick chevron, clear hover / active / focus / disabled states. */
export function ArrowButton({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: 'up' | 'down';
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-11 w-11 items-center justify-center rounded border-2 border-forest bg-white text-forest hover:bg-cream active:bg-hairline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-talaTeal disabled:border-hairline disabled:text-forestMuted/50 disabled:bg-white disabled:cursor-not-allowed"
    >
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {direction === 'up' ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
      </svg>
    </button>
  );
}
