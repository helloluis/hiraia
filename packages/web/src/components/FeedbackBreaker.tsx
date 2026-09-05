'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

/**
 * The feedback breaker: a full-width white band between the download section and the
 * "Why we built Hiraia" section, plus the modal its "feedback form" link opens.
 *
 * The band and the modal live together in one client component so Landing.tsx only has
 * to drop in <FeedbackBreaker /> and the page stays otherwise server-ignorant of it.
 *
 * Anti-bot, client half (the server re-checks everything in /api/feedback):
 *  - a visually hidden `website` honeypot field humans never see or tab into;
 *  - `openedAt` records when the modal opened, and the submission carries the elapsed
 *    milliseconds — the server silently discards anything filled in under 4 seconds.
 */

type Status = 'idle' | 'submitting' | 'success' | 'error';

const inputClass =
  'w-full rounded-lg border-2 border-[var(--ink)] bg-[var(--plate)] px-3 py-2 font-zilla ' +
  'text-base font-medium text-[var(--ink)] placeholder:text-[var(--ink)]/40 ' +
  'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)]';

export function FeedbackBreaker() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const openedAt = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);
  // Bumped on every submit AND every close: an in-flight fetch whose seq no longer
  // matches is stale (user closed mid-submit, maybe reopened a fresh form) and must
  // not flip the UI to success/error.
  const submitSeq = useRef(0);

  const openModal = () => {
    openedAt.current = Date.now();
    setStatus('idle');
    setOpen(true);
  };
  const closeModal = () => {
    submitSeq.current++;
    setOpen(false);
  };

  // While open: Escape closes, body scroll locks (same pattern as DemoLightbox), focus
  // moves into the dialog, Tab is trapped inside it, and focus returns to wherever it
  // was (the band's trigger link, for keyboard users) on close.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>('button, input, textarea, a[href]') ?? []).filter(
        (el) => el.tabIndex !== -1 && !el.hasAttribute('disabled') // excludes the honeypot
      );
    dialog?.querySelector<HTMLElement>('#feedback-name')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      const first = els[0];
      const last = els[els.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialog?.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The success view replaces the (focused) submit button — park focus on its Close
  // button so keyboard users aren't dropped onto <body> inside an open dialog.
  useEffect(() => {
    if (open && status === 'success') successCloseRef.current?.focus();
  }, [open, status]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    const seq = ++submitSeq.current;
    const form = e.currentTarget;
    const data = new FormData(form);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'),
          contact: data.get('contact'),
          feedback: data.get('feedback'),
          website: data.get('website'), // honeypot — empty for humans
          elapsedMs: Date.now() - openedAt.current,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (submitSeq.current === seq) setStatus('success');
    } catch {
      if (submitSeq.current === seq) setStatus('error');
    }
  };

  return (
    <>
      {/* Breaker band — full page width, white, one centered line. */}
      <section
        aria-label="Questions and feedback"
        className="w-full bg-white px-5 py-6 sm:px-12 md:px-16 lg:px-24"
      >
        <p className="mx-auto max-w-5xl text-center font-zilla text-base font-medium leading-relaxed text-[var(--ink)] sm:text-lg">
          Questions? Check out our{' '}
          <a href="/faq" className="underline decoration-[var(--gold)] underline-offset-2 hover:text-[var(--gold)]">
            FAQs
          </a>{' '}
          or send feedback directly to{' '}
          <a
            href="https://x.com/helloluis"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-[var(--gold)] underline-offset-2 hover:text-[var(--gold)]"
          >
            helloluis on X
          </a>
          , or via our{' '}
          <button
            type="button"
            onClick={openModal}
            className="font-zilla font-medium underline decoration-[var(--gold)] underline-offset-2 hover:text-[var(--gold)]"
          >
            feedback form
          </button>
          .
        </p>
      </section>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-modal-title"
          onClick={closeModal}
        >
          <div
            ref={dialogRef}
            className="mc-card w-full max-w-md max-h-[90dvh] overflow-y-auto !p-4 sm:!p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mc-band">
              <span id="feedback-modal-title" className="mc-topic">
                Send us your feedback
              </span>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close feedback form"
                className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--stock)] transition-colors hover:text-[var(--gold)]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {status === 'success' ? (
              <div className="px-1 py-8 text-center">
                <p className="font-slab text-2xl text-[var(--ink)]">Salamat po!</p>
                <p className="mt-3 font-zilla text-base font-medium leading-relaxed text-[var(--ink)]/85">
                  Thank you — your feedback is on its way to us.
                </p>
                <button ref={successCloseRef} type="button" onClick={closeModal} className="mc-ticket mt-6 !w-auto px-6">
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
                {/* Honeypot: humans never see it; bots that fill it get a fake success. */}
                <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
                  <label htmlFor="feedback-website">Website</label>
                  <input
                    id="feedback-website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label htmlFor="feedback-name" className="mc-label block text-[10px] text-[var(--olive)]">
                    Name
                  </label>
                  <input
                    id="feedback-name"
                    name="name"
                    type="text"
                    required
                    maxLength={120}
                    className={`${inputClass} mt-1.5`}
                  />
                </div>

                <div>
                  <label htmlFor="feedback-contact" className="mc-label block text-[10px] text-[var(--olive)]">
                    Contact (Email / Mobile No. / Twitter account)
                  </label>
                  <input
                    id="feedback-contact"
                    name="contact"
                    type="text"
                    required
                    maxLength={200}
                    className={`${inputClass} mt-1.5`}
                  />
                </div>

                <div>
                  <label htmlFor="feedback-feedback" className="mc-label block text-[10px] text-[var(--olive)]">
                    Feedback
                  </label>
                  <textarea
                    id="feedback-feedback"
                    name="feedback"
                    required
                    minLength={3}
                    maxLength={5000}
                    rows={6}
                    className={`${inputClass} mt-1.5 resize-y`}
                  />
                  <p className="mt-1.5 font-zilla text-xs font-medium text-[var(--ink)]/60">
                    Plain text — **bold** and _italics_ are fine.
                  </p>
                </div>

                {status === 'error' && (
                  <p role="alert" className="font-zilla text-sm font-bold text-[#a03a2a]">
                    Sorry, that didn&apos;t go through. Please try again in a moment.
                  </p>
                )}

                <button type="submit" disabled={status === 'submitting'} className="mc-ticket disabled:opacity-60">
                  <span className="flex-1">{status === 'submitting' ? 'Sending…' : 'Send feedback'}</span>
                  <span className="mc-arrow" aria-hidden />
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
