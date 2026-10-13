import type { Metadata } from 'next';
import { Wordmark } from '@/components/brand/Wordmark';
import { SiteFooter } from '@/components/SiteFooter';
import { PilotApplicationForm } from '@/components/PilotApplicationForm';
import styles from '@/components/PilotApplication.module.css';

export const metadata: Metadata = {
  title: 'Apply for a pilot program — Hiraia',
  description:
    'Apply for a Hiraia pilot program and help bring offline AI tutoring and adaptive learning to more Filipino schools.',
};

export default function PilotPage() {
  return (
    <div className={`mc min-h-screen ${styles.page}`}>
      <a href="#pilot-form" className={styles.skipLink}>
        Skip to application
      </a>
      <header className={styles.header}>
        <a href="/" aria-label="Hiraia homepage" className="font-slab text-3xl">
          <Wordmark />
        </a>
        <a href="/#download">
          Back to Hiraia <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main className={styles.main}>
        <div className={styles.intro}>
          <p className={`mc-label ${styles.eyebrow}`}>Hiraia for schools</p>
          <h1>Bring Hiraia to your school</h1>
          <p>
            Our mission is to bring offline AI tutoring and adaptive learning to as many Filipino
            schools as possible. Apply to join our pilot program.
          </p>
        </div>
        <PilotApplicationForm />
      </main>
      <SiteFooter />
    </div>
  );
}
