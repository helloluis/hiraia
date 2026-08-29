'use client';

import { useState } from 'react';
import { DOWNLOAD } from '@/config/download';

/**
 * Landing-page Android download. One APK, one 2B on-device model.
 */

function Checksum({ label, value, hint }: { label: string; value: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — user can still select the text */
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="mc-label text-[9px] text-[var(--olive)]">{label}</span>
        <button type="button" onClick={copy} className="font-zilla text-xs font-bold text-[var(--ink)] hover:underline">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code className="block break-all rounded bg-[var(--plate)] px-3 py-2 font-mono text-xs text-[var(--ink)] ring-1 ring-[var(--ink)]/20">
        {value}
      </code>
      <p className="font-zilla text-xs text-[var(--olive)]">{hint}</p>
    </div>
  );
}

export function AppDownload() {
  const live = DOWNLOAD.released && !!DOWNLOAD.apk.url;
  const [showVerify, setShowVerify] = useState(false);

  if (!live) {
    return <p className="font-zilla text-lg font-bold text-[var(--stock)]">Android app coming soon.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-stretch">
      <div className="mc-card flex h-full flex-col">
        <div className="mc-keyline" aria-hidden />
        <div className="mc-band mb-4">
          <span className="mc-topic">Hiraia</span>
          <span className="mc-chip text-[10px]">v{DOWNLOAD.version}</span>
        </div>
        <p className="relative z-[1] font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]">
          Requires Android {DOWNLOAD.minAndroid}+; Phones with 6GB+ memory are recommended.
        </p>

        <div className="relative z-[1] mt-auto pt-5">
          <div className="mc-ledge">
            <a href={DOWNLOAD.apk.url} download className="mc-ticket">
              <span className="flex-1">Download Hiraia</span>
              <span className="mc-arrow mc-arrow-dl" aria-hidden>
                <svg viewBox="0 0 24 24">
                  <path d="M12 3v12" />
                  <path d="M7 11l5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              </span>
            </a>
          </div>
        </div>
      </div>

      <div className="mc-card flex h-full flex-col p-4 sm:p-5">
        <p className="mc-label relative z-[1] mb-2 text-[9px] text-[var(--olive)]">How the download works</p>
        <p className="relative z-[1] font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]">
          The app itself is a small download — Hiraia, the science bank, and the
          illustrations. The first time you open it, it fetches the 2B model from
          Hiraia&apos;s own servers. After that it runs fully offline — no internet,
          no account, and nothing you type ever leaves the phone.
        </p>

        <button
          type="button"
          onClick={() => setShowVerify((v) => !v)}
          className="relative z-[1] mt-auto pt-4 inline-flex items-center gap-1 self-start font-zilla text-xs font-bold text-[var(--ink)] hover:underline"
        >
          Verify it&apos;s the official app
          <span aria-hidden>{showVerify ? '▴' : '▾'}</span>
        </button>
        {showVerify && (
          <div className="relative z-[1] mt-3 space-y-4 rounded-lg bg-[var(--plate)] p-3 ring-1 ring-[var(--ink)]/15">
            {DOWNLOAD.apk.sha256 ? (
              <Checksum
                label="APK SHA-256 (file)"
                value={DOWNLOAD.apk.sha256}
                hint="After downloading, run  shasum -a 256 hiraia.apk  — it must match."
              />
            ) : null}
            <Checksum
              label="Signing certificate SHA-256"
              value={DOWNLOAD.signingCertSha256}
              hint="apksigner verify --print-certs <apk> — stays the same across releases."
            />
          </div>
        )}
      </div>
    </div>
  );
}
