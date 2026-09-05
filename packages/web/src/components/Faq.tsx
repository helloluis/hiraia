import { FAQ_SECTIONS, faqBySection } from '@/data/faq';
import { SiteFooter } from '@/components/SiteFooter';

export function Faq() {
  return (
    <div className="mc min-h-screen w-full overflow-x-hidden">
      <div className="mc-alpha" role="status">
        <span>Early Alpha</span>
      </div>

      <header className="px-5 pt-10 sm:px-12 sm:pt-12 md:px-16 lg:px-24">
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-4">
          <a href="/" className="font-slab text-2xl tracking-wide text-[var(--stock)] sm:text-3xl">
            HIRAIA
          </a>
          <a
            href="/"
            className="mc-label text-[10px] text-[var(--gold)] underline decoration-[var(--gold)] underline-offset-4"
          >
            Back to the homepage
          </a>
        </div>
      </header>

      <section className="px-5 py-12 sm:px-12 sm:py-16 md:px-16 lg:px-24">
        <div className="mx-auto max-w-3xl">
          <p className="mc-label text-[10px] text-[var(--gold)]">A field guide</p>
          <h1 className="mt-2 text-4xl leading-none text-[var(--stock)] sm:text-5xl">Questions</h1>
          <p className="mt-5 max-w-xl font-zilla text-lg font-medium leading-relaxed text-[var(--stock)]/90">
            How to use Hiraia, what it runs on, what science is in the tutor, and
            what to do when something sticks. An on-page assistant will use these
            same answers; this page is the source of truth.
          </p>
        </div>
      </section>

      <nav
        aria-label="FAQ sections"
        className="sticky top-0 z-20 border-y-[3px] border-[var(--ink)] bg-[var(--board)] px-5 py-3 sm:px-12 md:px-16 lg:px-24"
      >
        <ul className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-2">
          {FAQ_SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="mc-label text-[10px] text-[var(--gold)] hover:text-[var(--stock)]"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="px-5 py-12 sm:px-12 sm:py-16 md:px-16 lg:px-24">
        <div className="mx-auto flex max-w-3xl flex-col gap-14">
          {FAQ_SECTIONS.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-20">
              <h2 className="text-2xl leading-none text-[var(--stock)] sm:text-3xl">{section.label}</h2>
              <p className="mt-3 max-w-xl font-zilla text-base font-medium leading-relaxed text-[var(--stock)]/85">
                {section.blurb}
              </p>
              <div className="mt-6 flex flex-col gap-3">
                {faqBySection(section.id).map((item) => (
                  <details key={item.id} id={item.id} className="mc-faq">
                    <summary>
                      <span className="mc-faq-q">{item.q}</span>
                      <span className="mc-faq-mark" aria-hidden />
                    </summary>
                    <div className="mc-faq-a">
                      {item.a.map((p) => (
                        <p key={p.slice(0, 48)}>{p}</p>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
