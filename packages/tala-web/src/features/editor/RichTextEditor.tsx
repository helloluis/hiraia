'use client';
/**
 * Simple formatted text editor (PLAN-2): paragraphs, bold, italic, bulleted and numbered lists. A contenteditable
 * whose DOM is reduced to the Block model on every input; no editor library (size budget, §18.3).
 */
import { useCallback, useEffect, useId, useRef } from 'react';
import type { RichText } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { cx } from '@/components/ui';
import { domToRichText, richTextEquals, richTextToHtml } from './richtext-dom';

export interface RichTextEditorProps {
  value: RichText;
  onChange: (next: RichText) => void;
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  minRows?: number;
}

export function RichTextEditor({ value, onChange, label, placeholder, readOnly, minRows = 3 }: RichTextEditorProps) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<RichText>(value);
  const id = useId();

  // Load external value when it differs from what we last emitted and the editor is not focused.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (richTextEquals(value, last.current) && el.innerHTML !== '') return;
    if (document.activeElement === el) return;
    el.innerHTML = richTextToHtml(value);
    last.current = value;
    el.dataset.empty = value.length ? 'false' : 'true';
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = domToRichText(el);
    el.dataset.empty = next.length ? 'false' : 'true';
    if (!richTextEquals(next, last.current)) {
      last.current = next;
      onChange(next);
    }
  }, [onChange]);

  const exec = (cmd: 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList') => {
    ref.current?.focus();
    document.execCommand(cmd);
    emit();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    emit();
  };

  return (
    <div className="group flex flex-col gap-1">
      {/* The toolbar shows for the box being edited (focus-within), so a long plan is not a wall of buttons. */}
      {!readOnly && (
        <div role="toolbar" aria-label={t('editor.formatting')} aria-controls={id} className="hidden group-focus-within:flex flex-wrap gap-1">
          <ToolButton onClick={() => exec('bold')} label={t('editor.bold')} glyph={<strong>B</strong>} />
          <ToolButton onClick={() => exec('italic')} label={t('editor.italic')} glyph={<em>I</em>} />
          <ToolButton onClick={() => exec('insertUnorderedList')} label={t('editor.bullets')} glyph="•" />
          <ToolButton onClick={() => exec('insertOrderedList')} label={t('editor.numbers')} glyph="1." />
        </div>
      )}
      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-readonly={readOnly || undefined}
        contentEditable={readOnly ? false : 'true'}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? t('editor.placeholder')}
        data-empty={value.length ? 'false' : 'true'}
        onInput={emit}
        onBlur={emit}
        onPaste={onPaste}
        className={cx('rich w-full rounded border bg-white px-3 py-2 text-body break-words', readOnly ? 'border-transparent bg-transparent px-0' : 'border-hairline')}
        style={{ minHeight: `${minRows * 1.5 + 1}rem` }}
      />
    </div>
  );
}

function ToolButton({ onClick, label, glyph }: { onClick: () => void; label: string; glyph: React.ReactNode }) {
  return (
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClick} className="inline-flex items-center gap-1 min-h-touch px-3 rounded border border-hairline bg-white text-small">
      <span aria-hidden="true" className="w-4 text-center">
        {glyph}
      </span>
      <span>{label}</span>
    </button>
  );
}

/** Read-only rendering of rich text (same HTML as the editor). */
export function RichTextView({ value, className }: { value: RichText; className?: string }) {
  return <div className={cx('rich', className)} dangerouslySetInnerHTML={{ __html: richTextToHtml(value) }} />;
}
