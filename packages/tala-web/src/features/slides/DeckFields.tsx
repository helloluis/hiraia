'use client';
/**
 * The plain fields of the slide editor: the path that always works, and the main one on a phone. Each field writes
 * straight into the slide; the picture of the slide above follows as the teacher types.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { DECK_LIMITS } from '@hiraia/tala-core/contracts';
import type { DeckSlide } from '@hiraia/tala-core/contracts';
import type { SlideLayout } from '@hiraia/tala-core/decks';
import { useT } from '@/i18n';
import { Callout } from '@/components/editorial';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { checkOfReveal, isLocked, revealOfCheck } from './deck-model';

const FIELD = 'w-full rounded border border-hairline bg-white px-3 py-2.5 text-body text-forest placeholder:text-forestMuted/70 focus:border-talaTeal';

/** A text box that grows with its words (no inner scrollbar, no fixed height to fight with). */
function GrowArea({ value, minRows = 1, className, ...rest }: { value: string; minRows?: number } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} value={value} rows={minRows} className={cx(FIELD, 'block resize-none overflow-hidden leading-snug', className)} {...rest} />;
}

function Group({ icon, title, hint, children, id }: { icon: IconName; title: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div>
        <h3 id={id} className="flex items-center gap-2 font-semibold text-forest">
          <Icon name={icon} size={18} className="text-talaTeal" />
          {title}
        </h3>
        {hint && <p className="text-small text-forestMuted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-forestMuted hover:bg-cream hover:text-brick">
      <Icon name="x" size={18} />
    </button>
  );
}

function AddButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex min-h-touch items-center gap-2 self-start rounded px-2 font-medium text-talaTeal hover:bg-talaTeal/10 disabled:opacity-40">
      <Icon name="plus" size={18} />
      {children}
    </button>
  );
}

const focusSoon = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

/** One line per point; Enter adds a line, Backspace on an empty line removes it. */
function LinesEditor({ slideId, lines, numbered, onChange }: { slideId: string; lines: string[]; numbered: boolean; onChange: (lines: string[]) => void }) {
  const { t } = useT();
  const rows = lines.length ? lines : [''];
  const id = (i: number) => `f-${slideId}-line-${i}`;
  const set = (i: number, v: string) => onChange(rows.map((l, j) => (j === i ? v.replace(/\n/g, ' ') : l)));
  const add = (after: number) => {
    if (rows.length >= DECK_LIMITS.lines) return;
    const next = rows.slice();
    next.splice(after + 1, 0, '');
    onChange(next);
    focusSoon(id(after + 1));
  };
  const remove = (i: number) => {
    onChange(rows.filter((_, j) => j !== i));
    focusSoon(id(Math.max(0, i - 1)));
  };
  const onKey = (i: number) => (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(i);
    } else if (e.key === 'Backspace' && rows[i] === '' && rows.length > 1) {
      e.preventDefault();
      remove(i);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <ol className="flex flex-col gap-1.5">
        {rows.map((line, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span aria-hidden="true" className="mt-2.5 w-5 shrink-0 text-right font-semibold tabular-nums text-talaTeal">
              {numbered ? `${i + 1}.` : '•'}
            </span>
            <GrowArea id={id(i)} value={line} aria-label={t('sl.ed.f.line', { n: i + 1 })} placeholder={t('sl.ed.f.linePlaceholder')} maxLength={DECK_LIMITS.line} onChange={(e) => set(i, e.target.value)} onKeyDown={onKey(i)} />
            {rows.length > 1 || line ? <RemoveButton label={t('sl.ed.f.removeLine', { n: i + 1 })} onClick={() => (rows.length > 1 ? remove(i) : onChange([]))} /> : <span className="w-11 shrink-0" />}
          </li>
        ))}
      </ol>
      <AddButton onClick={() => add(rows.length - 1)} disabled={rows.length >= DECK_LIMITS.lines}>
        {t('sl.ed.f.addLine')}
      </AddButton>
    </div>
  );
}

/** "word — meaning", the way the slide prints new words (same rule as the slide layout). */
interface WordRow {
  term: string;
  meaning: string;
}
const splitWord = (line: string): WordRow => {
  const m = line.match(/^(.{1,40}?)\s*(?:—|–|-|:)\s+(.*)$/);
  if (m) return { term: m[1]!, meaning: m[2]! };
  const bare = line.match(/^(.{1,40}?)\s*(?:—|–)\s*$/);
  return bare ? { term: bare[1]!, meaning: '' } : { term: '', meaning: line };
};
const joinWord = (r: WordRow) => (r.term.trim() ? `${r.term.trim()} — ${r.meaning.trim()}` : r.meaning.trim());
const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Two boxes per row. What is being typed is kept here (so a space at the end of a word is not lost while typing);
 * the slide gets the joined "word — meaning" lines. A change from outside (undo, typing on the slide) reloads it.
 */
function WordsEditor({ slideId, lines, onChange }: { slideId: string; lines: string[]; onChange: (lines: string[]) => void }) {
  const { t } = useT();
  const [rows, setRows] = useState<WordRow[]>(() => (lines.length ? lines : ['']).map(splitWord));
  const sent = useRef(lines);
  useEffect(() => {
    if (sameLines(lines, sent.current)) return;
    sent.current = lines;
    setRows((lines.length ? lines : ['']).map(splitWord));
  }, [lines]);
  const push = (next: WordRow[]) => {
    setRows(next.length ? next : [{ term: '', meaning: '' }]);
    const out = next.map(joinWord);
    sent.current = out;
    onChange(out);
  };
  const id = (i: number) => `f-${slideId}-line-${i}`;
  const set = (i: number, patch: Partial<WordRow>) => push(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    if (rows.length >= DECK_LIMITS.lines) return;
    push([...rows, { term: '', meaning: '' }]);
    focusSoon(id(rows.length));
  };
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <div className="grid min-w-0 flex-1 gap-1.5 min-[420px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <input
                id={id(i)}
                value={r.term}
                aria-label={t('sl.ed.f.word', { n: i + 1 })}
                placeholder={t('sl.ed.f.wordPlaceholder')}
                maxLength={40}
                onChange={(e) => set(i, { term: e.target.value.replace(/[—–:\n]/g, ' ') })}
                className={cx(FIELD, 'min-h-touch font-semibold text-talaTeal')}
              />
              <GrowArea value={r.meaning} aria-label={t('sl.ed.f.meaning', { n: i + 1 })} placeholder={t('sl.ed.f.meaningPlaceholder')} maxLength={DECK_LIMITS.line - 44} onChange={(e) => set(i, { meaning: e.target.value.replace(/\n/g, ' ') })} />
            </div>
            <RemoveButton label={t('sl.ed.f.removeWord', { n: i + 1 })} onClick={() => push(rows.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ol>
      <AddButton onClick={add} disabled={rows.length >= DECK_LIMITS.lines}>
        {t('sl.ed.f.addWord')}
      </AddButton>
    </div>
  );
}

function ChoicesEditor({
  slideId,
  choices,
  correct,
  canMark,
  editable,
  onChange,
  onCorrect,
}: {
  slideId: string;
  choices: string[];
  /** Index of the choice marked right on the answer slide, if there is one. */
  correct: number | null;
  canMark: boolean;
  /** False on an answer slide: the words belong to the question slide. */
  editable: boolean;
  onChange?: (choices: string[]) => void;
  onCorrect: (index: number) => void;
}) {
  const { t } = useT();
  const letter = (i: number) => 'ABCD'[i] ?? '';
  return (
    <div className="flex flex-col gap-1.5">
      <ol className="flex flex-col gap-1.5">
        {choices.map((c, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span aria-hidden="true" className={cx('mt-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold', correct === i ? 'bg-talaTeal text-white' : 'bg-talaTeal/15 text-talaTeal')}>
              {letter(i)}
            </span>
            {editable ? (
              <GrowArea
                id={`f-${slideId}-choice-${i}`}
                value={c}
                aria-label={t('sl.ed.f.choice', { letter: letter(i) })}
                maxLength={DECK_LIMITS.choice}
                onChange={(e) => onChange?.(choices.map((x, j) => (j === i ? e.target.value.replace(/\n/g, ' ') : x)))}
              />
            ) : (
              <p className="min-w-0 flex-1 break-words py-2.5">{c}</p>
            )}
            {canMark && (
              <label className="mt-1 inline-flex shrink-0 cursor-pointer items-center" title={t('sl.ed.f.markCorrect', { letter: letter(i) })}>
                <input type="radio" name={`correct-${slideId}`} className="peer sr-only" checked={correct === i} onChange={() => onCorrect(i)} aria-label={t('sl.ed.f.markCorrect', { letter: letter(i) })} />
                <span
                  className={cx(
                    'inline-flex h-10 items-center gap-1 rounded-full border px-2.5 text-small font-semibold peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-talaTeal',
                    correct === i ? 'border-talaTeal bg-talaTeal text-white' : 'border-hairline bg-white text-forestMuted hover:border-talaTeal hover:text-talaTeal'
                  )}
                >
                  <Icon name="check" size={16} strokeWidth={2.4} />
                  {correct === i && <span>{t('sl.ed.f.correctShort')}</span>}
                </span>
              </label>
            )}
            {editable && <RemoveButton label={t('sl.ed.f.removeChoice', { letter: letter(i) })} onClick={() => onChange?.(choices.filter((_, j) => j !== i))} />}
          </li>
        ))}
      </ol>
      {editable && (
        <AddButton
          onClick={() => {
            onChange?.([...choices, '']);
            focusSoon(`f-${slideId}-choice-${choices.length}`);
          }}
          disabled={choices.length >= DECK_LIMITS.choices}
        >
          {t('sl.ed.f.addChoice')}
        </AddButton>
      )}
    </div>
  );
}

export function DeckFields({
  slide,
  slides,
  layout,
  onPatch,
  onChoices,
  onCorrect,
  onGoTo,
}: {
  slide: DeckSlide;
  slides: DeckSlide[];
  layout: SlideLayout | undefined;
  /** `tag` folds a run of typing in one field into one undo step. */
  onPatch: (patch: Partial<DeckSlide>, tag: string) => void;
  onChoices: (checkId: string, choices: string[]) => void;
  onCorrect: (checkId: string, index: number) => void;
  onGoTo: (slideId: string) => void;
}) {
  const { t } = useT();
  if (isLocked(slide))
    return (
      <Callout tint="plain" icon="lock" className="border border-hairline">
        <p>{t('sl.ed.locked')}</p>
      </Callout>
    );
  const k = slide.kind;
  const numbered = k === 'activity' || k === 'summary';
  const reveal = k === 'check' || k === 'question' ? revealOfCheck(slides, slide.id) : null;
  const check = k === 'reveal' ? checkOfReveal(slides, slide) : null;
  const hasChoices = (k === 'check' || k === 'question') && (slide.choices.length > 0 || k === 'check');
  const base = `f-${slide.id}`;
  return (
    <div className="flex flex-col gap-5">
      {layout?.crowded && (
        <Callout tint="yellow" icon="alert">
          <p className="text-small">{t('sl.ed.crowded')}</p>
        </Callout>
      )}
      <Group icon="eye" title={t('sl.ed.onSlide')} id={`${base}-on`}>
        <label className="flex flex-col gap-1">
          <span className="text-small font-medium text-forestMuted">{t('sl.ed.f.title')}</span>
          <GrowArea id={`${base}-title`} value={slide.title} maxLength={DECK_LIMITS.title} placeholder={t('sl.ed.f.titlePlaceholder')} className="font-display text-title" onChange={(e) => onPatch({ title: e.target.value.replace(/\n/g, ' ') }, `title:${slide.id}`)} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-small font-medium text-forestMuted">{k === 'vocabulary' ? t('sl.ed.f.words') : k === 'reveal' ? t('sl.ed.f.explain') : numbered ? t('sl.ed.f.steps') : t('sl.ed.f.text')}</span>
          {k === 'vocabulary' ? (
            <WordsEditor slideId={slide.id} lines={slide.lines} onChange={(lines) => onPatch({ lines }, `lines:${slide.id}`)} />
          ) : (
            <>
              <LinesEditor slideId={slide.id} lines={slide.lines} numbered={numbered} onChange={(lines) => onPatch({ lines }, `lines:${slide.id}`)} />
              <p className="text-small text-forestMuted">{numbered ? t('sl.ed.f.stepsHint') : t('sl.ed.f.textHint')}</p>
            </>
          )}
        </div>
        {hasChoices && (
          <div className="flex flex-col gap-1">
            <span className="text-small font-medium text-forestMuted">{t('sl.ed.f.choices')}</span>
            <ChoicesEditor slideId={slide.id} choices={slide.choices} correct={reveal?.correctChoice ?? null} canMark={Boolean(reveal)} editable onChange={(c) => onChoices(slide.id, c)} onCorrect={(i) => onCorrect(slide.id, i)} />
            <p className="text-small text-forestMuted">{reveal ? t('sl.ed.f.correctHint') : slide.choices.length ? t('sl.ed.f.noAnswerSlide') : ''}</p>
          </div>
        )}
        {k === 'reveal' && check && check.choices.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-small font-medium text-forestMuted">{t('sl.ed.f.correct')}</span>
            <ChoicesEditor slideId={slide.id} choices={check.choices} correct={slide.correctChoice} canMark editable={false} onCorrect={(i) => onCorrect(check.id, i)} />
            <p className="text-small text-forestMuted">{t('sl.ed.f.revealChoices')}</p>
            <button type="button" onClick={() => onGoTo(check.id)} className="inline-flex min-h-touch items-center gap-2 self-start rounded px-2 font-medium text-talaTeal hover:bg-talaTeal/10">
              <Icon name="arrowLeft" size={18} />
              {t('sl.ed.f.goToQuestion')}
            </button>
          </div>
        )}
      </Group>
      <Group icon="notes" title={t('sl.ed.f.notes')} hint={t('sl.ed.f.notesHint')} id={`${base}-notes-h`}>
        <GrowArea id={`${base}-notes`} aria-labelledby={`${base}-notes-h`} value={slide.notes} minRows={4} maxLength={DECK_LIMITS.notes} placeholder={t('sl.ed.f.notesPlaceholder')} className="reading" onChange={(e) => onPatch({ notes: e.target.value }, `notes:${slide.id}`)} />
      </Group>
    </div>
  );
}
