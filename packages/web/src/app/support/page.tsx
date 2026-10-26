import type { Metadata } from 'next';
import { Wordmark } from '@/components/brand/Wordmark';
import { SiteFooter } from '@/components/SiteFooter';
import shared from '@/components/PilotApplication.module.css';
import styles from '@/components/Support.module.css';

export const metadata: Metadata = {
  title: 'Support Hiraia — help put science within reach',
  description:
    'Equip a classroom, work with a pilot or fund the work: how to support Hiraia, the free offline AI science tutor for Filipino students.',
};

// The three asks, the application line, the contact block and the footnote are the closing
// page of the published pitch deck (docs/pitch-deck/HIRAIA-PITCH-DECK.html, "Join the next
// stage"), kept word for word so the website and the deck make the same ask.
const ASKS = [
  {
    step: '01',
    title: 'Equip a classroom',
    text: 'Donate suitable Android phones, charging equipment and setup support.',
  },
  {
    step: '02',
    title: 'Work with a pilot',
    text: 'Partner on teaching, native-language review and practical assessment.',
  },
  {
    step: '03',
    title: 'Support the work',
    text: 'Fund content improvement, device reliability and field evaluation.',
  },
];

// Pilot launch photographs already published in the Dev Diary (same files, same alt text).
const PHOTOS = [
  {
    src: '/dev-diary/calapacuan-launch.jpg',
    width: 1200,
    height: 1173,
    alt: 'A speaker presenting Hiraia to a seated audience at Calapacuan Elementary School',
    caption: 'Calapacuan Elementary School, Subic, Zambales — pilot launched 23 September 2026.',
  },
  {
    src: '/dev-diary/daanghari-launch.jpg',
    width: 2048,
    height: 1152,
    alt: 'School staff and Hiraia collaborators gathered at DaangHari Elementary School in Navotas',
    caption: 'DaangHari Elementary School, Navotas — pilot launched 14 October 2026.',
  },
];

export default function SupportPage() {
  return (
    <div className={`mc min-h-screen ${shared.page}`}>
      <a href="#support-main" className={shared.skipLink}>
        Skip to content
      </a>
      <header className={shared.header}>
        <a href="/" aria-label="Hiraia homepage" className="font-slab text-3xl">
          <Wordmark />
        </a>
        <a href="/#download">
          Back to Hiraia <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main id="support-main" className={styles.main}>
        <section className={styles.hero}>
          <p className={`mc-label ${shared.eyebrow}`}>Join the next stage</p>
          <h1>Help put science within reach.</h1>
          <p className={styles.lead}>
            Four schools are already piloting Hiraia. Here is how to help put it in more
            classrooms.
          </p>
        </section>

        <ol className={styles.asks} aria-label="Three ways to help">
          {ASKS.map((ask) => (
            <li key={ask.step}>
              <span className={styles.step} aria-hidden="true">
                {ask.step}
              </span>
              <h2>{ask.title}</h2>
              <p>{ask.text}</p>
            </li>
          ))}
        </ol>

        <p className={styles.apply}>
          Interested to run a Hiraia pilot in your school? <a href="/pilot">Click here to apply.</a>
        </p>

        <section className={styles.photos} aria-label="From the pilot launches">
          {PHOTOS.map((photo) => (
            <figure key={photo.src}>
              <div className={styles.frame}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.src}
                  alt={photo.alt}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <figcaption>{photo.caption}</figcaption>
            </figure>
          ))}
        </section>

        <section className={styles.contact} aria-label="Contact and links">
          <a className={styles.email} href="mailto:lb@hiraia.org">
            lb@hiraia.org
          </a>
          <p>
            Luis Buenaventura · <a href="/">hiraia.org</a>
          </p>
          <p className={styles.links}>
            <a href="/#download">Download Hiraia</a>
            <span aria-hidden="true"> · </span>
            <a href="/hiraia-whitepaper.pdf" target="_blank" rel="noopener">
              Read the whitepaper
            </a>
            <span aria-hidden="true"> · </span>
            <a href="/competencies">Explore the curriculum</a>
          </p>
          <p className={styles.note}>
            Free to use · No advertising or subscription · Not-for-profit project. Confirm
            device compatibility before donating; 6 GB-class or larger phones are preferred for
            optional generation.{' '}
            <a href="https://github.com/helloluis/hiraia/blob/main/LICENSE.md">
              Content and software have separate reuse terms.
            </a>
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
