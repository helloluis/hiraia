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
 * Landing-page Android download. Shows "coming soon" until a real APK is
 * published (DOWNLOAD.released + url), then a download button plus a "verify
 * it's official" disclosure — the legitimacy story for an app distributed
 * outside the Play Store.
 */
export function AppDownload() {
  const [showVerify, setShowVerify] = useState(false);
  const live = DOWNLOAD.released && !!DOWNLOAD.url;
  const apkSize = DOWNLOAD.fileSizeMB ? `~${DOWNLOAD.fileSizeMB} MB` : 'a small download';

  return (
    <div className="pl-1 space-y-3">
      {live ? (
        <>
          <a
            href={DOWNLOAD.url}
            download
            className="inline-flex items-center gap-2 rounded-full bg-[#0f8c5c] px-5 py-2.5 text-sm sm:text-base font-semibold text-white shadow-md shadow-[#0f8c5c]/20 transition-colors hover:bg-[#0c7a4f]"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download for Android
          </a>
          <p className="text-xs sm:text-sm text-gray-500">
            v{DOWNLOAD.version}
            {DOWNLOAD.fileSizeMB ? ` · ${DOWNLOAD.fileSizeMB} MB APK` : ''} · Android{' '}
            {DOWNLOAD.minAndroid}+ · {DOWNLOAD.minRamGB} GB RAM
          </p>
        </>
      ) : (
        <p className="text-gray-600 text-sm sm:text-base leading-relaxed italic">
          Android app coming soon!
        </p>
      )}

      {/* "What to expect" — heads off the small-app-then-big-download confusion. */}
      <div className="max-w-xl rounded-xl bg-[#fff8ec] p-4 ring-1 ring-[#f3a228]/30">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#0c343d]">
          How the download works
        </p>
        <p className="text-xs sm:text-sm leading-relaxed text-gray-700">
          The app is {apkSize} — it includes Hiraia&apos;s Filipino AI fine-tune built right in. The
          first time you open it, it downloads the base AI model — about{' '}
          <strong className="text-[#0c343d]">{DOWNLOAD.modelDownloadGB} GB, one time</strong> — from{' '}
          <a
            href={DOWNLOAD.modelSourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#0f8c5c] hover:underline"
          >
            {DOWNLOAD.modelSource}
          </a>
          , a public open-model host. After that, Hiraia runs{' '}
          <strong className="text-[#0c343d]">fully offline</strong> — no internet, no account, and
          nothing you type ever leaves your phone.
        </p>
      </div>

      {live && (
        <>
          <button
        type="button"
        onClick={() => setShowVerify((v) => !v)}
        className="inline-flex items-center gap-1 text-xs sm:text-sm font-medium text-[#0c343d] hover:text-[#0f8c5c]"
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
        <div className="max-w-xl space-y-4 rounded-xl bg-[#f3f7f6] p-4 ring-1 ring-gray-200">
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
  );
}
