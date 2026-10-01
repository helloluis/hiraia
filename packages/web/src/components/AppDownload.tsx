'use client';

import { useEffect, useState } from 'react';
import { DOWNLOAD } from '@/config/download';
import { DOWNLOAD_PLATFORMS, platformRelease, type DownloadPlatform, type PlatformRelease } from '@/config/platforms';
import talaManifest from '@/config/tala-download.json';
import styles from './AppDownload.module.css';

function DeviceIcon({device}: {device: DownloadPlatform['device']}) {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    {device === 'phone' ? <><rect x="9" y="3" width="14" height="26" rx="3"/><path d="M13 7h6M14 25h4"/></> :
      device === 'laptop' ? <><rect x="5" y="5" width="22" height="17" rx="2"/><path d="M5 22 2 27h28l-3-5M12 25h8"/></> :
      <><rect x="3" y="4" width="26" height="18" rx="2"/><path d="M16 22v6M10 28h12"/></>}
  </svg>;
}

function trackDownload(platform: string, release: PlatformRelease, onCount: (n: number) => void) {
  const extension = release.platform === 'windows' ? release.format : 'apk';
  window.gtag?.('event', extension === 'apk' ? 'apk_download' : 'file_download', {
    file_name: release.url.split('/').pop(), file_extension: extension,
    link_url: release.url, app_version: release.versionName, platform,
  });
  void fetch('/api/metrics/apk-download', { method: 'POST', keepalive: true })
    .then(r => r.ok ? r.json() : null)
    .then(data => { if (typeof data?.count === 'number') onCount(data.count); })
    .catch(() => {});
}

function PlatformDownload({platform, onCount}: {platform: DownloadPlatform; onCount: (n: number) => void}) {
  const release = platformRelease(platform.id);
  const format = release?.platform === 'windows' ? 'ZIP' : 'APK';
  const shot = platform.screenshot;
  return <article id={`download-${platform.id}`} className={`${styles.platform} ${platform.status === 'planned' ? styles.planned : ''}`}
    aria-labelledby={`platform-${platform.id}`}>
    <div className={styles.information}>
      <div className={styles.identity}>
        <span className={styles.deviceIcon}><DeviceIcon device={platform.device}/></span>
        <div><p className={styles.eyebrow}>{platform.eyebrow}</p><h3 id={`platform-${platform.id}`}>{platform.name}</h3></div>
        <span className={`${styles.badge} ${platform.status === 'preview' ? styles.previewBadge : ''}`}>
          {platform.status === 'planned' ? 'Planned' : platform.status === 'preview' ? 'Preview' : 'Available now'}
        </span>
      </div>
      <p className={styles.description}>{platform.description}</p>
      {platform.requirements.length > 0 && <ul className={styles.requirements}>
        {platform.requirements.map(line => <li key={line}>{line}</li>)}
      </ul>}
      {platform.status !== 'planned' && <div className={styles.actions}>
        {release ? <>
          <a href={release.url} download className={styles.downloadButton} onClick={() => trackDownload(platform.id, release, onCount)}>
            <span>Download for {platform.name}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 3v12m-5-4 5 5 5-5M5 21h14"/></svg>
          </a>
          <p className={styles.fileMeta}>v{release.versionName} <span aria-hidden>·</span> {Math.round(release.bytes / 1_000_000)} MB <span aria-hidden>·</span> {format}</p>
          {platform.downloadNote && <p className={styles.downloadNote}>{platform.downloadNote}</p>}
        </> : <p className={styles.pending}>Preview release pending</p>}
        <details className={styles.details}>
          <summary>Installation & requirements</summary>
          <p>{platform.installNote}</p>
          {platform.id === 'chromeos' && <p>
            School-managed devices cannot use Google’s ADB testing setup. Ask your administrator about deployment before downloading.{' '}
            <a href="https://developers.google.com/chromeos/app-development/develop/deploying-apps">Chromebook testing guide ↗</a>
          </p>}
        </details>
        {release && <details className={styles.details}>
          <summary>Verify this download</summary>
          <div className="mt-3 space-y-4">
            <Checksum label={`${platform.name} ${format} SHA-256`} value={release.sha256} hint={`The SHA-256 of your downloaded ${format} must match this value.`}/>
            {release.platform !== 'windows' && <Checksum label="Signing certificate SHA-256" value={release.signingCertSha256} hint="The same signing identity lets Hiraia update without losing your progress."/>}
          </div>
        </details>}
      </div>}
    </div>
    {shot && <figure className={`${styles.visual} ${platform.device === 'phone' ? styles.phoneVisual : styles.laptopVisual}`}>
      <a href={shot.src} target="_blank" rel="noopener noreferrer" className={styles.screenshotLink}
        aria-label={`View full ${platform.name} screenshot (opens a new tab)`}>
        {/* Actual app captures. object-fit:contain preserves the full card and quiz UI. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} loading="lazy" decoding="async"/>
      </a>
      <figcaption>{shot.caption}</figcaption>
    </figure>}
  </article>;
}

export function AppDownload() {
  const [downloads, setDownloads] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/metrics/apk-download').then(r => r.ok ? r.json() : null).then(data => {
      if (!cancelled && typeof data?.count === 'number') setDownloads(data.count);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return <div className={styles.downloads}>
    <nav aria-label="Choose a download platform" className={styles.platformNav}>
      {DOWNLOAD_PLATFORMS.map(platform => <a key={platform.id} href={`#download-${platform.id}`}>
        <DeviceIcon device={platform.device}/><span>{platform.name}</span>
        {platform.status !== 'available' && <small>{platform.status === 'preview' ? 'Preview' : 'Planned'}</small>}
      </a>)}
    </nav>
    <div className={styles.platformList}>
      {DOWNLOAD_PLATFORMS.map(platform => <PlatformDownload key={platform.id} platform={platform} onCount={setDownloads}/>)}
    </div>
    <div className={styles.offlineNote}>
      <div><p className={styles.eyebrow}>Same Hiraia. Your choice of screen.</p>
        <h3>Download once. Keep learning offline.</h3></div>
      <p>The science cards and quizzes work without the AI model. Connect to download illustrations and, on devices with enough memory,
        the optional tutor model (about {DOWNLOAD.modelDownloadGB} GB). Downloaded content stays available offline.</p>
    </div>
    <div className={styles.sectionFoot}>
      <a href="/hiraia-whitepaper.pdf">Read how the on-device tutor works ↗</a>
      {downloads != null && downloads > 0 && <p>{downloads.toLocaleString()} downloads from hiraia.org</p>}
    </div>
    <div className={styles.teacherHeading}><span className={styles.eyebrow}>For the classroom</span><h3>Teaching with Hiraia?</h3></div>
    <TalaDownload/>
  </div>;
}

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

function TalaDownload() {
  const tala = talaManifest.app as {
    versionName: string; url: string; bytes: number; sha256: string;
  } | null;
  const [showVerify, setShowVerify] = useState(false);
  if (!tala) return null;
  return (
    <section aria-label="Download Tala for teachers" className="mt-8 grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-stretch">
      <div className="mc-card flex h-full flex-col">
        <div className="mc-keyline" aria-hidden />
        <div className="mc-band mb-4 !min-h-[44px] !bg-[#087A78]">
          <span className="mc-topic">Tala</span>
          <span className="tala-new-burst">NEW!</span>
          <span className="mc-chip text-[10px]">v{tala.versionName}</span>
        </div>
        <p className="relative z-[1] font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]">
          Meet Tala, Hiraia&apos;s free classroom monitoring app for teachers. Connect your
          students by QR code, follow their learning activity, and keep classroom records
          on your phone. Requires Android 10 or newer and Google Play services.
        </p>
        <div className="relative z-[1] mt-auto pt-5">
          <div className="mc-ledge">
            <a href={tala.url} download className="mc-ticket" onClick={() => {
              window.gtag?.('event', 'tala_apk_download', {file_name: 'tala.apk', file_extension: 'apk', link_url: tala.url, app_version: tala.versionName});
            }}>
              <span className="flex-1">Download Tala v{tala.versionName} for Android</span>
              <span className="shrink-0 rounded-md bg-[var(--ink)] px-2 py-1 font-gothic text-[9px] uppercase tracking-[0.14em] text-[var(--stock)]">
                {Math.round(tala.bytes / 1_000_000)} MB
              </span>
              <span className="mc-arrow mc-arrow-dl" aria-hidden>
                <svg viewBox="0 0 24 24"><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M5 21h14" /></svg>
              </span>
            </a>
          </div>
          <button type="button" aria-expanded={showVerify} onClick={() => setShowVerify(v => !v)}
            className="relative z-[1] mt-4 font-zilla text-xs font-bold text-[var(--ink)] hover:underline">
            Verify it&apos;s the official app <span aria-hidden>{showVerify ? '▴' : '▾'}</span>
          </button>
          {showVerify && <div className="relative z-[1] mt-3 space-y-4 rounded-lg bg-[var(--plate)] p-3 ring-1 ring-[var(--ink)]/15">
            <Checksum label="Tala APK SHA-256 (file)" value={tala.sha256} hint="The SHA-256 of your downloaded APK must match this value." />
            <Checksum label="Signing certificate SHA-256" value="50dcc69a6eb8ad94354de148087d28919be757eafcd4d304512a5db35f1703ae" hint="The signing identity is preserved so existing Tala pilot installations can update." />
          </div>}
        </div>
      </div>
      <div className="mc-card flex h-full flex-col p-4 sm:p-5">
        <p className="mc-label relative z-[1] mb-2 text-[9px] text-[var(--olive)]">One teacher phone. A connected classroom.</p>
        <p className="relative z-[1] font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]">
          Install Tala on the teacher&apos;s phone and Hiraia on each student&apos;s phone.
          Students scan the classroom QR code to connect. Keep both apps open and the
          phones nearby, with Bluetooth and Wi-Fi turned on. Classroom transfers work
          without an internet connection.
        </p>
        <p className="relative z-[1] mt-4 rounded-lg border border-[#087A78]/30 bg-[#087A78]/[0.06] p-3 font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]">
          <strong>Use separate phones.</strong> Running Hiraia and Tala on the same phone
          is not recommended: student activity cannot transfer between the two apps on
          one device.
        </p>
        <p className="relative z-[1] mt-auto pt-4 font-zilla text-xs text-[var(--olive)]">
          Android may ask you to allow installation from your browser. If Tala is already
          installed, update it without uninstalling to keep your classes and records.
        </p>
      </div>
    </section>
  );
}
