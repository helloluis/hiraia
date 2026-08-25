'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppDownload } from '@/components/AppDownload';
import { HiraiaBench } from '@/components/HiraiaBench';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { DemoLightbox } from '@/components/demo/DemoLightbox';
import { useDemoStore } from '@/store/useDemoStore';

/** A few of the in-app engravings. Tagalog on the card; English types in on hover/tap. */
const FLASH_CARDS: {
  src: string;
  alt: string;
  topicTl: string;
  topicEn: string;
  tl: string;
  en: string;
}[] = [
  {
    src: '/demo/cards/philippine-tarsier-cling.png',
    alt: 'Tarsier',
    topicTl: 'Mga buhay',
    topicEn: 'Living things',
    tl: 'Primate ang tarsier — pero hindi ito unggoy.',
    en: 'A tarsier is a primate — but it isn’t a monkey.',
  },
  {
    src: '/demo/cards/mayon-volcano-cone.png',
    alt: 'Bulkang Mayon',
    topicTl: 'Lupa at kalawakan',
    topicEn: 'Earth & space',
    tl: 'Ang Mayon ang pinaka-aktibong bulkan sa Pilipinas, tanyag sa hugis-kono nito.',
    en: 'Mayon is the Philippines’ most active volcano, famous for its cone.',
  },
  {
    src: '/demo/cards/green-sea-turtle-pawikan.png',
    alt: 'Pawikan',
    topicTl: 'Mga buhay',
    topicEn: 'Living things',
    tl: 'Nakakahanap ng daan pauwi ang pawikan gamit ang magnetic field ng Earth.',
    en: 'Sea turtles find their way home using Earth’s magnetic field.',
  },
  {
    src: '/demo/cards/halo-halo-layers-heterogeneous.png',
    alt: 'Halo-halo',
    topicTl: 'Materya',
    topicEn: 'Matter',
    tl: 'Heterogeneous mixture ang halo-halo: makikita mo ang bawat patong.',
    en: 'Halo-halo is a heterogeneous mixture: you can see every layer.',
  },
  {
    src: '/demo/cards/firefly-alitaptap.png',
    alt: 'Alitaptap',
    topicTl: 'Mga buhay',
    topicEn: 'Living things',
    tl: 'Sa mga bakawan ng Pilipinas, libu-libong alitaptap ang sabay-sabay na kumikislap.',
    en: 'In Philippine mangroves, thousands of fireflies flash as one.',
  },
  {
    src: '/demo/cards/mangrove-prop-roots.png',
    alt: 'Ugat ng bakawan',
    topicTl: 'Lupa at kalawakan',
    topicEn: 'Earth & space',
    tl: 'Pinabagal ng ugat ng bakawan ang tubig para maipon ang putik at magdagdag ng lupa.',
    en: 'Mangrove roots slow the water so mud settles and builds new land.',
  },
  {
    src: '/demo/cards/nipa-hut-bahay-kubo-scene.png',
    alt: 'Bahay kubo',
    topicTl: 'Materya',
    topicEn: 'Matter',
    tl: 'Dahon ng nipa ang bubong ng bahay kubo — mahigpit ang saga, hindi tinatablan ng ulan.',
    en: 'Nipa leaves roof a bahay kubo — woven tight, they shed rain and stay cool.',
  },
  {
    src: '/demo/cards/palayok-clay-pot.png',
    alt: 'Palayok',
    topicTl: 'Materya',
    topicEn: 'Matter',
    tl: 'Seramika ang palayok: matibay sa init, malutong kapag nahulog.',
    en: 'A palayok is ceramic: tough against heat, brittle if you drop it.',
  },
];

const TICK_MS = 24;
const CHARS_PER_TICK = 3;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isFinePointer() {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function SampleCard(card: (typeof FLASH_CARDS)[number]) {
  const [english, setEnglish] = useState(false);
  const target = english ? card.en : card.tl;
  const [shown, setShown] = useState(card.tl.length);
  const skipAnim = useRef(true);

  useEffect(() => {
    if (skipAnim.current) {
      skipAnim.current = false;
      setShown(target.length);
      return;
    }
    if (prefersReducedMotion()) {
      setShown(target.length);
      return;
    }
    setShown(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      i += CHARS_PER_TICK;
      setShown(i);
      if (i < target.length) timer = setTimeout(tick, TICK_MS);
    };
    timer = setTimeout(tick, 40);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [target]);

  const showEn = () => setEnglish(true);
  const showTl = () => setEnglish(false);
  const toggle = () => setEnglish((v) => !v);

  const visible = target.slice(0, Math.min(shown, target.length));
  const reserve = card.tl.length >= card.en.length ? card.tl : card.en;

  return (
    <li className="mc-fan">
      <button
        type="button"
        className="mc-card w-full cursor-pointer p-3 text-left sm:p-3.5"
        aria-label={`${card.alt}. ${english ? card.en : card.tl}`}
        onMouseEnter={() => {
          if (isFinePointer()) showEn();
        }}
        onMouseLeave={() => {
          if (isFinePointer()) showTl();
        }}
        onClick={() => {
          if (!isFinePointer()) toggle();
        }}
      >
        <div className="mc-keyline" aria-hidden />
        <div className="mc-band mb-3">
          <span className="mc-topic">{english ? card.topicEn : card.topicTl}</span>
        </div>
        <div className="mc-plate">
          <div className="mc-window aspect-square">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.src} alt="" />
          </div>
        </div>
        <p className="relative z-[1] mt-3 font-zilla text-[13px] font-medium leading-snug text-[var(--ink)] sm:text-[15px]">
          <span className="invisible block" aria-hidden>
            {reserve}
          </span>
          <span className="absolute inset-0">
            {visible}
            <span className="opacity-0">{target.slice(visible.length)}</span>
          </span>
        </p>
      </button>
    </li>
  );
}

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
      {/* HERO — photograph stays; overlay is a laminated classroom card. */}
      <section
        className="relative flex min-h-[100svh] w-full items-start justify-start bg-cover bg-center bg-no-repeat sm:bg-[center_40%]"
        style={{ backgroundImage: "url('/landing.jpeg')" }}
        aria-label="Hiraia"
      >
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
            Science on your phone
          </h2>
          <p className="mt-5 max-w-2xl font-zilla text-lg font-medium leading-relaxed text-[var(--stock)]/90 sm:text-xl">
            Hiraia is an AI tutor for Filipino students. After a one-time download,
            it works (forever!) without an internet connection. No account
            registration is required, no information is collected, and no personal
            data ever leaves the device.
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

      {/* DECK */}
      <section className="px-5 pb-16 sm:px-12 sm:pb-20 md:px-16 lg:px-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="max-w-3xl text-3xl leading-none text-[var(--stock)] sm:text-4xl">
            Flip a card. Learn a fact.
          </h2>
          <p className="mt-3 max-w-2xl font-zilla text-lg font-medium leading-relaxed text-[var(--stock)]/85">
            The app is a stack of illustrated science cards — about 50,000 verified
            facts, and nearly 15,000 drawings that ship with it.
          </p>

          <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {FLASH_CARDS.map((c) => (
              <SampleCard key={c.src} {...c} />
            ))}
          </ul>

          <div className="mt-12 max-w-xs">
            <Ticket onClick={openDemo}>Try the demo</Ticket>
          </div>
        </div>
      </section>

      {/* DOWNLOAD */}
      <section id="download" className="scroll-mt-4 px-5 py-16 sm:px-12 sm:py-20 md:px-16 lg:px-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl leading-none text-[var(--stock)] sm:text-4xl md:text-[2.75rem]">
            Free to download
          </h2>
          <p className="mt-3 max-w-2xl font-zilla text-lg font-medium leading-relaxed text-[var(--stock)]/85">
            No account, no fees. Just download and start learning. The first time
            you launch the app, it will download its 2GB AI tutoring model. After
            that, Hiraia no longer requires an internet connection.
          </p>
          <div className="mt-8">
            <AppDownload />
          </div>
        </div>
      </section>

      <HiraiaBench />

      <section className="px-5 py-16 sm:px-12 sm:py-20 md:px-16 lg:px-24">
        <div className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <YouTubeEmbed id="nmoIvZcPmEE" title="Why we built Hiraia" poster="/landing.jpeg" />
          <div>
            <p className="mc-label text-[10px] text-[var(--gold)]">The reason</p>
            <h2 className="mt-2 text-3xl leading-none text-[var(--stock)] sm:text-4xl">
              Why we built hiraia
            </h2>
            <p className="mt-4 max-w-xl font-zilla text-lg font-medium leading-relaxed text-[var(--stock)]/85">
              Founder Luis Buenaventura on science education in the Philippines, and
              what an on-device tutor can do when the internet isn’t a given.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t-[3px] border-[var(--ink)] px-5 py-10 sm:px-12 md:px-16 lg:px-24">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <p>
            <span className="font-slab text-2xl tracking-wide text-[var(--stock)]">
              HIRAIA<span className="text-[var(--gold)]">.</span>
            </span>
            <span className="mt-1 block max-w-md font-zilla text-sm font-medium text-[var(--sage)]">
              Not-for-profit. Built on{' '}
              <a href="https://qvac.tether.io" className="underline decoration-[var(--sage)] underline-offset-2 hover:text-[var(--stock)]">
                QVAC
              </a>
              .
            </span>
          </p>
          <p className="mc-label text-[10px] text-[var(--sage)]">hiraia.org</p>
        </div>
      </footer>

      <DemoLightbox />
    </div>
  );
}
