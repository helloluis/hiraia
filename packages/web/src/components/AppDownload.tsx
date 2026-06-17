'use client';

import { useState } from 'react';
import { DOWNLOAD } from '@/config/download';

/**
 * Landing-page Android download — two-tier ("cat" + "kitten") layout.
 *
 * We ship one APK per device class: a larger 3B model APK ("cat") for modern phones
 * with a capable GPU, and a smaller 1B CPU-only APK ("kitten") for older / budget phones
 * (including Adreno-6xx devices the larger model can't run on). The primary card is
 * "cat" (most users); "kitten" sits beside it as the accessible fallback. A single-APK
 * runtime auto-detect is the eventual goal — until both phones are device-verified, two
 * APKs is the honest path.
 */

/** A copyable checksum row used inside the per-tier "verify it's official" disclosure. */
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
        <span className="text-xs font-semibold uppercase tracking-wide text-[#0c343d]">{label}</span>
        <button type="button" onClick={copy} className="text-xs font-medium text-[#0f8c5c] hover:underline">
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

interface TierCardProps {
  tag: string;
  name: string;
  emoji: string;
  forWhom: string;
  modelLine: string;
  url: string;
  fileSizeMB: number;
  sha256: string;
  modelDownloadRange: string;
  primary: boolean;
}

function TierCard({
  tag, name, emoji, forWhom, modelLine, url, fileSizeMB, sha256, modelDownloadRange, primary,
}: TierCardProps) {
  const [showVerify, setShowVerify] = useState(false);
  const sizeText = fileSizeMB ? `~${fileSizeMB} MB` : 'small download';
  return (
    <div
      className={`flex h-full flex-col rounded-2xl p-5 sm:p-6 shadow-sm ring-1 ${
        primary ? 'bg-white ring-[#0c343d]/15' : 'bg-[#fdf6e9] ring-[#0c343d]/10'
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-2xl" aria-hidden>{emoji}</span>
        <h3 className="font-display text-2xl text-[#0c343d]">{name}</h3>
        {primary && (
          <span className="ml-1 rounded-full bg-[#0c343d] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            Most users
          </span>
        )}
        <span className="ml-auto rounded-full bg-[#0c343d]/5 px-2.5 py-0.5 text-xs font-medium text-[#0c343d]/70">
          {tag}
        </span>
      </div>
      <p className="text-sm font-medium text-[#0c343d]/85">{forWhom}</p>
      <p className="mt-2 text-xs text-gray-600 leading-relaxed">{modelLine}</p>

      <a
        href={url}
        download
        className={`group mt-5 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-base font-bold shadow-md transition-all hover:shadow-lg active:scale-[0.98] sm:text-lg ${
          primary
            ? 'bg-[#0c343d] text-white shadow-[#0c343d]/25 hover:bg-[#0f4a56]'
            : 'bg-[#f3a228] text-[#0c343d] shadow-[#f3a228]/30 hover:bg-[#e89215]'
        }`}
      >
        <svg className="h-5 w-5 transition-transform group-hover:translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Download {name}
      </a>
      <p className="mt-2 text-xs text-[#0c343d]/60">
        APK {sizeText} · first-launch model {modelDownloadRange} · Android {DOWNLOAD.minAndroid}+
      </p>

      <button
        type="button"
        onClick={() => setShowVerify((v) => !v)}
        className="mt-4 inline-flex items-center gap-1 self-start text-xs font-semibold text-[#0c343d] hover:text-[#0f8c5c]"
      >
        <svg className="h-3.5 w-3.5 text-[#0f8c5c]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Verify it&apos;s the official app
        <svg className={`h-3 w-3 transition-transform ${showVerify ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {showVerify && (
        <div className="mt-3 space-y-4 rounded-xl bg-white p-3 ring-1 ring-gray-200">
          {sha256 && (
            <Checksum
              label="APK SHA-256 (file)"
              value={sha256}
              hint={`After downloading, run  shasum -a 256 ${name.toLowerCase().replace(/^hiraia /, 'hiraia-')}.apk  — it must match.`}
            />
          )}
          <Checksum
            label="Signing certificate SHA-256"
            value={DOWNLOAD.signingCertSha256}
            hint="apksigner verify --print-certs <apk> — same cert signs both tier APKs and stays the same across releases."
          />
        </div>
      )}
    </div>
  );
}

export function AppDownload() {
  const live = DOWNLOAD.released && !!DOWNLOAD.cat.url && !!DOWNLOAD.kitten.url;

  if (!live) {
    return <p className="text-lg font-semibold italic text-[#0c343d]">Android app coming soon!</p>;
  }

  return (
    <div className="space-y-6">
      {/* Two tier cards. cat is primary (most users); kitten is the accessible fallback. */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <TierCard
          tag="3B model · GPU"
          name="Hiraia Cat"
          emoji="🐈"
          forWhom="For newer phones (2023 onward, 6 GB+ RAM)."
          modelLine="Larger 3B model on your phone's GPU — higher-quality answers, faster replies."
          url={DOWNLOAD.cat.url}
          fileSizeMB={DOWNLOAD.cat.fileSizeMB}
          sha256={DOWNLOAD.cat.sha256}
          modelDownloadRange={DOWNLOAD.cat.modelDownloadRange}
          primary
        />
        <TierCard
          tag="1B model · CPU"
          name="Hiraia Kitten"
          emoji="🐱"
          forWhom="For older or entry-level phones (4 GB RAM is fine)."
          modelLine="Smaller 1B model, CPU-only — for phones that can't run the larger one. Slightly less detailed, still grounded in the same curriculum."
          url={DOWNLOAD.kitten.url}
          fileSizeMB={DOWNLOAD.kitten.fileSizeMB}
          sha256={DOWNLOAD.kitten.sha256}
          modelDownloadRange={DOWNLOAD.kitten.modelDownloadRange}
          primary={false}
        />
      </div>

      <p className="text-xs text-[#0c343d]/70">
        <strong>Not sure which?</strong> If you bought your phone in the last 2–3 years and it has 6 GB+
        RAM, get <strong>Cat</strong>. If it&apos;s older or entry-level, get <strong>Kitten</strong>. The
        app is free either way — if Cat won&apos;t open on your phone, just install Kitten instead.
      </p>

      {/* Shared "how it works" explainer. */}
      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#0c343d]/10">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#0c343d]">How the download works</p>
        <p className="text-xs sm:text-sm leading-relaxed text-gray-700">
          The app itself is a small download — just Hiraia, its offline science knowledge bank, and the
          illustrations. The first time you open it, Hiraia downloads the AI model that matches your tier,
          served from <strong className="text-[#0c343d]">Hiraia&apos;s own servers</strong>. After that, Hiraia runs{' '}
          <strong className="text-[#0c343d]">fully offline</strong> — no internet, no account, and nothing
          you type ever leaves your phone.
        </p>
      </div>
    </div>
  );
}
