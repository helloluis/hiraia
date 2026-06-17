'use client';

import { useState } from 'react';
import { DOWNLOAD } from '@/config/download';

/** A copyable checksum row (label + monospace value + copy button). */
function Checksum({ label, value, hint }: { label: string; value: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. non-HTTPS) — user can still select the text */
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#0c343d]">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="text-xs font-medium text-[#0f8c5c] hover:underline"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code className="block break-all rounded-md bg-white px-3 py-2 font-mono text-xs text-gray-700 ring-1 ring-gray-200">
        {value}
      </code>
      <p className="text-xs text-gray-500">{hint}</p>
    </div>
  );
}

/**
 * Landing-page Android download — the standout "Free to download" section.
 * The single clickable action (an exaggerated Download button) floats left;
 * the explanatory notes (how the download works + a collapsed "verify it's
 * official" disclosure) sit on the right. Shows "coming soon" until a real
 * APK is published (DOWNLOAD.released + url).
 */
export function AppDownload() {
  const [showVerify, setShowVerify] = useState(false);
  const live = DOWNLOAD.released && !!DOWNLOAD.url;
  const apkSize = DOWNLOAD.fileSizeMB ? `~${DOWNLOAD.fileSizeMB} MB` : 'a small download';

  return (
    <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
      {/* LEFT: the one action — exaggerated because it's the only thing to click. */}
      <div className="flex flex-col items-start gap-4 lg:col-span-5">
        {live ? (
          <>
            <a
              href={DOWNLOAD.url}
              download
              className="group inline-flex items-center gap-3 rounded-2xl bg-[#0c343d] px-8 py-6 text-xl font-bold text-white shadow-xl shadow-[#0c343d]/25 transition-all hover:bg-[#0f4a56] hover:shadow-2xl active:scale-[0.98] sm:gap-4 sm:px-12 sm:py-8 sm:text-3xl"
            >
              <svg className="h-7 w-7 transition-transform group-hover:translate-y-0.5 sm:h-9 sm:w-9" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Download for Android
            </a>
            <p className="text-sm font-medium text-[#0c343d]/70">
              v{DOWNLOAD.version}
              {DOWNLOAD.fileSizeMB ? ` · ${DOWNLOAD.fileSizeMB} MB APK` : ''} · Android{' '}
              {DOWNLOAD.minAndroid}+ · {DOWNLOAD.minRamGB} GB RAM · Free, no account
            </p>
          </>
        ) : (
          <p className="text-lg font-semibold italic text-[#0c343d]">Android app coming soon!</p>
        )}
      </div>

      {/* RIGHT: the explanatory notes. */}
      <div className="space-y-3 lg:col-span-7">
        {/* "What to expect" — heads off the small-app-then-big-download confusion. */}
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#0c343d]/10">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#0c343d]">
            How the download works
          </p>
          <p className="text-xs sm:text-sm leading-relaxed text-gray-700">
            The app itself is a small {apkSize} download — just Hiraia, its offline science
            knowledge bank, and the illustrations. The first time you open it, Hiraia checks your
            phone and the language you choose, then downloads the{' '}
            <strong className="text-[#0c343d]">AI model and Filipino adapter that best fit your device</strong>{' '}
            — a one-time download of{' '}
            <strong className="text-[#0c343d]">about {DOWNLOAD.modelDownloadRange}</strong>, served from{' '}
            <strong className="text-[#0c343d]">Hiraia&apos;s own servers</strong>. A capable phone gets
            the larger, higher-quality model; an entry-level one gets a lighter model tuned to run
            smoothly on it. After that, Hiraia runs{' '}
            <strong className="text-[#0c343d]">fully offline</strong> — no internet, no account, and
            nothing you type ever leaves your phone.
          </p>
        </div>

        {live && (
          <>
            <button
              type="button"
              onClick={() => setShowVerify((v) => !v)}
              className="inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-[#0c343d] hover:text-[#0f8c5c]"
            >
              <svg className="h-4 w-4 text-[#0f8c5c]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Verify it&apos;s the official app
              <svg
                className={`h-3.5 w-3.5 transition-transform ${showVerify ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {showVerify && (
              <div className="space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#0c343d]/10">
                <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                  Hiraia isn&apos;t on the Play Store, so you can confirm it&apos;s the genuine, untampered app
                  using the checks below. Android also verifies the developer signature automatically when you
                  install or update.
                </p>

                {DOWNLOAD.sha256 && (
                  <Checksum
                    label="APK SHA-256 (file)"
                    value={DOWNLOAD.sha256}
                    hint="After downloading, run  shasum -a 256 hiraia.apk  (Linux: sha256sum · Windows: certutil -hashfile hiraia.apk SHA256) — it must match."
                  />
                )}

                {DOWNLOAD.signingCertSha256 && (
                  <Checksum
                    label="Signing certificate SHA-256"
                    value={DOWNLOAD.signingCertSha256}
                    hint="Check the signer with  apksigner verify --print-certs hiraia.apk  — the SHA-256 must match. This stays the same across all official releases."
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
