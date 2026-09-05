'use client';

import { useEffect, useState } from 'react';
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

function trackApkDownload(onCount?: (n: number) => void) {
  window.gtag?.('event', 'apk_download', {
    file_name: 'hiraia.apk',
    file_extension: 'apk',
    link_url: DOWNLOAD.apk.url,
    app_version: DOWNLOAD.version,
  });
  void fetch('/api/metrics/apk-download', { method: 'POST', keepalive: true })
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { count?: number } | null) => {
      if (typeof data?.count === 'number') onCount?.(data.count);
    })
    .catch(() => {
      /* GA already has the click; the public count can lag */
    });
}

export function AppDownload() {
  const live = DOWNLOAD.released && !!DOWNLOAD.apk.url && !!DOWNLOAD.apk.sha256;
  const [showVerify, setShowVerify] = useState(false);
  const [downloads, setDownloads] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/metrics/apk-download')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { count?: number } | null) => {
        if (!cancelled && typeof data?.count === 'number') setDownloads(data.count);
      })
      .catch(() => {
        /* count is optional chrome — a failed fetch just hides it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      {live ? (
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-stretch">
          <div className="mc-card flex h-full flex-col">
            <div className="mc-keyline" aria-hidden />
            <div className="mc-band mb-4">
              <span className="mc-topic">Hiraia</span>
              <span className="mc-chip text-[10px]">v{DOWNLOAD.version}</span>
            </div>
            <p className="relative z-[1] font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]">
              Requires Android {DOWNLOAD.minAndroid}+ and a phone with {DOWNLOAD.minRamGB}GB+ of memory.
            </p>

            <div className="relative z-[1] mt-auto pt-5">
              <div className="mc-ledge">
                <a
                  href={DOWNLOAD.apk.url}
                  download
                  className="mc-ticket"
                  onClick={() => trackApkDownload(setDownloads)}
                >
                  <span className="flex-1">Download Hiraia for Android</span>
                  {DOWNLOAD.apk.fileSizeMB > 0 ? (
                    <span className="shrink-0 rounded-md bg-[var(--ink)] px-2 py-1 font-gothic text-[9px] uppercase tracking-[0.14em] text-[var(--stock)]">
                      {DOWNLOAD.apk.fileSizeMB} MB
                    </span>
                  ) : null}
                  <span className="mc-arrow mc-arrow-dl" aria-hidden>
                    <svg viewBox="0 0 24 24">
                      <path d="M12 3v12" />
                      <path d="M7 11l5 5 5-5" />
                      <path d="M5 21h14" />
                    </svg>
                  </span>
                </a>
              </div>
              {downloads != null && downloads > 0 ? (
                <p className="relative z-[1] mt-3 font-zilla text-xs font-medium text-[var(--ink)]/55">
                  {downloads.toLocaleString()} {downloads === 1 ? 'download' : 'downloads'} from hiraia.org
                </p>
              ) : null}
            </div>
          </div>

          <div className="mc-card flex h-full flex-col p-4 sm:p-5">
            <p className="mc-label relative z-[1] mb-2 text-[9px] text-[var(--olive)]">How the download works</p>
            <p className="relative z-[1] font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]">
              The app itself is a small download. The first time you open the app, it fetches
              about 2Gb of files, including the customized AI model and its library of
              illustrations, from Hiraia&apos;s own servers or any filesharing peers it finds
              nearby. After that it runs fully offline — no internet, no account, and nothing
              you type ever leaves the phone.
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
                <Checksum
                  label="APK SHA-256 (file)"
                  value={DOWNLOAD.apk.sha256}
                  hint="After downloading, run  shasum -a 256 hiraia.apk  — it must match."
                />
                <Checksum
                  label="Signing certificate SHA-256"
                  value={DOWNLOAD.signingCertSha256}
                  hint="apksigner verify --print-certs <apk> — stays the same across releases."
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-stretch">
          <div className="mc-card flex h-full flex-col">
            <div className="mc-keyline" aria-hidden />
            <div className="mc-band mb-4">
              <span className="mc-topic">Hiraia</span>
              <span className="mc-chip text-[10px]">v{DOWNLOAD.version}</span>
            </div>
            <p className="relative z-[1] font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]">
              Requires Android {DOWNLOAD.minAndroid}+ and a phone with {DOWNLOAD.minRamGB}GB+ of memory.
            </p>

            <div className="relative z-[1] mt-auto pt-5">
              <div className="mc-ledge">
                <div
                  className="mc-ticket cursor-default"
                  aria-disabled="true"
                  aria-label="Download Hiraia for Android, coming soon"
                >
                  <span className="flex-1">Download Hiraia for Android</span>
                  <span className="shrink-0 rounded-md bg-[var(--ink)] px-2 py-1 font-gothic text-[9px] uppercase tracking-[0.14em] text-[var(--stock)]">
                    Coming soon
                  </span>
                  <span className="mc-arrow mc-arrow-dl" aria-hidden>
                    <svg viewBox="0 0 24 24">
                      <path d="M12 3v12" />
                      <path d="M7 11l5 5 5-5" />
                      <path d="M5 21h14" />
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mc-card flex h-full flex-col p-4 sm:p-5">
            <p className="mc-label relative z-[1] mb-2 text-[9px] text-[var(--olive)]">How the download works</p>
            <p className="relative z-[1] font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]">
              The app itself is a small download. The first time you open the app, it fetches
              about 2Gb of files, including the customized AI model and its library of
              illustrations, from Hiraia&apos;s own servers or any filesharing peers it finds
              nearby. After that it runs fully offline — no internet, no account, and nothing
              you type ever leaves the phone.
            </p>
          </div>
        </div>
      )}
      <p className="mt-6 max-w-3xl font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]/80">
        Hiraia is a continued-pretraining fork of Qwen 3.5-2B, further trained on a
        Filipino and Bisaya corpus so the tutor can run on-device in those
        languages. Its flash cards and illustrations are pregenerated from the
        Department of Education&apos;s MATATAG science competencies. A separate
        fact bank, indexed with LaBSE sentence embeddings, supports dynamic card
        generation: when a student asks for a topic that is not already in the
        deck, retrieved facts are printed as a new card in Tagalog, English, or
        Bisaya. As of early Sept 2026, Hiraia is in its second round of CPT and
        preliminary SFT.
      </p>
    </div>
  );
}
