'use client';

import { DOWNLOAD } from '@/config/download';

/**
 * Landing-page Android download. One APK, one 2B on-device model.
 */

export function AppDownload() {
  return (
    <div>
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
            <div
              className="mc-ticket cursor-default"
              aria-disabled="true"
              aria-label="Download Hiraia, coming soon"
            >
              <span className="flex-1">Download Hiraia</span>
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
          The app itself is a small download. The first time you open the app, it
          fetches about 2GB of files, including the customized AI model and its
          library of illustrations, from Hiraia&apos;s own servers or any
          filesharing peers it finds nearby. After that it runs fully offline —
          no internet, no account, and nothing you type ever leaves the phone.
        </p>
      </div>
      </div>
      <p className="mt-6 max-w-3xl font-zilla text-sm font-medium leading-relaxed text-[var(--ink)]/80">
        Hiraia is a continued-pretraining fork of Qwen 3.5-2B, further trained on a
        Filipino and Bisaya corpus so the tutor can run on-device in those
        languages. Its flash cards and illustrations are pregenerated from the
        Department of Education&apos;s MATATAG science competencies. A separate
        fact bank, indexed with LaBSE sentence embeddings, supports dynamic card
        generation: when a student asks for a topic that is not already in the
        deck, retrieved facts are printed as a new card in Tagalog, English, or
        Bisaya. As of early Sept 2026, Hiraia is in its second round of CPT
        and preliminary SFT.
      </p>
    </div>
  );
}
