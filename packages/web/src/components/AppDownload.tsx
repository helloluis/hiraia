'use client';

import { useEffect, useState } from 'react';
import { DOWNLOAD } from '@/config/download';
import talaManifest from '@/config/tala-download.json';

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
                {Math.ceil(tala.bytes / 1048576)} MB
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
              Requires Android {DOWNLOAD.minAndroid} or newer. {DOWNLOAD.minRamGB}GB+ of memory is
              recommended for model-generated cards; the built-in flash-card library works without
              the model. Android may ask you to allow this one install — that&apos;s normal, since Hiraia
              isn&apos;t on the Play Store.
            </p>

            <div className="relative z-[1] mt-auto pt-5">
              <div className="mc-ledge">
                <a
                  href={DOWNLOAD.apk.url}
                  download
                  className="mc-ticket"
                  onClick={() => trackApkDownload(setDownloads)}
                >
                  <span className="flex-1">Download Hiraia v{DOWNLOAD.version} for Android</span>
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
              <details className="relative z-[1] mt-4 rounded-lg border border-[var(--olive)]/30 bg-[var(--plate)] px-3 py-2 text-[var(--ink)]">
                <summary className="cursor-pointer rounded font-zilla text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ink)]">
                  What&apos;s new · Changelog
                </summary>
                <div className="mt-3 space-y-4 font-zilla text-sm leading-relaxed">
                  <section aria-label="Changes in version 0.4.17">
                    <h3 className="font-bold">v0.4.17 · Smarter updates and classroom connections</h3>
                    <p className="mt-1">Separate notices for app, tutor-model, and illustration updates. Automatic classroom reconnects and clearer connectivity guidance help keep Hiraia connected to Tala.</p>
                  </section>
                  <section aria-label="Changes in version 0.3.1">
                    <h3 className="font-bold">v0.3.1 · Clearer curriculum headings</h3>
                    <p className="mt-1">
                      Renamed the Grade 6 topic “Diagrams and flowcharts” to “Changes of State”
                      in the Calendar and card heading, with matching Tagalog and Cebuano labels.
                    </p>
                  </section>
                  <section aria-label="Changes in version 0.3">
                    <h3 className="font-bold">v0.3 · Topic review and device support</h3>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      <li>Reopen completed Calendar topics for review without losing progress.</li>
                      <li>Updated card titles, categories, illustrations, and interface.</li>
                      <li>
                        Memory checks help determine whether the phone can run the local AI model.
                        The curated library remains available on supported Android 10+ devices.
                      </li>
                    </ul>
                  </section>
                </div>
              </details>
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
              The APK includes the curated flash-card library. On first launch, Hiraia
              automatically downloads common illustrations and images for the selected grade
              over HTTPS. It checks available memory before downloading or loading the optional
              AI model. Downloaded content works offline; phones that cannot run the model can
              still use the curated cards and quizzes.
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
              Requires Android {DOWNLOAD.minAndroid} or newer. {DOWNLOAD.minRamGB}GB+ of memory is
              recommended for model-generated cards; the built-in flash-card library works without
              the model. Android may ask you to allow this one install — that&apos;s normal, since Hiraia
              isn&apos;t on the Play Store.
            </p>

            <div className="relative z-[1] mt-auto pt-5">
              <div className="mc-ledge">
                <div
                  className="mc-ticket cursor-default"
                  aria-disabled="true"
                  aria-label={`Download Hiraia v${DOWNLOAD.version} for Android, coming soon`}
                >
                  <span className="flex-1">Download Hiraia v{DOWNLOAD.version} for Android</span>
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
              The APK includes the curated flash-card library. On first launch, Hiraia
              automatically downloads common illustrations and images for the selected grade
              over HTTPS. It checks available memory before downloading or loading the optional
              AI model. Downloaded content works offline; phones that cannot run the model can
              still use the curated cards and quizzes.
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
      <TalaDownload />
    </div>
  );
}
