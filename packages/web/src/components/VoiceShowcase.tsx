'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './VoiceShowcase.module.css';

/*
 * Hiraia Voices — Expanded Mini 1.0.0-preview.1 (en + tl), 95,400,403 bytes per model.
 * Clips are unedited renders from the frozen bundle (voice-models/expanded-mini/1.0.0-preview.1,
 * bundle/synthesize.py, default scales), peak-levelled to -1 dBFS and encoded to MP3.
 * Exact provenance: public/voices/samples.json.
 */
const MODEL_MB = '95.4';

type Sample = {
  id: string;
  tag: string;
  voice: string;
  text: string;
  src: string;
  sha256: string;
  bytes: number;
};

const SAMPLES: Sample[] = [
  {
    id: 'taglish',
    tag: 'Taglish',
    voice: 'Filipino voice',
    text: 'Alam mo ba? Ang photosynthesis ay paraan ng mga halaman para gumawa ng sariling pagkain gamit ang sunlight, water, at carbon dioxide.',
    src: '/voices/sample-taglish-1.b38dc6a659.mp3',
    sha256: 'b38dc6a659c3f4030a654ac7be2338cf453ec4f5e8cc98332b11a36aec00a592',
    bytes: 109759,
  },
  {
    id: 'tagalog',
    tag: 'Tagalog',
    voice: 'Filipino voice',
    text: 'Ang paniki lang ang mammal sa buong mundo na talagang nakakalipad gamit ang sarili niyang mga pakpak.',
    src: '/voices/sample-tl-1.3466200062.mp3',
    sha256: '346620006245747a2f3de22a0541c8b1a96b72f88b2aa16d4f317a3243365637',
    bytes: 87294,
  },
  {
    id: 'english',
    tag: 'English',
    voice: 'English voice',
    text: 'Your heart is a strong muscle that pumps blood all around your body, every single day.',
    src: '/voices/sample-en-2.1904db264b.mp3',
    sha256: '1904db264b724593bd3399140837f3d8bf5c0fea19e58509a5e128fc8e03fcf3',
    bytes: 56992,
  },
];

const MAX_CHARS = 500;
const SYNTH_URL = '/api/voice/synthesize';
const SYNTH_TIMEOUT_MS = 45_000;
const CUSTOM = 'custom';

type DemoVoice = 'fil' | 'en';
type DemoState = 'idle' | 'loading' | 'playing';

export function VoiceShowcase() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [demoVoice, setDemoVoice] = useState<DemoVoice>('fil');
  const [demoState, setDemoState] = useState<DemoState>('idle');
  const [demoError, setDemoError] = useState<string | null>(null);
  const customUrlRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      requestRef.current?.abort();
      if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current);
    };
  }, []);

  // One player for the samples and the typed sentence: starting either stops the other.
  const play = (id: string, src: string, onFail: () => void) => {
    audioRef.current?.pause();
    const audio = new Audio(src);
    audioRef.current = audio;
    setFailed(null);
    setProgress(0);
    setPlaying(id);
    audio.ontimeupdate = () => {
      if (audio.duration > 0) setProgress(audio.currentTime / audio.duration);
    };
    audio.onended = () => {
      if (audioRef.current === audio) {
        setPlaying(null);
        setProgress(0);
      }
    };
    audio.onerror = () => {
      if (audioRef.current === audio) {
        setPlaying(null);
        onFail();
      }
    };
    audio.play().catch(() => {
      if (audioRef.current === audio) {
        setPlaying(null);
        onFail();
      }
    });
  };

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
    setProgress(0);
  };

  const toggle = (sample: Sample) => {
    if (audioRef.current && playing === sample.id) {
      stop();
      return;
    }
    play(sample.id, sample.src, () => setFailed(sample.id));
  };

  const speak = async () => {
    if (demoState === 'loading') return;
    if (playing === CUSTOM) {
      stop();
      return;
    }
    const text = draft.trim();
    if (!text) {
      setDemoError('Type a sentence first.');
      return;
    }
    stop();
    setDemoError(null);
    setDemoState('loading');
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS);
    try {
      const res = await fetch(SYNTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: demoVoice }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let message = 'The voice demo is unavailable right now. Please try again later.';
        if (res.status === 429) message = "You've tried a lot of sentences! Please wait a minute and try again.";
        try {
          const body = (await res.json()) as { message?: string };
          if (body.message) message = body.message;
        } catch {
          /* nginx-level errors are not JSON */
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      if (requestRef.current !== controller) return;
      if (customUrlRef.current) URL.revokeObjectURL(customUrlRef.current);
      const url = URL.createObjectURL(blob);
      customUrlRef.current = url;
      setDemoState('idle');
      play(CUSTOM, url, () => setDemoError("This audio couldn't play. Please try again."));
    } catch (error) {
      if (requestRef.current !== controller) return;
      setDemoState('idle');
      setDemoError(
        controller.signal.aborted
          ? 'That took too long. Please try again, or try a shorter sentence.'
          : error instanceof TypeError || !(error instanceof Error)
            ? 'Could not reach the voice demo. Check your connection and try again.'
            : error.message,
      );
    } finally {
      window.clearTimeout(timer);
    }
  };

  return (
    <section id="voices" aria-labelledby="voices-title" className={styles.section}>
      <div className={styles.backdrop} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/voices/voice-listener-800.webp" alt="" loading="lazy" decoding="async" />
      </div>
      <picture className={styles.photo}>
        <source media="(max-width: 639px)" srcSet="/voices/voice-listener-800.webp" type="image/webp" />
        <source srcSet="/voices/voice-listener-1920.webp" type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/voices/voice-listener-1920.jpg"
          alt="A smiling girl with her eyes closed, listening to her phone"
          loading="lazy"
          decoding="async"
        />
      </picture>
      <div className={styles.scrim} aria-hidden />

      <div className={styles.inner}>
        <div className={styles.column}>
          {/* Capsule 1 — what these are */}
          <div className="mc-card">
            <div className="mc-keyline" aria-hidden />
            <div className="mc-band">
              <span className="mc-topic">Hiraia Voices · Preview</span>
            </div>
            <h2
              id="voices-title"
              className="mt-4 px-1 text-[2rem] leading-[1.05] text-[var(--ink)] sm:text-[2.3rem]"
            >
              Two custom-built voices, each under 100&nbsp;MB
            </h2>
            <p className="mt-3 px-1 font-zilla text-base font-medium leading-relaxed text-[var(--ink)] sm:text-[1.05rem]">
              We built our own text-to-speech models for Hiraia: one Filipino voice
              and one English voice. At {MODEL_MB}&nbsp;MB each, they&apos;re small enough
              to live on a student&apos;s phone and read science aloud offline. The
              Filipino voice also handles English science words mid-sentence, the way
              Filipino kids actually talk.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2 px-1" aria-label="Model sizes">
              <li className={styles.chip}>
                Filipino <b>{MODEL_MB} MB</b>
              </li>
              <li className={styles.chip}>
                English <b>{MODEL_MB} MB</b>
              </li>
            </ul>
          </div>

          {/* Capsule 2 — samples */}
          <div className="mc-card">
            <div className="mc-keyline" aria-hidden />
            <p className="mc-label px-1 text-[10px] text-[var(--teal)]">Listen</p>
            <ul className="mt-3 flex flex-col gap-3">
              {SAMPLES.map((s) => {
                const isPlaying = playing === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={styles.sample}
                      onClick={() => toggle(s)}
                      aria-pressed={isPlaying}
                      aria-label={`${isPlaying ? 'Pause' : 'Play'} ${s.tag} sample, ${s.voice}`}
                      data-sha256={s.sha256}
                      data-bytes={s.bytes}
                    >
                      <span className={styles.play} aria-hidden>
                        <i className={isPlaying ? styles.pauseIcon : styles.playIcon} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={styles.sampleMeta}>
                          <span className={styles.tag}>{s.tag}</span>
                          <span>{s.voice}</span>
                        </span>
                        <span className={styles.sampleText} lang={s.id === 'english' ? 'en' : 'fil'}>
                          {s.text}
                        </span>
                        <span className={styles.track} aria-hidden>
                          <span style={{ transform: `scaleX(${isPlaying ? progress : 0})` }} />
                        </span>
                        {failed === s.id && (
                          <span className={styles.error} role="status">
                            This clip couldn&apos;t play. Please try again.
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 px-1 font-zilla text-[0.8rem] font-medium leading-snug text-[var(--ink)]/70">
              Unedited model output, volume-levelled only. These preview voices are
              coming to the Hiraia app.
            </p>
          </div>

          {/* Capsule 3 — try your own sentence, synthesized live by the same two models */}
          <div className="mc-card">
            <div className="mc-keyline" aria-hidden />
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <label htmlFor="voice-try" className="mc-label text-[10px] text-[var(--teal)]">
                Type your own sentence
              </label>
              <div className={styles.voicePick} role="radiogroup" aria-label="Voice">
                {(
                  [
                    ['fil', 'Filipino'],
                    ['en', 'English'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={demoVoice === value}
                    className={styles.voiceOption}
                    onClick={() => setDemoVoice(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              id="voice-try"
              className={styles.input}
              rows={3}
              maxLength={MAX_CHARS}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value.slice(0, MAX_CHARS));
                if (demoError) setDemoError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void speak();
                }
              }}
              placeholder={
                demoVoice === 'fil'
                  ? 'Halimbawa: Kapag mainit ang araw, nag-e-evaporate ang tubig sa dagat.'
                  : 'For example: The Moon has no light of its own; it reflects light from the Sun.'
              }
              aria-describedby="voice-try-note"
            />
            <div className="mt-2 flex items-start justify-between gap-3 px-1">
              <p id="voice-try-note" className="font-zilla text-[0.85rem] font-medium leading-snug text-[var(--ink)]/75">
                Mixing Tagalog and English? Use the Filipino voice; it reads English words too.
                Spell out numbers in words.
              </p>
              <span className="shrink-0 font-zilla text-[0.8rem] font-semibold tabular-nums text-[var(--ink)]/60">
                {draft.length}/{MAX_CHARS}
              </span>
            </div>
            <div className="mc-ledge mt-3">
              <button
                type="button"
                className={`mc-ticket ${styles.speakTicket}`}
                onClick={() => void speak()}
                disabled={demoState === 'loading'}
                aria-busy={demoState === 'loading'}
              >
                <span className="flex-1">
                  {demoState === 'loading'
                    ? 'Making the audio\u2026'
                    : playing === CUSTOM
                      ? 'Stop'
                      : `Listen in ${demoVoice === 'fil' ? 'Filipino' : 'English'}`}
                </span>
                <span className="mc-arrow" aria-hidden>
                  {demoState === 'loading' ? <i className={styles.spinner} /> : null}
                </span>
              </button>
            </div>
            {playing === CUSTOM && (
              <span className={`${styles.track} mx-1 mt-3`} aria-hidden>
                <span style={{ transform: `scaleX(${progress})` }} />
              </span>
            )}
            <p className={styles.demoError} role="status" aria-live="polite">
              {demoError}
            </p>
            <p className="mt-1 px-1 font-zilla text-[0.75rem] font-medium leading-snug text-[var(--ink)]/60">
              Generated live on our server by the same two models. We don&apos;t save what you type.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
