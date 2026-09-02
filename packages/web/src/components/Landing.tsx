'use client';

import { type ReactNode } from 'react';
import { AppDownload } from '@/components/AppDownload';
import { FeedbackBreaker } from '@/components/FeedbackBreaker';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { DemoLightbox } from '@/components/demo/DemoLightbox';
import { useDemoStore } from '@/store/useDemoStore';

function Ticket({
  children,
  onClick,
  ghost,
}: {
  children: ReactNode;
  onClick: () => void;
  ghost?: boolean;
}) {
  return (
    <div className="mc-ledge">
      <button type="button" onClick={onClick} className={ghost ? 'mc-ticket mc-ticket-ghost' : 'mc-ticket'}>
        <span className="flex-1">{children}</span>
        <span className="mc-arrow" aria-hidden />
      </button>
    </div>
  );
}

export function Landing() {
  const openDemo = useDemoStore((s) => s.openDemo);

  const scrollToDownload = () => {
    document.getElementById('download')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="mc min-h-screen w-full overflow-x-hidden">
      <div className="mc-alpha" role="status">
        <span>Early Alpha</span>
      </div>
      {/* HERO — photograph stays; overlay is a laminated classroom card. */}
      <section
        className="mc-hero relative flex min-h-[100svh] w-full items-start justify-start"
        aria-label="Hiraia"
      >
        <div className="mc-hero-photo" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing.jpeg" alt="" />
        </div>
        <div className="mc-hero-pixels" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing.jpeg" alt="" />
        </div>
        <div className="mc-hero-fade" aria-hidden />
        <div className="relative z-10 w-full max-w-[21rem] px-4 pt-10 sm:ml-10 sm:max-w-[24rem] sm:px-0 sm:pt-14 md:ml-16 lg:ml-24">
          <div className="mc-card">
            <div className="mc-keyline" aria-hidden />
            <div className="mc-hole mc-hole-a" aria-hidden />
            <div className="mc-hole mc-hole-b" aria-hidden />

            <div className="mc-band !h-auto !min-h-[34px] !py-1.5">
              <span className="mc-topic !whitespace-normal leading-tight !tracking-[0.08em]">
                MATATAG-compatible science tutor
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hiraia-profile.png" alt="" width={26} height={26} className="mc-stamp" />
            </div>

            <h1 className="mt-5 font-slab text-[2.75rem] leading-none tracking-wide text-[var(--ink)] sm:text-6xl">
              HIRAIA
            </h1>
            <p className="mt-4 font-zilla text-[1.35rem] font-bold leading-snug text-[var(--ink)] text-balance sm:text-[1.55rem]">
              An AI science tutor that runs entirely offline
            </p>
            <div className="mc-divider my-4" aria-hidden>
              <span />
              <i />
              <span />
            </div>
            <p className="font-zilla text-base font-medium leading-relaxed text-[var(--ink)] sm:text-[1.05rem]">
              Our on-device AI works on entry-level Android phones and speaks fluent
              Tagalog and English.
            </p>

            <div className="relative z-[1] mt-6 flex flex-col gap-3">
              <Ticket onClick={openDemo}>Try the demo</Ticket>
              <Ticket onClick={scrollToDownload} ghost>
                Download for free
              </Ticket>
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCT — type sits on the board, like app chrome. */}
      <section className="px-5 py-16 sm:px-12 sm:py-20 md:px-16 lg:px-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="max-w-3xl text-3xl leading-none text-[var(--stock)] sm:text-4xl md:text-[2.75rem]">
            Personal science tutor on your phone
          </h2>
          <p className="mt-5 max-w-2xl font-zilla text-lg font-medium leading-relaxed text-[var(--stock)]/90 sm:text-xl">
            Hiraia is a FREE AI tutor for Filipino students that knows what&apos;s
            being focused on at school, and reinforces those lessons at home. After
            a one-time download, it works without an internet connection &hellip;
            forever! No account registration is required, no information is
            collected, and no personal data ever leaves the device.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-10">
            <div>
              <p className="mc-label text-[10px] text-[var(--gold)]">On-device and Offline</p>
              <p className="mt-2 font-zilla text-base font-medium leading-relaxed text-[var(--stock)]/85 sm:text-lg">
                The AI model, the illustrations, and our science fact bank all live
                on the phone, and can optionally connect to a public P2P network for
                curriculum updates.
              </p>
            </div>
            <div>
              <p className="mc-label text-[10px] text-[var(--gold)]">Tagalog and English</p>
              <p className="mt-2 font-zilla text-base font-medium leading-relaxed text-[var(--stock)]/85 sm:text-lg">
                Built for Philippine elementary to junior high, based on the
                Department of Education&apos;s new 2027 MATATAG science curriculum.
              </p>
            </div>
            <div>
              <p className="mc-label text-[10px] text-[var(--gold)]">100% Free Forever</p>
              <p className="mt-2 font-zilla text-base font-medium leading-relaxed text-[var(--stock)]/85 sm:text-lg">
                No payments or subscriptions necessary. Download and share freely
                with friends and classmates.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-5 py-16 sm:px-12 sm:py-20 md:px-16 lg:px-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-4xl text-3xl leading-tight text-[var(--ink)] sm:text-4xl md:text-[2.75rem]">
            50k science facts, 30k illustrations, 20k mini-quizzes
          </h2>
          <ul className="mt-10 grid grid-cols-2 gap-6 sm:gap-8 lg:grid-cols-4 lg:gap-6">
            {[
              {
                src: '/screens/card.jpg',
                alt: 'A science card about constellations, with a drawing of Earth',
                caption: 'Each card carries one fact and one illustration.',
              },
              {
                src: '/screens/quiz.jpg',
                alt: 'A quiz asking why the Philippines has two seasons',
                caption: "After swiping past a few cards, a quiz checks the student's memory.",
              },
              {
                src: '/screens/recap.jpg',
                alt: 'A recap card celebrating topics the student just read',
                caption: 'A recap card reinforces the facts already discussed.',
              },
              {
                src: '/screens/search.jpg',
                alt: 'A generated card about why the Philippines has no winter, after searching for winter',
                caption: "A dynamic card can be generated based on the student's desired topic.",
              },
            ].map((s) => (
              <li key={s.src} className="flex flex-col items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.src}
                  alt={s.alt}
                  className="w-full max-w-[220px] rounded-[28px] drop-shadow-[0_10px_18px_rgba(28,59,46,0.18)]"
                />
                <p className="mt-4 max-w-[220px] text-center font-zilla text-sm font-medium leading-snug text-[var(--ink)] sm:text-[15px]">
                  {s.caption}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* DOWNLOAD */}
      <section
        id="download"
        className="scroll-mt-4 bg-[var(--gold)] px-5 py-16 sm:px-12 sm:py-20 md:px-16 lg:px-24"
      >
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl leading-none text-[var(--ink)] sm:text-4xl md:text-[2.75rem]">
            Free to download
          </h2>
          <p className="mt-3 max-w-2xl font-zilla text-lg font-medium leading-relaxed text-[var(--ink)] opacity-80">
            No account, no fees. Just download and start learning. The first time
            you launch the app, it will download its 2GB AI tutoring model. After
            that, Hiraia no longer requires an internet connection.
          </p>
          <div className="mt-8">
            <AppDownload />
          </div>
        </div>
      </section>

      {/* BREAKER — full-bleed white band with the feedback line + its modal. */}
      <FeedbackBreaker />

      <section className="px-5 py-16 sm:px-12 sm:py-20 md:px-16 lg:px-24">
        <div className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <YouTubeEmbed id="nmoIvZcPmEE" title="Why we built Hiraia" poster="/landing.jpeg" />
          <div>
            <p className="mc-label text-[10px] text-[var(--gold)]">The reason</p>
            <h2 className="mt-2 text-3xl leading-none text-[var(--stock)] sm:text-4xl">
              Why we built hiraia
            </h2>
            <blockquote className="mc-pullquote">
              <p>
                &ldquo;The average 15-year-old Filipino student has the same math
                and science aptitude as a 10-year-old Singaporean. Our children
                are up to 5 whole school years behind children from other
                countries.&rdquo;
              </p>
            </blockquote>
            <p className="mt-5 max-w-xl font-zilla text-lg font-medium leading-relaxed text-[var(--stock)]/85">
              Creator{' '}
              <a
                href="https://x.com/helloluis"
                className="underline decoration-[var(--gold)] underline-offset-2 hover:text-[var(--gold)]"
              >
                Luis Buenaventura
              </a>{' '}
              believes AI can help reinforce science education in the
              Philippines, but an on-device inference model is the only viable
              solution when 2/3 of all households don&apos;t have a fixed
              internet connection.
            </p>
          </div>
        </div>
      </section>

      <section className="mc-pears px-5 py-16 sm:px-12 sm:py-20 md:px-16 lg:px-24">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-6">
          <div>
            <p className="mc-label text-[10px] text-[var(--gold)]">School or Municipal Wifi</p>
            <h2 className="mt-2 text-3xl leading-none text-[var(--ink)] sm:text-4xl">
              Deploying Hiraia at Scale
            </h2>
            <p className="mt-5 max-w-xl font-zilla text-lg font-medium leading-relaxed text-[var(--ink)]">
              The tutoring model is a one-time download of about two gigabytes.
              Fetching that over cellular data, once for every student in a
              class, is more than most families can spend.
            </p>
            <p className="mt-4 max-w-xl font-zilla text-lg font-medium leading-relaxed text-[var(--ink)]">
              Hiraia uses{' '}
              <a
                href="https://pears.com"
                className="underline decoration-[var(--gold)] underline-offset-2 hover:text-[var(--gold)]"
              >
                Pears</a>, a peer-to-peer filesharing protocol, so the download only has
              to happen once. As long as one student on the classroom Wi-Fi
              holds a complete copy, the rest of the class can take it from
              that phone — and from one another — without another trip to the
              internet, and without a central server.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pears-classroom.webp"
            alt="Students on a classroom Wi-Fi share the Hiraia model with one another in a mesh: the school seeds one phone, then every phone can copy from any other."
            width={1448}
            height={1086}
            className="w-full max-w-xl justify-self-center lg:max-w-none"
          />
        </div>
      </section>

      <footer className="border-t-[3px] border-[var(--ink)] px-5 py-10 sm:px-12 md:px-16 lg:px-24">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <a
              href="https://qvac.tether.io"
              className="inline-block opacity-90 transition-opacity hover:opacity-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/built-with-qvac-sdk.png"
                alt="Built with QVAC SDK"
                width={675}
                height={200}
                className="h-10 w-auto sm:h-12"
              />
            </a>
            <p className="mc-label text-[10px] text-[var(--sage)]">hiraia.org</p>
          </div>
          <p className="mt-8 max-w-3xl font-zilla text-[11px] font-medium leading-relaxed text-[var(--sage)]/80 sm:text-xs">
            Hiraia is not affiliated with or endorsed by the Philippine
            Department of Education. Its alignment with MATATAG curriculum is
            based on information and content in the public domain, and is not
            guaranteed to be accurate, and has not been reviewed by the
            Department of Education or other public academic institutions.
            Although its originator has endeavoured to provide the most accurate
            synthesis possible of the current public school science curriculum,
            usage of Hiraia should be carried out at your own risk.
          </p>
        </div>
      </footer>

      <DemoLightbox />
    </div>
  );
}
