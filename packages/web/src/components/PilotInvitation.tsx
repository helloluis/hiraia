import styles from './PilotApplication.module.css';

export function PilotInvitation() {
  return (
    <section className={styles.invitation} aria-labelledby="pilot-invitation-title">
      <div>
        <h2 id="pilot-invitation-title">Want to deploy Hiraia in your school?</h2>{' '}
        <a href="/pilot">
          Apply for a pilot program! <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}
