export function SiteFooter() {
  return (
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
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href="/" className="mc-label text-[10px] text-[var(--sage)] hover:text-[var(--gold)]">
              Home
            </a>
            <a href="/faq" className="mc-label text-[10px] text-[var(--sage)] hover:text-[var(--gold)]">
              Questions
            </a>
            <span className="mc-label text-[10px] text-[var(--sage)]">hiraia.org</span>
          </nav>
        </div>
        <p className="mt-8 max-w-3xl font-zilla text-[11px] font-medium leading-relaxed text-[var(--sage)]/80 sm:text-xs">
          Hiraia is not affiliated with or endorsed by the Philippine Department of
          Education. Its alignment with MATATAG curriculum is based on information
          and content in the public domain, and is not guaranteed to be accurate,
          and has not been reviewed by the Department of Education or other public
          academic institutions. Although its originator has endeavoured to provide
          the most accurate synthesis possible of the current public school science
          curriculum, usage of Hiraia should be carried out at your own risk.
        </p>
      </div>
    </footer>
  );
}
